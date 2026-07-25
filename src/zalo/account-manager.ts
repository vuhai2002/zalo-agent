import type { API } from "zca-js";
import { runAgentTurn } from "../agent/agent-loop.js";
import { getAccount, listEnabledAccounts, runAccountsSeedMigration, type AccountConfig } from "../config/account-store.js";
import { recordContactActivity } from "../conversation/contact-store.js";
import { appendMessage } from "../conversation/history-store.js";
import { runStartupBackfill } from "../conversation/startup-backfill.js";
import {
  hasDisplayName,
  isBotEnabled,
  recordThreadActivity,
  setThreadDisplayName,
} from "../conversation/thread-store.js";
import { maybeSummarizeThread } from "../conversation/thread-summarizer.js";
import { recordAgentTurn } from "../conversation/usage-store.js";
import { shouldRespond } from "../middleware/allowlist-filter.js";
import { clearPendingBatches, enqueueMessage } from "../middleware/message-batcher.js";
import { enqueueSend } from "../middleware/rate-limiter.js";
import { createLogger } from "../shared/logger.js";
import { toZaloReaction } from "./reaction-icons.js";
import { startTypingIndicator } from "./typing-indicator.js";
import { loginWithStoredCredentials } from "./zalo-client.js";
import { startListener } from "./zalo-listener.js";
import { parseIncomingMessage, type ParsedMessage } from "./zalo-message-parser.js";

type RunningAccount = {
  config: AccountConfig;
  api: API;
  selfId: string;
  stopListener: () => void;
};

const running = new Map<string, RunningAccount>();
const log = createLogger("account-manager");

/** Trạng thái account đang chạy - cho dashboard */
export function getRunningAccounts(): { id: string; label: string; selfId: string }[] {
  return [...running.values()].map((a) => ({
    id: a.config.id,
    label: a.config.label,
    selfId: a.selfId,
  }));
}

export function isAccountRunning(accountId: string): boolean {
  return running.has(accountId);
}

/**
 * Gắn 1 account đã có API instance vào hệ thống (login QR web xong gọi thẳng
 * vào đây để không phải login lần 2). Account đang chạy thì thay thế.
 */
export function attachAccount(config: AccountConfig, api: API): void {
  stopAccount(config.id);
  const selfId = String(api.getOwnId());
  const stopListener = startListener(config.id, api, (raw) =>
    handleIncomingMessage(config.id, api, selfId, raw),
  );
  running.set(config.id, { config, api, selfId, stopListener });
  log.info({ accountId: config.id, label: config.label }, "Account sẵn sàng");
}

/** Start bằng credentials đã lưu - dùng lúc boot và khi bật lại từ dashboard */
export async function startAccount(accountId: string): Promise<void> {
  const config = getAccount(accountId);
  if (!config) throw new Error(`Account "${accountId}" không tồn tại`);
  if (!config.enabled) throw new Error(`Account "${accountId}" đang tắt`);

  const api = await loginWithStoredCredentials(accountId);
  attachAccount(config, api);
}

export function stopAccount(accountId: string): void {
  const account = running.get(accountId);
  if (!account) return;
  account.stopListener();
  running.delete(accountId);
  log.info({ accountId }, "Đã dừng listener");
}

export async function startAllAccounts(): Promise<void> {
  runStartupBackfill();
  runAccountsSeedMigration();

  const accounts = listEnabledAccounts();
  for (const config of accounts) {
    try {
      await startAccount(config.id);
    } catch (err) {
      log.error({ accountId: config.id, err }, "Không khởi động được account - bỏ qua");
    }
  }

  // Không account nào chạy vẫn KHÔNG chết: dashboard cần sống để user thêm
  // account + quét QR ngay trên web (khác bản cũ vốn throw ở đây)
  log.info(
    { total: running.size, configured: accounts.length },
    running.size > 0 ? "Account đã khởi động" : "Chưa account nào chạy - thêm/login qua dashboard",
  );
}

/**
 * Mọi tin đến (kể cả tin sẽ bị lọc): ghi contact + thread ("auto-collected").
 * Đọc config mới nhất từ DB mỗi tin để sửa policies từ dashboard ăn ngay.
 */
