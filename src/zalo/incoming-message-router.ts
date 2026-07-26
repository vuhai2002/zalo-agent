import type { API } from "zca-js";
import { getAccount } from "../config/account-store.js";
import { env } from "../config/env.js";
import { recordContactActivity } from "../conversation/contact-store.js";
import { appendMessage, setMessageImages } from "../conversation/history-store.js";
import { imagePathsOf, persistBatchImages } from "../conversation/media-store.js";
import {
  hasDisplayName,
  isBotEnabled,
  recordThreadActivity,
  setThreadDisplayName,
} from "../conversation/thread-store.js";
import { shouldRespond } from "../middleware/allowlist-filter.js";
import { enqueueMessage } from "../middleware/message-batcher.js";
import { createLogger } from "../shared/logger.js";
import { sendDeliveredReceipt } from "./message-receipts.js";
import { processBatch } from "./message-turn-processor.js";
import { reportPayloadAnomalies } from "./payload-anomaly-watch.js";
import { describeForHistory, parseIncomingMessage } from "./zalo-message-parser.js";

const log = createLogger("message-router");

/**
 * Mọi tin đến (kể cả tin sẽ bị lọc): ghi contact + thread ("auto-collected").
 * Đọc config mới nhất từ DB mỗi tin để sửa policies từ dashboard ăn ngay.
 */
export function routeIncomingMessage(
  accountId: string,
  api: API,
  selfId: string,
  raw: unknown,
): void {
  const config = getAccount(accountId);
  if (!config) return;

  const msg = parseIncomingMessage(config.id, selfId, raw, env.ZALO_IMAGE_QUALITY);

  // Chạy TRƯỚC mọi nhánh return bên dưới: tin thiếu threadId bị bỏ qua lặng lẽ
  // ở ngay dòng dưới, không cảnh báo ở đây thì không còn chỗ nào biết
  reportPayloadAnomalies(config.id, msg);

  if (!msg.isSelf && msg.threadId) {
    // "Đã nhận" cho MỌI tin về tới listener, kể cả tin sắp bị lọc - client Zalo
    // thật cũng báo nhận tự động, không phụ thuộc người dùng có đọc hay không
    sendDeliveredReceipt(api, msg);
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
      // Ghi tin ngay để giữ đúng thứ tự history; ảnh tải xong (async) mới gắn vào
      // row qua id - persistBatchImages không bao giờ reject nên fire-and-forget được
      const rowId = appendMessage(config.id, msg.threadId, {
        role: "user",
        content: describeForHistory(msg),
        senderName: msg.senderName,
        senderId: msg.senderId,
      });
      if (msg.images.length > 0) {
        void persistBatchImages(config.id, [msg]).then(() => {
          setMessageImages(rowId, imagePathsOf(msg.images));
        });
      }
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
