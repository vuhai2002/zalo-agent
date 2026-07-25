import type { API } from "zca-js";
import { runAgentTurn } from "../agent/agent-loop.js";
import { loadAccounts, type AccountConfig } from "../config/accounts.js";
import { appendMessage } from "../conversation/history-store.js";
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

export async function startAllAccounts(): Promise<void> {
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
 * Lọc tin rồi đẩy vào batcher. Batcher gom các tin gần nhau trong cùng thread
 * (Zalo gửi ảnh và caption thành 2 tin) và chạy tuần tự từng thread.
 */
function handleIncomingMessage(
  config: AccountConfig,
  api: API,
  selfId: string,
  raw: unknown,
): void {
  const msg = parseIncomingMessage(config.id, selfId, raw);
  const decision = shouldRespond(config, msg);
  if (!decision.respond) {
    log.debug(
      { accountId: config.id, threadId: msg.threadId, reason: decision.reason },
      "Bỏ qua tin",
    );
    return;
  }

  const threadKey = `${config.id}:${msg.threadId}`;
  enqueueMessage(threadKey, msg, (batch) => processBatch(config, api, batch));
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
    const replyText = await runAgentTurn({ api, account: config, batch });

    for (const msg of batch) {
      appendMessage(config.id, msg.threadId, {
        role: "user",
        content: describeIncoming(msg),
        senderName: msg.senderName,
      });
    }

    if (!replyText) {
      log.debug({ threadId: latest.threadId }, "Agent không trả text (có thể chỉ thả reaction)");
      return;
    }

    await enqueueSend(threadKey, () =>
      api.sendMessage({ msg: replyText }, latest.threadId, latest.threadType),
    );
    appendMessage(config.id, latest.threadId, { role: "assistant", content: replyText });
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
