import type { API } from "zca-js";
import { runAgentTurn } from "../agent/agent-loop.js";
import { loadAccounts, type AccountConfig } from "../config/accounts.js";
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
import { loginWithStoredCredentials } from "./zalo-client.js";
import { startListener } from "./zalo-listener.js";
import { parseIncomingMessage, type ParsedMessage } from "./zalo-message-parser.js";

type RunningAccount = {
  config: AccountConfig;
  api: API;
  selfId: string;
  stopListener: () => void;
};

const running: RunningAccount[] = [];
const log = createLogger("account-manager");

/** Trạng thái account đang chạy - cho dashboard overview */
export function getRunningAccounts(): { id: string; label: string; selfId: string }[] {
  return running.map((a) => ({ id: a.config.id, label: a.config.label, selfId: a.selfId }));
}

export async function startAllAccounts(): Promise<void> {
  runStartupBackfill();

  const accounts = loadAccounts().filter((a) => a.enabled);

  for (const config of accounts) {
    try {
      const api = await loginWithStoredCredentials(config.id);
      const selfId = String(api.getOwnId());
      const stopListener = startListener(config.id, api, (raw) =>
        handleIncomingMessage(config, api, selfId, raw),
      );
      running.push({ config, api, selfId, stopListener });
      log.info({ accountId: config.id, label: config.label }, "Account sẵn sàng");
    } catch (err) {
      log.error({ accountId: config.id, err }, "Không khởi động được account - bỏ qua");
    }
  }

  if (running.length === 0) {
    throw new Error("Không account nào khởi động được - kiểm tra credentials (pnpm zalo-login <id>)");
  }
  log.info({ total: running.length }, "Tất cả account đã khởi động");
}

/**
 * Mọi tin đến (kể cả tin sẽ bị lọc): ghi contact + thread ("auto-collected").
 * Sau đó lọc; tin passive (group không mention, thread tắt bot) chỉ ghi history;
 * tin cần trả lời mới vào batcher -> agent.
 */
function handleIncomingMessage(
  config: AccountConfig,
  api: API,
  selfId: string,
  raw: unknown,
): void {
  const msg = parseIncomingMessage(config.id, selfId, raw);

  if (!msg.isSelf && msg.threadId) {
    recordContactActivity(config.id, msg.senderId, msg.senderName);
    recordThreadActivity({
      accountId: config.id,
      threadId: msg.threadId,
      threadType: msg.threadType,
      // Chat riêng: tên thread = tên người chat. Group: tên lấy async bên dưới.
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

async function processBatch(
  config: AccountConfig,
  api: API,
  batch: ParsedMessage[],
): Promise<void> {
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
  }
}

function describeIncoming(msg: ParsedMessage): string {
  const imageNote = msg.images.length > 0 ? ` [gửi kèm ${msg.images.length} ảnh]` : "";
  return `${msg.text}${imageNote}`.trim() || "[ảnh]";
}

export function stopAllAccounts(): void {
  clearPendingBatches();
  for (const account of running) {
    account.stopListener();
  }
  log.info("Đã dừng toàn bộ listener");
}
