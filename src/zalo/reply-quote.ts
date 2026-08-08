import type { SendMessageQuote } from "zca-js";
import type { ParsedMessage } from "./zalo-message-parser.js";

/**
 * Trích dẫn tin người dùng khi bot trả lời trong NHÓM.
 *
 * Vì sao cần: bot trả lời một lượt gộp, mà trong nhóm nhiều người cùng nhắn thì
 * không ai biết câu trả lời đang nhắm vào tin nào. Zalo có sẵn khối trích dẫn -
 * dùng nó là cách rẻ nhất để nói "câu này trả lời cho tin kia".
 *
 * goclaw làm đúng vậy và chỉ làm trong nhóm (`cmd/gateway_consumer_normal.go`:
 * `if isGroup { outMeta["reply_to_message_id"] = ... }`), kèm chú thích nói rõ
 * mục đích: "render a clear 'this reply is for X' signal". Chat riêng chỉ có
 * hai người nên trích dẫn là nhiễu - đó cũng là lựa chọn ở đây.
 *
 * Module THUẦN: không log, không đọc env, không chạm DB, không gọi mạng.
 */

/**
 * Các trường `SendMessageQuote` cần. Khai lại vì zca-js KHÔNG export `TMessage`
 * (chỉ export `SendMessageQuote`), mà `rawData` của mình là `Record<string,
 * unknown>` nên phải tự kiểm từng trường thay vì ép kiểu cả cục.
 */
type TruongTinGoc = {
  content?: unknown;
  msgType?: unknown;
  propertyExt?: unknown;
  uidFrom?: unknown;
  msgId?: unknown;
  cliMsgId?: unknown;
  ts?: unknown;
  ttl?: unknown;
};

/**
 * Loại tin này trích dẫn được không.
 *
 * Hai điều kiện dưới đây SAO CHÉP đúng phần kiểm của zca-js
 * (`src/apis/sendMessage.ts`, khối `if (quote)` trong `handleMessage`):
 *
 *   if (typeof quote.content != "string" && quote.msgType == "webchat") throw
 *   if (quote.msgType == "group.poll") throw
 *
 * Phải lọc TRƯỚC chứ không đợi bắt lỗi: zca-js ném `ZaloApiError` KHÔNG kèm mã
 * số cho hai ca này, mà `laLoiMayChuTuChoi` nhận diện lỗi máy chủ bằng chính
 * `typeof err.code === "number"`. Lỗi không mã sẽ bị ném thẳng lên và cả câu
 * trả lời mất trắng - đúng lớp hỏng đã trả giá ngày 05/08 với tổ hợp style.
 *
 * Bản zca-js sau này thêm điều kiện thứ ba thì chỗ này lạc hậu. Đó là lý do
 * đường lui ở `send-reply-in-parts.ts` vẫn bỏ trích dẫn khi máy chủ từ chối:
 * hai lớp, không phải một.
 */
export function laLoaiTrichDanDuoc(msgType: string, content: unknown): boolean {
  if (msgType === "group.poll") return false;
  if (msgType === "webchat" && typeof content !== "string") return false;
  return true;
}

/**
 * Dựng trích dẫn từ một tin đã nhận. `undefined` = không trích (và đó là nhánh
 * bình thường, không phải lỗi).
 *
 * Nhận tin nào là quyết định của caller. `message-turn-processor.ts` truyền tin
 * ĐẦU batch - tin mở lượt, thường mang câu hỏi chính, và không xê dịch khi có
 * tin chen giữa lượt.
 */
export function trichDanTuTin(msg: ParsedMessage): SendMessageQuote | undefined {
  // Chat riêng: hai người, trích dẫn không thêm thông tin gì
  if (!msg.isGroup) return undefined;

  const goc = msg.rawData as TruongTinGoc;
  const msgType = typeof goc.msgType === "string" ? goc.msgType : "";
  if (!msgType || !laLoaiTrichDanDuoc(msgType, goc.content)) return undefined;

  // `ts` về dạng chuỗi trong payload thật nhưng nhận cả số cho chắc
  const ts = typeof goc.ts === "string" || typeof goc.ts === "number" ? String(goc.ts) : "";
  const msgId = typeof goc.msgId === "string" ? goc.msgId : "";
  const cliMsgId = typeof goc.cliMsgId === "string" ? goc.cliMsgId : "";
  const uidFrom = typeof goc.uidFrom === "string" ? goc.uidFrom : "";

  // Thiếu một trong bốn định danh là Zalo không tìm ra tin gốc. Đây cũng là cửa
  // chặn tin TỔNG HỢP của lượt theo lịch (`buildSyntheticMessage` để msgId rỗng
  // có chủ đích) - không có tin thật nào để mà trích.
  if (!ts || !msgId || !cliMsgId || !uidFrom) return undefined;

  // Ép kiểu cả object ở ĐÂY, sau khi đã kiểm từng trường: `content` và
  // `propertyExt` là union rộng của zca-js, kiểm sâu hơn cũng không thêm an
  // toàn vì chúng được chuyển tiếp nguyên vẹn.
  return { content: goc.content, msgType, propertyExt: goc.propertyExt, uidFrom, msgId, cliMsgId, ts, ttl: typeof goc.ttl === "number" ? goc.ttl : 0 } as SendMessageQuote;
}

/**
 * Trích dẫn chiếm bao nhiêu byte trên đường dây.
 *
 * ƯỚC LƯỢNG THỪA có chủ đích: zca-js rải các trường này ra `qmsg`, `qmsgAttach`,
 * `qmsgOwner`... còn đây đo cả object dạng JSON. Thừa thì chỉ tốn thêm một chỗ
 * cắt, thiếu thì tin đầu vượt trần và bị Zalo chối - hai hậu quả không cùng cỡ.
 */
export function soByteTrichDan(quote: SendMessageQuote): number {
  return Buffer.byteLength(JSON.stringify(quote), "utf8");
}

/**
 * Trích dẫn dài nhất được phép, tính theo phần của trần byte.
 *
 * Vì sao phải có trần riêng: `chiaTheoNganSachByte` chia chữ của BOT theo ngân
 * sách byte, nó không biết gì về phần trích dẫn cộng thêm. Người ta dán một
 * đoạn 4000 ký tự rồi bot trích lại là riêng khối trích dẫn đã vượt trần, mà
 * bộ cắt thì vẫn báo mọi đoạn đều lọt.
 */
const TY_LE_TOI_DA = 0.3;

/**
 * Chốt xem có trích dẫn được trong ngân sách không, và trần byte còn lại cho
 * chữ của bot.
 *
 * Trừ trần cho MỌI đoạn chứ không riêng đoạn đầu (chỉ đoạn đầu mang trích dẫn):
 * cách này hơi rộng tay, nhiều nhất là đẻ thêm một đoạn cho câu trả lời dài.
 * Đổi lại `chiaTheoNganSachByte` không phải biết tới khái niệm "ngân sách riêng
 * cho đoạn đầu" - một tham số mà chỉ một caller dùng tới.
 */
export function trichDanTrongNganSach(
  quote: SendMessageQuote | undefined,
  tranByte: number,
): { quote?: SendMessageQuote; tranConLai: number; boViQuaDai: boolean } {
  if (!quote) return { tranConLai: tranByte, boViQuaDai: false };

  const chiPhi = soByteTrichDan(quote);
  if (chiPhi > tranByte * TY_LE_TOI_DA) {
    return { tranConLai: tranByte, boViQuaDai: true };
  }
  return { quote, tranConLai: tranByte - chiPhi, boViQuaDai: false };
}
