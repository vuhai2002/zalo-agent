import type { API, ThreadType } from "zca-js";
import { createLogger } from "../shared/logger.js";
import type { ParsedMessage } from "./zalo-message-parser.js";

/**
 * Báo trạng thái "đã nhận" / "đã xem" về cho người gửi.
 *
 * Vì sao cần: bot đọc tin qua listener chứ không mở cửa sổ chat, nên Zalo không
 * tự bắn hai sự kiện này - phía người nhắn thấy tin dừng ở "Đã gửi" mãi mãi,
 * trông như bot đã chết. Client Zalo thật gửi "đã nhận" ngay khi tin về máy và
 * gửi "đã xem" khi người dùng mở hội thoại ra đọc; mình bám đúng nếp đó:
 * - deliverReceipt: MỌI tin nhận được, kể cả tin bot sẽ bỏ qua
 * - seenReceipt: chỉ tin bot thật sự xử lý (giống người mở chat lên đọc)
 *
 * Cả hai đều là best-effort: lỗi chỉ log debug, không bao giờ được làm chậm
 * hay chết đường trả lời (cùng nguyên tắc với auto-react).
 *
 * Chữ ký hàm zca-js đã đối chiếu source thật (`src/apis/sendSeenEvent.ts`,
 * `src/apis/sendDeliveredEvent.ts`): cần đủ 9 field dưới đây, và mọi tin trong
 * một lần gọi phải cùng thread.
 */

const log = createLogger("message-receipts");

/** Tối đa 50 tin mỗi lần gọi (MAX_MESSAGES_PER_SEND của zca-js) */
const MAX_MESSAGES_PER_CALL = 50;

type ReceiptParams = {
  msgId: string;
  cliMsgId: string;
  uidFrom: string;
  idTo: string;
  msgType: string;
  st: number;
  at: number;
  cmd: number;
  ts: string | number;
};

/**
 * Dựng tham số từ payload gốc. zca-js đã quy "0" về uid thật trong constructor
 * của Message nên lấy thẳng từ rawData là đúng - đừng tự bịa lại từ ParsedMessage.
 */
function toReceiptParams(msg: ParsedMessage): ReceiptParams | null {
  const raw = msg.rawData as Record<string, unknown>;
  const msgId = String(raw.msgId ?? "");
  const cliMsgId = String(raw.cliMsgId ?? "");
  const uidFrom = String(raw.uidFrom ?? "");
  const idTo = String(raw.idTo ?? "");
  if (!msgId || !uidFrom || !idTo) return null;

  return {
    msgId,
    cliMsgId: cliMsgId || msgId,
    uidFrom,
    idTo,
    msgType: String(raw.msgType ?? "webchat"),
    st: Number(raw.st ?? 0),
    at: Number(raw.at ?? 0),
    cmd: Number(raw.cmd ?? 0),
    ts: (raw.ts as string | number) ?? Date.now(),
  };
}

/** Gom batch thành tham số cùng thread; bỏ tin thiếu field bắt buộc */
function buildBatch(messages: ParsedMessage[]): {
  params: ReceiptParams[];
  threadType: ThreadType;
} | null {
  const first = messages[0];
  if (!first) return null;

  const params = messages
    .filter((m) => m.threadId === first.threadId)
    .slice(0, MAX_MESSAGES_PER_CALL)
    .map(toReceiptParams)
    .filter((p): p is ReceiptParams => p !== null);

  return params.length > 0 ? { params, threadType: first.threadType } : null;
}

/** "Đã nhận" - fire-and-forget, gọi ngay khi tin về tới listener */
export function sendDeliveredReceipt(api: API, message: ParsedMessage): void {
  const batch = buildBatch([message]);
  if (!batch) return;

  // isSeen = false: đây mới là "đã nhận", "đã xem" đi bằng sendSeenEvent riêng
  void api
    .sendDeliveredEvent(false, batch.params, batch.threadType)
    .catch((err) => log.debug({ threadId: message.threadId, err }, "Báo đã nhận thất bại"));
}

/** "Đã xem" - fire-and-forget, gọi khi bot bắt đầu xử lý lượt tin */
export function sendSeenReceipt(api: API, messages: ParsedMessage[]): void {
  const batch = buildBatch(messages);
  if (!batch) return;

  void api
    .sendSeenEvent(batch.params, batch.threadType)
    .catch((err) => log.debug({ threadId: messages[0]?.threadId, err }, "Báo đã xem thất bại"));
}
