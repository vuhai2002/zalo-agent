import type { API, ThreadType } from "zca-js";
import { enqueueSend } from "../middleware/rate-limiter.js";
import { createLogger } from "../shared/logger.js";
import { splitLongMessage } from "./split-long-message.js";
import { getTuning } from "../config/runtime-tuning-settings.js";

/**
 * Gửi câu trả lời của agent xuống Zalo, cắt thành nhiều tin khi quá dài.
 *
 * Zalo chặn tin dài ở phía server (error_code 118 "Nội dung quá dài") và zca-js
 * ném thẳng lỗi lên - trước đây cả câu trả lời biến mất không dấu vết. Giờ cắt
 * theo ranh giới tự nhiên rồi gửi tuần tự qua rate-limiter (mỗi tin có delay
 * ngẫu nhiên sẵn nên chuỗi tin trông như người gõ nhiều dòng, không phải bot xả).
 */

const log = createLogger("send-reply");

/**
 * Câu trả lời khi bot hỏng giữa chừng. Im lặng bỏ treo người nhắn là hành vi
 * tệ nhất: họ không biết nên chờ hay nhắn lại.
 */
export const TECHNICAL_ERROR_REPLY =
  "Mình đang gặp trục trặc kỹ thuật nên chưa trả lời được tin này, bạn nhắn lại giúp mình sau ít phút nhé.";

export type ReplyTarget = {
  api: API;
  /** Khóa hàng đợi gửi của rate-limiter: `${accountId}:${threadId}` */
  threadKey: string;
  threadId: string;
  threadType: ThreadType;
};

export type ReplyResult = {
  /** Phần đã gửi được thật sự - ghi vào history đúng cái người dùng nhìn thấy */
  deliveredText: string;
  /** Số tin đã gửi */
  sentParts: number;
  /** Lỗi ở tin đầu tiên gửi hỏng (nếu có) - caller quyết định báo cho người dùng */
  error?: unknown;
};

/** Gửi 1 tin qua hàng đợi của thread (giữ thứ tự + delay ngẫu nhiên) */
function sendOne(target: ReplyTarget, text: string): Promise<unknown> {
  return enqueueSend(target.threadKey, () =>
    target.api.sendMessage({ msg: text }, target.threadId, target.threadType),
  );
}

/**
 * Cắt (nếu cần) rồi gửi lần lượt. Một tin hỏng thì dừng luôn phần còn lại -
 * gửi tiếp các đoạn sau sẽ ra một câu trả lời thủng lỗ chỗ, khó đọc hơn là
 * dừng và báo lỗi.
 */
export async function sendReplyInParts(target: ReplyTarget, text: string): Promise<ReplyResult> {
  const parts = splitLongMessage(text, {
    maxChars: getTuning("ZALO_MAX_MESSAGE_CHARS"),
    maxParts: getTuning("ZALO_MAX_MESSAGE_PARTS"),
  });

  if (parts.length === 0) return { deliveredText: "", sentParts: 0 };

  if (parts.length > 1) {
    log.info(
      { threadId: target.threadId, length: text.length, parts: parts.length },
      "Câu trả lời dài - cắt thành nhiều tin",
    );
  }

  const delivered: string[] = [];
  for (const part of parts) {
    try {
      await sendOne(target, part);
      delivered.push(part);
    } catch (err) {
      log.error(
        { threadId: target.threadId, partIndex: delivered.length + 1, total: parts.length, err },
        "Gửi tin thất bại",
      );
      return { deliveredText: delivered.join("\n"), sentParts: delivered.length, error: err };
    }
  }

  return { deliveredText: delivered.join("\n"), sentParts: delivered.length };
}

/**
 * Báo cho người nhắn biết bot đang hỏng. Tự nuốt lỗi: đây đã là đường cứu cánh,
 * hỏng nốt thì chỉ còn cách ghi log.
 */
export async function notifyTechnicalError(target: ReplyTarget): Promise<void> {
  try {
    await sendOne(target, TECHNICAL_ERROR_REPLY);
  } catch (err) {
    log.error({ threadId: target.threadId, err }, "Không gửi được cả thông báo lỗi");
  }
}
