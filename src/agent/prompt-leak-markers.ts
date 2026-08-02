/**
 * Những mẩu chữ ĐẶC TRƯNG của system prompt nội bộ - dùng chung giữa nơi SINH
 * ra chúng (`persona-prompt.ts`, `wrap-untrusted-content.ts`) và nơi CANH chúng
 * (`zalo/sanitize-reply-text.ts`).
 *
 * Một nguồn duy nhất vì hai bên phải khớp từng ký tự: sửa lời persona mà quên
 * sửa bộ canh thì lớp chặn rò prompt im lặng ngừng hoạt động, và không có gì
 * đỏ lên. Đây đúng lớp lỗi mà dự án đã dính một lần với `tool-loop-guard`.
 *
 * Module THUẦN: 0 import.
 */

/**
 * Tên thẻ bọc nội dung ngoài. `wrapUntrustedContent` đổi MỌI lần xuất hiện của
 * chuỗi này trong nội dung web thành `noi-dung-ngoai` (gạch ngang) trước khi
 * bọc, nên một trang web không thể tự làm câu trả lời chứa nó - dấu hiệu này
 * gần như chỉ có thể tới từ chính system prompt.
 *
 * Ngoại lệ đã biết: người dùng gõ thẳng chuỗi này vào Zalo rồi bot nhại lại.
 * Chấp nhận chặn nhầm ca đó - người gõ đúng tên thẻ nội bộ là đang dò, không
 * phải đang hỏi chuyện.
 */
export const THE_NOI_DUNG_NGOAI = "noi_dung_ngoai";

/** Tiêu đề mục an toàn trong `BASE_PERSONA` */
export const TIEU_DE_QUY_TAC_AN_TOAN = "Quy tắc an toàn (tuyệt đối, không có ngoại lệ):";

/** Mở đầu mục liệt kê tool, do `persona-prompt.ts` sinh theo từng lượt */
export const TIEU_DE_KHA_NANG = "Khả năng của bạn lúc này";

/**
 * Bộ dấu hiệu để KẾT LUẬN câu trả lời đã rò system prompt.
 *
 * Chọn loại RẤT ĐẶC TRƯNG, không phải từ thường gặp: chặn nhầm một câu trả lời
 * hợp lệ còn khó chịu hơn lọt một câu rò, vì người dùng mất hẳn nội dung mà
 * không hiểu vì sao. Cả ba chuỗi dưới đây đều không phải thứ ai đó vô tình viết
 * trong lúc nhắn tin bình thường.
 */
export const DAU_HIEU_RO_PROMPT: readonly string[] = [
  `<${THE_NOI_DUNG_NGOAI}`,
  TIEU_DE_QUY_TAC_AN_TOAN,
  TIEU_DE_KHA_NANG,
];