function handleIncomingMessage(accountId: string, api: API, selfId: string, raw: unknown): void {
  const config = getAccount(accountId);
  if (!config) return;

  const msg = parseIncomingMessage(config.id, selfId, raw);

  if (!msg.isSelf && msg.threadId) {
    recordContactActivity(config.id, msg.senderId, msg.senderName);
    recordThreadActivity({
      accountId: config.id,
      threadId: msg.threadId,
      threadType: msg.threadType,
      displayName: msg.isGroup ? "" : msg.senderName,
      lastSenderName: msg.senderName,
    });
    if (msg.isGroup && !hasDisplayName(config.id, msg.threadId)) {
      void resolveGroupName(config.id, api, msg.threadId);
    }
  }

  const decision = shouldRespond(config, msg, isBotEnabled(config.id, msg.threadId));

  if (!decision.respond) {
    if (decision.record) {
      appendMessage(config.id, msg.threadId, {
        role: "user",
        content: describeIncoming(msg),
        senderName: msg.senderName,
        senderId: msg.senderId,
      });
    }
    log.debug(
      { accountId: config.id, threadId: msg.threadId, reason: decision.reason },
      decision.record ? "Ghi passive, không trả lời" : "Bỏ qua tin",
    );
    return;
  }

  const threadKey = `${config.id}:${msg.threadId}`;
  enqueueMessage(threadKey, msg, (batch) => processBatch(config, api, batch));
}

/** Lấy tên group 1 lần khi gặp lần đầu, cache vào bảng threads */
async function resolveGroupName(accountId: string, api: API, threadId: string): Promise<void> {
  try {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const info: any = await api.getGroupInfo(threadId);
    const name = info?.gridInfoMap?.[threadId]?.name ?? info?.name;
    if (name) setThreadDisplayName(accountId, threadId, String(name));
  } catch (err) {
    log.debug({ accountId, threadId, err }, "Không lấy được tên nhóm - để trống");
  }
}

/**
 * Báo cho người nhắn biết bot đã nhận: thả reaction vào tin vừa gửi.
 * Không await ở luồng chính và tự nuốt lỗi - reaction hỏng không được làm
 * chậm hay chết đường trả lời.
 */
function sendAutoReaction(config: AccountConfig, api: API, msg: ParsedMessage): void {
  if (!config.autoReactEnabled || !msg.msgId) return;
  void api
    .addReaction(toZaloReaction(config.autoReactIcon), {
      data: { msgId: msg.msgId, cliMsgId: msg.cliMsgId },
      threadId: msg.threadId,
      type: msg.threadType,
    })
    .catch((err) =>
      log.debug({ accountId: config.id, threadId: msg.threadId, err }, "Auto-react thất bại"),
    );
}

async function processBatch(config: AccountConfig, api: API, batch: ParsedMessage[]): Promise<void> {
  const latest = batch[batch.length - 1]!;
  const threadKey = `${config.id}:${latest.threadId}`;

  log.info(
    {
      accountId: config.id,
      threadId: latest.threadId,
      from: latest.senderName,
      batchSize: batch.length,
      images: batch.reduce((sum, m) => sum + m.images.length, 0),
    },
    "Xử lý lượt tin nhắn",
  );

  sendAutoReaction(config, api, latest);

  // Giữ "đang nhập" xuyên suốt: qua cả lượt LLM lẫn delay của rate-limiter,
  // dừng trong finally kể cả khi agent ném lỗi
  const stopTyping = config.typingIndicatorEnabled
    ? startTypingIndicator({
        send: (threadId, threadType) => api.sendTypingEvent(threadId, threadType),
        threadId: latest.threadId,
        threadType: latest.threadType,
      })
    : () => {};

  try {
    // Chạy agent TRƯỚC khi ghi history: runAgentTurn tự đọc history cũ và tự
    // ghép batch hiện tại vào input - ghi trước sẽ khiến tin mới lặp 2 lần.
    const result = await runAgentTurn({ api, account: config, batch });
    recordAgentTurn(config.id, latest.threadId, result.usage);

    for (const msg of batch) {
      appendMessage(config.id, msg.threadId, {
        role: "user",
        content: describeIncoming(msg),
        senderName: msg.senderName,
        senderId: msg.senderId,
      });
    }

    if (!result.text) {
      log.debug({ threadId: latest.threadId }, "Agent không trả text (có thể chỉ thả reaction)");
      return;
    }

    await enqueueSend(threadKey, () =>
      api.sendMessage({ msg: result.text }, latest.threadId, latest.threadType),
    );
    appendMessage(config.id, latest.threadId, { role: "assistant", content: result.text });

    // Memory lớp 2: gộp tin cũ vào summary - fire-and-forget sau khi đã trả lời,
    // maybeSummarizeThread tự nuốt lỗi nên không cần catch thêm
    void maybeSummarizeThread(config.id, latest.threadId);
  } catch (err) {
    log.error({ accountId: config.id, threadId: latest.threadId, err }, "Lỗi xử lý lượt tin nhắn");
  } finally {
    stopTyping();
  }
}

function describeIncoming(msg: ParsedMessage): string {
  const imageNote = msg.images.length > 0 ? ` [gửi kèm ${msg.images.length} ảnh]` : "";
  return `${msg.text}${imageNote}`.trim() || "[ảnh]";
}

export function stopAllAccounts(): void {
  clearPendingBatches();
  for (const id of [...running.keys()]) {
    stopAccount(id);
  }
  log.info("Đã dừng toàn bộ listener");
}
