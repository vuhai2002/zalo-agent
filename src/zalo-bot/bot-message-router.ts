import { getAccount } from "../config/account-store.js";
import { recordContactActivity } from "../conversation/contact-store.js";
import { persistBatchImages } from "../conversation/media-store.js";
import { isBotEnabled, recordThreadActivity } from "../conversation/thread-store.js";
import { shouldRespond } from "../middleware/allowlist-filter.js";
import { enqueueMessage } from "../middleware/message-batcher.js";
import { createLogger } from "../shared/logger.js";
import { maybeNotifyBusyWait } from "../zalo/busy-wait-notice.js";
import type { KenhLuot } from "../zalo/kenh-luot.js";
import { processBatch } from "../zalo/message-turn-processor.js";
import { ganAnhVaoHistory, ghiTinDenVaoHistory } from "../zalo/record-incoming-message.js";
import { reportPayloadAnomalies } from "../zalo/payload-anomaly-watch.js";
import { doiUpdateSangParsedMessage } from "./zalo-bot-update-parser.js";
import type { ZaloBotUpdate } from "./zalo-bot-api-types.js";

const log = createLogger("bot-message-router");

/**
 * Đường nhận tin của kênh TÀI KHOẢN BOT.
 *
 * Bản riêng chứ không dùng chung `incoming-message-router.ts`: router kia gọi
 * ba thứ Bot API KHÔNG có - biên nhận "đã nhận", thả cảm xúc tự động, và
 * `getGroupInfo` để tra tên nhóm. Nhét ba nhánh `if (kenh có...)` vào router
 * đang phục vụ tài khoản thật là thêm bề mặt hỏng cho kênh đang chạy, đổi lấy
 * việc tiết kiệm khoảng ba mươi dòng.
 *
 * Phần DÙNG CHUNG thì dùng chung thật, không chép: `shouldRespond`,
 * `ghiTinDenVaoHistory`, `enqueueMessage`, `processBatch`, `maybeNotifyBusyWait`.
 */
export function routeBotUpdate(accountId: string, kenh: KenhLuot, update: ZaloBotUpdate): void {
  const config = getAccount(accountId);
  if (!config) return;

  const msg = doiUpdateSangParsedMessage(config.id, update);
  if (!msg) {
    // Tin của bot khác, hoặc update không mang message nào. Debug thôi - đây là
    // chuyện bình thường, nhưng im lặng tuyệt đối thì không lần ra được khi
    // Zalo đổi hình dạng payload.
    log.debug({ accountId: config.id, eventName: update.event_name }, "Bỏ qua update");
    return;
  }

  // Chạy TRƯỚC nhánh return bên dưới: tin thiếu threadId bị bỏ ngay dòng dưới,
  // không cảnh báo ở đây thì không còn chỗ nào biết. Zalo đổi tên `chat.id` là
  // MỌI tin bị nuốt vĩnh viễn trong im lặng - mà kênh này không có `offset` để
  // lấy lại, nên hậu quả nặng hơn hẳn bên kênh cá nhân.
  reportPayloadAnomalies(config.id, msg);
  if (!msg.threadId) return;

  recordContactActivity(config.id, msg.senderId, msg.senderName);
  recordThreadActivity({
    accountId: config.id,
    threadId: msg.threadId,
    threadType: msg.threadType,
    // Bot API KHÔNG có method đọc thông tin nhóm (`getChat` trả 404), nên tên
    // nhóm để trống - dashboard sẽ hiện id. Kênh cá nhân tra được nên có tên.
    displayName: msg.isGroup ? "" : msg.senderName,
    lastSenderName: msg.senderName,
  });

  const decision = shouldRespond(config, msg, isBotEnabled(config.id, msg.threadId));

  if (!decision.respond) {
    if (decision.record) ghiTinDenVaoHistory(config.id, msg, { luuAnhNgay: true });
    log.debug(
      { accountId: config.id, threadId: msg.threadId, reason: decision.reason },
      decision.record ? "Ghi passive, không trả lời" : "Bỏ qua tin",
    );
    return;
  }

  // Ghi TRƯỚC khi xếp hàng, cùng lý do với kênh cá nhân: thứ tự trong lịch sử
  // phải là thứ tự người ta gửi, và lượt chết giữa chừng không đánh rơi tin.
  // Với kênh bot còn một lý do nữa, nặng hơn: `getUpdates` KHÔNG có tham số
  // `offset` để xác nhận đã đọc, nên tin đã lấy về là MẤT khỏi hàng chờ của
  // Zalo. Không ghi ngay thì tiến trình chết ở đây là tin biến mất vĩnh viễn.
  try {
    ghiTinDenVaoHistory(config.id, msg, { luuAnhNgay: false });
  } catch (err) {
    log.error({ accountId: config.id, threadId: msg.threadId, err }, "Không ghi được tin vào history - vẫn trả lời");
  }

  const threadKey = `${config.id}:${msg.threadId}`;
  const daNhan = enqueueMessage(threadKey, msg, (batch) => processBatch(config, kenh, batch));

  if (!daNhan) {
    // Tin đã nằm trong lịch sử rồi, nhưng KHÔNG lượt nào tải ảnh cho nó nữa -
    // phải tự tải, không thì dòng này mãi mãi không có đường dẫn ảnh. Kênh bot
    // CÓ nhận ảnh (Bot API đưa tới dạng URL) nên nhánh này không bỏ được.
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

  void maybeNotifyBusyWait({
    guiMotDoan: kenh.duongGui(msg.threadId, msg.threadType),
    threadKey,
    threadId: msg.threadId,
    threadType: msg.threadType,
  }).catch((err) => log.debug({ threadId: msg.threadId, err }, "Gửi câu trấn an thất bại"));
}
