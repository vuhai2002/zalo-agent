import { lamSachTraLoi } from "../../zalo/sanitize-reply-text.js";

/**
 * Làm sạch CAPTION do model viết trước khi nó thành một tin Zalo thật.
 *
 * Bốn tool gửi file/ảnh (`send_file`, `create_word_document`,
 * `create_excel_file`, `create_image`) đều gọi thẳng `api.sendMessage` với
 * `msg: caption`. Đó là chữ của MODEL đi xuống Zalo mà không qua lớp làm sạch
 * nào - đúng lối đi vòng mà `tag_member` đã bị bịt, chỉ khác là bốn chỗ này bị
 * bỏ sót ở vòng trước.
 *
 * Hậu quả cụ thể: model gửi file kèm caption `**Báo giá tháng 8** - xem
 * [chi tiết](https://...)` thì người dùng nhận nguyên ký tự markdown.
 *
 * Khác `tag_member` ở nhánh CHẶN: caption chỉ là lời nhắn kèm, còn file thì đã
 * dựng xong và sắp gửi. Chặn cả lượt vì một dòng caption là ném đi phần việc
 * nặng nhất, nên ở đây chỉ BỎ caption và vẫn gửi file - người dùng vẫn nhận
 * được thứ họ cần.
 */
export function capTionSach(caption: string | undefined): string | undefined {
  if (!caption?.trim()) return caption;

  const sach = lamSachTraLoi(caption);
  if (sach.chan) return undefined;
  return sach.text.trim() || undefined;
}
