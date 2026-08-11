import { ThreadType } from "zca-js";
import type { IncomingImage, ParsedMessage } from "../zalo/zalo-message-parser.js";
import type { ZaloBotUpdate } from "./zalo-bot-api-types.js";

/**
 * Đổi một update của Zalo Bot API sang `ParsedMessage` - hình dạng tin chuẩn
 * mà cả hệ đang dùng (bộ gộp tin, agent loop, history đều nhận kiểu này).
 *
 * Đây là chỗ DUY NHẤT biết hình dạng dữ liệu của Bot API, nhờ vậy phần còn lại
 * của hệ không phải phân biệt tin đến từ kênh nào.
 *
 * Vẫn dùng `ThreadType` của zca-js cho `threadType` để KHÔNG phải đổi kiểu
 * chung ngay lúc này: `ThreadType.User`/`ThreadType.Group` chỉ là 0/1, mang
 * đúng ngữ nghĩa cần, và đổi kiểu chung là việc đụng 34 file - để nguyên cho
 * tới khi đường bot chạy thật rồi mới gom một lần.
 */

/**
 * Nhãn cho loại tin không mang chữ. Bot API gửi sticker/voice/loại lạ mà không
 * có `text` - trả chuỗi rỗng thì lượt agent chạy trên một tin trắng.
 */
function nhanLoaiTinKhongCoChu(
  eventName: string,
  m: NonNullable<ZaloBotUpdate["message"]>,
): string {
  if (eventName === "message.sticker.received" || m.sticker) return "[gửi một sticker]";
  if (eventName === "message.voice.received" || m.voice_url) return "[gửi một tin thoại]";
  // Ảnh MOI ĐƯỢC url thì để trống - nó đã nằm trong `images`, gắn nhãn là thừa.
  if (m.photo || m.photo_url) return "";
  // Ảnh mà KHÔNG moi được url (Zalo đổi tên trường) thì PHẢI có nhãn: chuỗi
  // rỗng + `images` rỗng làm `shouldRespond` trả `skip` với `record: false`,
  // tức tin không vào history và chỉ để lại một dòng debug. Trên kênh không có
  // `offset` thì đó là mất tin vĩnh viễn, im lặng tuyệt đối - mà lưới đỡ
  // `reportPayloadAnomalies` cũng không bắt được vì nhánh ảnh của nó đọc
  // `rawData.msgType`, trường của zca-js không tồn tại ở đây.
  if (eventName === "message.image.received") return "[gửi một ảnh bot chưa đọc được]";
  return "[gửi một nội dung bot chưa đọc được]";
}

/** Ảnh của Bot API nằm ở `photo`, bản port của goclaw đọc thêm `photo_url` */
function layAnh(msg: NonNullable<ZaloBotUpdate["message"]>): IncomingImage[] {
  const url = msg.photo || msg.photo_url;
  return url ? [{ url }] : [];
}

export function doiUpdateSangParsedMessage(
  accountId: string,
  update: ZaloBotUpdate,
): ParsedMessage | null {
  const m = update.message;
  if (!m) return null;

  // Bot KHÔNG xử lý tin của chính mình hay của bot khác - vào vòng agent là
  // dễ thành vòng lặp hai bot nói chuyện với nhau không dứt.
  if (m.from?.is_bot) return null;

  const laNhom = m.chat?.chat_type === "GROUP";

  // `date` là MILIGIÂY (tài liệu webhook), khác Telegram dùng giây. Nhân nhầm
  // 1000 lần nữa là nhãn giờ trong prompt nhảy sang năm 57xxx mà không ai thấy
  // ngay - `sentAt` chỉ hiện dưới dạng "[dd/mm hh:mm]".
  const sentAt = Number.isFinite(m.date) && m.date > 0
    ? new Date(m.date).toISOString()
    : new Date().toISOString();

  // Sticker, tin thoại và `message.unsupported.received` KHÔNG có `text` lẫn
  // `caption`. Để trống là dựng ra một lượt agent trắng trơn: model nhận một
  // tin rỗng, không hiểu chuyện gì vừa xảy ra, và trả lời vu vơ. Nhãn tường
  // minh cho nó biết người ta vừa gửi cái gì mà bot không đọc được.
  const chu = m.text ?? m.caption ?? nhanLoaiTinKhongCoChu(update.event_name, m);

  return {
    accountId,
    threadId: m.chat?.id ?? m.from?.id ?? "",
    threadType: laNhom ? ThreadType.Group : ThreadType.User,
    isGroup: laNhom,
    senderId: m.from?.id ?? "",
    senderName: m.from?.display_name ?? "",
    text: chu,
    images: layAnh(m),
    msgId: m.message_id ?? "",
    // Bot API không có khái niệm client message id. Dùng chung `message_id` để
    // các phép khử trùng dựa trên cặp (msgId, cliMsgId) vẫn hoạt động.
    cliMsgId: m.message_id ?? "",
    isSelf: false,
    // Trong NHÓM, Zalo chỉ đẩy sự kiện khi bot bị @mention hoặc khi ai đó
    // reply tin của bot - tài liệu ghi rõ vậy. Nên tin nhóm nào tới được đây
    // thì ĐÃ là tin nhắm vào bot, không cần lớp lọc mention riêng như kênh
    // cá nhân. (Tính năng nhóm còn đang thử nghiệm nội bộ phía Zalo.)
    mentionsMe: true,
    sentAt,
    rawData: { ...m },
  };
}
