import type { API } from "zca-js";
import { getAccount } from "../config/account-store.js";
import { getTuning } from "../config/runtime-tuning-settings.js";
import { recordContactActivity } from "../conversation/contact-store.js";
import { persistBatchImages } from "../conversation/media-store.js";
import {
  hasDisplayName,
  isBotEnabled,
  recordThreadActivity,
  setThreadDisplayName,
} from "../conversation/thread-store.js";
import { shouldRespond } from "../middleware/allowlist-filter.js";
import { enqueueMessage } from "../middleware/message-batcher.js";
import { createLogger } from "../shared/logger.js";
import { maybeNotifyBusyWait } from "./busy-wait-notice.js";
import { sendDeliveredReceipt } from "./message-receipts.js";
import { processBatch } from "./message-turn-processor.js";
import { reportPayloadAnomalies } from "./payload-anomaly-watch.js";
import { ganAnhVaoHistory, ghiTinDenVaoHistory } from "./record-incoming-message.js";
import { parseIncomingMessage } from "./zalo-message-parser.js";

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
      // Không có lượt agent nào sắp chạy nên phải tự tải ảnh
      ghiTinDenVaoHistory(config.id, msg, { luuAnhNgay: true });
    }
    log.debug(
      { accountId: config.id, threadId: msg.threadId, reason: decision.reason },
      decision.record ? "Ghi passive, không trả lời" : "Bỏ qua tin",
    );
    return;
  }

  // Ghi TRƯỚC khi xếp hàng, không đợi lượt agent chạy xong: thứ tự trong lịch
  // sử phải là thứ tự người ta gửi. Ảnh để lượt agent tải (nó AWAIT vì cần
  // `localPath` trước khi dựng nội dung cho model) rồi gắn vào chính dòng này.
  //
  // Nhờ ghi ở đây mà nhánh "chạm trần hàng chờ" bên dưới không còn phải tự ghi
  // lấy: trước đây `processBatch` là nơi DUY NHẤT ghi cho nhánh có-trả-lời nên
  // tin bị bỏ sẽ mất hẳn khỏi lịch sử, dù `sendDeliveredReceipt` đã báo "đã
  // nhận" và người ta đinh ninh bot có nghe.
  // Bọc try/catch vì bước này nay chạy TRƯỚC `enqueueMessage`: DB khoá hay đĩa
  // đầy mà ném ra thì tin không chỉ mất khỏi lịch sử, nó còn không bao giờ tới
  // được lượt trả lời. Ghi hỏng là chuyện đáng báo động nhưng vẫn phải trả lời
  // người ta - trước đây bước ghi nằm trong `try` của `processBatch` nên có sẵn
  // tính chất này.
  try {
    ghiTinDenVaoHistory(config.id, msg, { luuAnhNgay: false });
  } catch (err) {
    log.error({ accountId: config.id, threadId: msg.threadId, err }, "Không ghi được tin vào history - vẫn trả lời");
  }

  const threadKey = `${config.id}:${msg.threadId}`;
  const daNhan = enqueueMessage(threadKey, msg, (batch) => processBatch(config, api, batch));

  if (!daNhan) {
    // Tin đã nằm trong lịch sử rồi, nhưng KHÔNG lượt nào tải ảnh cho nó nữa -
    // phải tự tải, không thì dòng này mãi mãi không có đường dẫn ảnh
    if (msg.images.length > 0) {
      void persistBatchImages(config.id, [msg])
        .then(() => ganAnhVaoHistory([msg]))
        .catch((err) => log.debug({ threadId: msg.threadId, err }, "Không gắn được ảnh vào history"));
    }
    log.warn(
      { accountId: config.id, threadId: msg.threadId },
      "Tin bị bỏ khỏi lượt vì hàng chờ chạm trần - đã ghi vào history để bot còn biết",
    );
  }

  // Bot đã bận rất lâu thì nói một câu cho người ta biết vẫn đang làm. Hàm này
  // tự quyết có đáng gửi hay không (xem `busy-wait-notice.ts` - mặc định chỉ
  // gửi sau khi dấu "đang nhập..." đã tắt). Fire-and-forget và tự nuốt lỗi:
  // đây là việc phụ, không được làm chậm đường nhận tin.
  void maybeNotifyBusyWait({
    api,
    threadKey,
    threadId: msg.threadId,
    threadType: msg.threadType,
  }).catch((err) => log.debug({ threadId: msg.threadId, err }, "Gửi câu trấn an thất bại"));
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
