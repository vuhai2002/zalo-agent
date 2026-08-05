import type { Style } from "zca-js";
import { getTuning } from "../../config/runtime-tuning-settings.js";
import { markdownSangStyleZalo } from "../../zalo/markdown-to-zalo-styles.js";
import { lamSachGiuDinhDang, lamSachTraLoi } from "../../zalo/sanitize-reply-text.js";

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

/**
 * Phần tin của một lượt gửi kèm file: chữ đã làm sạch + định dạng Zalo.
 *
 * Vì sao caption cũng cần định dạng: nó là một TIN ZALO THẬT như mọi tin khác,
 * và caption đúng là chỗ hay có số liệu cần nổi bật ("Báo giá **tháng 8**").
 * Bỏ qua nó thì file gửi kèm lại là tin duy nhất còn chữ phẳng.
 *
 * KHÔNG cắt nhiều đoạn ở đây: caption phải đi cùng chuyến với file đính kèm,
 * chẻ ra là file rơi mất khỏi tin có chữ. Caption vốn ngắn nên không đáng lo.
 */
export function tinKemFile(caption: string | undefined): { msg: string; styles?: Style[] } {
  if (!getTuning("ZALO_RICH_TEXT_ENABLED")) return { msg: capTionSach(caption) ?? "" };
  if (!caption?.trim()) return { msg: "" };

  const sach = lamSachGiuDinhDang(caption);
  if (sach.chan) return { msg: "" };

  const { text, styles } = markdownSangStyleZalo(sach.text);
  const chu = text.trim();
  if (!chu) return { msg: "" };
  // `.trim()` ở trên dời chữ nên mốc style hết đúng - chỉ đính style khi không
  // có gì bị cắt ở đầu/cuối. Caption của model gần như luôn sạch hai đầu; ca
  // hiếm còn lại thì mất định dạng chứ không tô nhầm chỗ.
  return chu === text && styles.length > 0 ? { msg: chu, styles } : { msg: chu };
}
