import type { API } from "zca-js";
import { kenhCaNhan } from "./kenh-ca-nhan.js";
import { replyTargetTuKenh } from "./reply-target-tu-kenh.js";
import { getAccount, type AccountConfig } from "../config/account-store.js";
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
import { parseIncomingMessage, type ParsedMessage } from "./zalo-message-parser.js";
import { daCoTinDen } from "../conversation/khu-trung-tin-den.js";
import { layBuCuaAccount } from "./offline-replay/lay-bu-registry.js";

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

  const ketQua = nhanVaGhiTinDen(config, api, msg);
  const layBu = layBuCuaAccount(config.id);
  // Tin trực tiếp mới (không trùng, không self) đẩy mốc lấy bù khi hàng chờ Zalo đã bắt kịp
  if (layBu && ketQua !== "trung" && !msg.isSelf && msg.threadId) layBu.khiTinTrucTiep(msg);
  if (ketQua !== "tra-loi") return;
  // Người này còn tin lấy bù đang chờ trả lời trễ: đẩy chúng vào bộ gộp TRƯỚC tin
  // này để một lượt thấy cả hai (lượt vẫn mang cờ trễ nên vẫn có câu xin lỗi)
  layBu?.nhaNgay(`${config.id}:${msg.threadId}`);
  xepHangTraLoi(config, api, msg);
}

/**
 * Bước "nhận + lọc + ghi" của MỌI tin đến, dùng chung cho tin trực tiếp và tin
 * lấy bù (`offline-replay/`): biên nhận "đã nhận", danh bạ/thread, bộ lọc, ghi
 * lịch sử. Trả quyết định để caller tự xếp hàng trả lời - tin trực tiếp vào thẳng
 * bộ gộp, tin lấy bù vào hàng chờ trả lời trễ.
 *
 * Khử trùng nằm TRONG hàm (không ở caller): mọi đường vào đều đi qua đây, nên
 * không caller nào quên được.
 */
export function nhanVaGhiTinDen(
  config: AccountConfig,
  api: API,
  msg: ParsedMessage,
): "trung" | "bo" | "ghi-thu-dong" | "tra-loi" {
  // Cùng một tin tới hai lần (cmd 501 và 551; trực tiếp và trong trang lấy bù):
  // bỏ lần sau, kể cả biên nhận - ghi hai dòng là model đọc hai lần, trả lời hai lần
  if (msg.msgId && msg.threadId && daCoTinDen(config.id, msg.threadId, msg)) {
    log.debug({ accountId: config.id, threadId: msg.threadId }, "Tin trùng mã đã có trong lịch sử - bỏ");
    return "trung";
  }

  // Chạy TRƯỚC mọi nhánh return bên dưới: tin thiếu threadId bị bỏ qua lặng lẽ
  // ở ngay dòng dưới, không cảnh báo ở đây thì không còn chỗ nào biết
  reportPayloadAnomalies(config.id, msg);

  if (!msg.isSelf && msg.threadId) {
    // "Đã nhận" cho MỌI tin về tới listener, kể cả tin sắp bị lọc - client Zalo
    // thật cũng báo nhận tự động, không phụ thuộc người dùng có đọc hay không.
    // Trừ tin LẤY BÙ: một lượt có thể chở hàng trăm tin cũ, bắn từng biên nhận một
    // trong vài giây là tải dồn dập; lượt trả lời trễ vẫn gửi "đã xem" theo batch.
    if (!msg.layBu) sendDeliveredReceipt(api, msg);
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
    return decision.record ? "ghi-thu-dong" : "bo";
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
  return "tra-loi";
}

/** Tin trực tiếp đủ điều kiện trả lời: vào bộ gộp, câu trấn an khi bắt chờ lâu */
function xepHangTraLoi(config: AccountConfig, api: API, msg: ParsedMessage): void {
  const threadKey = `${config.id}:${msg.threadId}`;
  const daNhan = enqueueMessage(threadKey, msg, (batch) => processBatch(config, kenhCaNhan(api), batch));

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
  //
  // Dựng đích qua `replyTargetTuKenh` chứ không viết tay: các trường mang theo
  // (`tranKyTuMotTin`, `mangDinhDang`) đều TÙY CHỌN nên quên là trình biên
  // dịch im lặng. Ở đây mặc định của kênh cá nhân vốn đã đúng, nhưng đây là
  // chỗ CUỐI CÙNG còn dựng đích bằng tay - để nguyên là chừa lại đúng một khe
  // cho lần thêm trường tiếp theo.
  void maybeNotifyBusyWait(
    replyTargetTuKenh({
      kenh: kenhCaNhan(api),
      threadId: msg.threadId,
      threadType: msg.threadType,
      threadKey,
    }),
  ).catch((err) => log.debug({ threadId: msg.threadId, err }, "Gửi câu trấn an thất bại"));
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
