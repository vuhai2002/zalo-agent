/**
 * Bỏ dấu tiếng Việt: dùng cho cột `phang` (index FTS5 của kb_chunks) và cho câu
 * hỏi của khách ở phase 03 trước khi tìm - FTS5 không tự biết "hoa hồng" và
 * "hoa hong" là cùng một cụm.
 *
 * Chữ `đ`/`Đ` phải thay TƯỜNG MINH bằng phép thay chuỗi TRƯỚC `normalize("NFD")`:
 * U+0111 là một chữ cái riêng trong bảng chữ cái (có gạch ngang), không phải chữ
 * nền cộng dấu phụ tổ hợp, nên NFD không tách nó ra được - đã đo.
 *
 * Hàm thuần, không import gì.
 */

// Dấu phụ tổ hợp Unicode (thanh điệu + dấu mũ/móc): khối U+0300-U+036F. Dựng
// bằng mã số (fromCharCode) thay vì dán ký tự tổ hợp trần hay gõ chuỗi thoát
// \u vào file nguồn - cả hai cách đều khiến editor/công cụ hiển thị dính liền
// vào ký tự đứng trước, khó đọc và dễ hỏng câm khi ai đó sửa lại sau này.
const MA_DAU_PHU_BAT_DAU = 0x0300;
const MA_DAU_PHU_KET_THUC = 0x036f;
const DAU_PHU_TO_HOP = new RegExp(
  `[${String.fromCharCode(MA_DAU_PHU_BAT_DAU)}-${String.fromCharCode(MA_DAU_PHU_KET_THUC)}]`,
  "g",
);

export function boDauTiengViet(s: string): string {
  return s.normalize("NFD").replace(DAU_PHU_TO_HOP, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}
