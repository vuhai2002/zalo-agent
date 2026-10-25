import type { TieuDeGhiChu } from "../conversation/verbatim-note-store.js";
import { THE_GHI_CHU_DA_LUU as THE } from "./prompt-leak-markers.js";

/**
 * Khối TÊN các ghi chú nguyên văn người đang nhắn đã nhờ lưu.
 *
 * Chỉ đưa TÊN, không đưa nội dung - nội dung đọc bằng tool `verbatim_note`
 * action 'doc' khi người dùng hỏi tới. Cùng lý do Kho tri thức nạp bằng tool:
 * lượt không đụng tới ghi chú thì không phải gánh cả đoạn dài. Tên ít đổi nên
 * khối này không phá prompt cache.
 *
 * Tên dán TRẦN, không ngoặc, không kèm số ký tự: đo trên model thật, dòng kiểu
 * `- "Tên" (688 ký tự)` làm model chép tên rồi lệch đuôi ("...khóa thiền nero").
 * Dán trần được vì tên đã siết charset lúc lưu (`verbatim-note-tool.ts`): không
 * có `<`, xuống dòng hay ký tự ẩn.
 *
 * Module THUẦN.
 */
export function khoiGhiChuDaLuu(ghiChu: readonly TieuDeGhiChu[]): string {
  if (ghiChu.length === 0) return "";
  const dong = ghiChu.map((g) => `- ${g.title}`).join("\n");
  return [
    `<${THE}>`,
    "Ghi chú NGUYÊN VĂN người đang nhắn đã nhờ lưu, mỗi dòng một tên. Khi họ hỏi tới, gọi tool verbatim_note action 'doc' với ĐÚNG tên đó (chép nguyên, không thêm bớt chữ nào), rồi gửi lại nội dung đúng từng chữ:",
    dong,
    `</${THE}>`,
  ].join("\n");
}
