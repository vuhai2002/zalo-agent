import type { API } from "zca-js";
import { getAccount } from "../config/account-store.js";
import { getTuning } from "../config/runtime-tuning-settings.js";
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
import { describeForHistory, parseIncomingMessage, type ParsedMessage } from "./zalo-message-parser.js";

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

  const msg = parseIncomingMessage(config.id, selfId, raw, getTuning("ZALO_IMAGE_QUALITY"));

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
      ghiVaoHistory(config.id, msg);
    }
    log.debug(
      { accountId: config.id, threadId: msg.threadId, reason: decision.reason },
      decision.record ? "Ghi passive, không trả lời" : "Bỏ qua tin",
    );
    return;
  }

  const threadKey = `${config.id}:${msg.threadId}`;
  const daNhan = enqueueMessage(threadKey, msg, (batch) => processBatch(config, api, batch));

  // Chạm trần hàng chờ. Tin không tới được `processBatch` - mà đó là nơi DUY
  // NHẤT ghi history cho nhánh có-trả-lời - nên phải tự ghi ở đây. Không ghi
  // thì tin biến mất khỏi cả cuộc hội thoại lẫn trí nhớ của bot, trong khi
  // `sendDeliveredReceipt` bên trên đã báo "đã nhận" và người ta đinh ninh bot
  // có nghe. Với bot cá nhân, im lặng nuốt một câu người ta đã nói là kết cục
  // tệ nhất - cùng lý do đã chốt cho job lịch hẹn trễ hạn.
  //
  // ĐÁNH ĐỔI đã biết: dòng này ghi NGAY, còn batch đang đỗ thì mãi tới lúc lượt
  // chạy xong mới ghi - nên trong history tin bị bỏ nằm TRƯỚC những tin đến
  // trước nó. Chấp nhận: sai thứ tự một tin trong một ca bệnh lý vẫn hơn mất
  // hẳn tin đó. Đường passive bên trên vốn đã có đúng tính chất này.
  if (!daNhan) {
    ghiVaoHistory(config.id, msg);
    log.warn(
      { accountId: config.id, threadId: msg.threadId },
      "Tin bị bỏ khỏi lượt vì hàng chờ chạm trần - đã ghi vào history để bot còn biết",
    );
  }
}

/**
 * Ghi 1 tin vào history ngay lập tức.
 *
 * Ảnh tải xong (async) mới gắn vào row qua id - `persistBatchImages` không bao
 * giờ reject nên fire-and-forget được.
 */
function ghiVaoHistory(accountId: string, msg: ParsedMessage): void {
  const rowId = appendMessage(accountId, msg.threadId, {
    role: "user",
    content: describeForHistory(msg),
    senderName: msg.senderName,
    senderId: msg.senderId,
  });
  if (msg.images.length > 0) {
    void persistBatchImages(accountId, [msg]).then(() => {
      setMessageImages(rowId, imagePathsOf(msg.images));
    });
  }
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
