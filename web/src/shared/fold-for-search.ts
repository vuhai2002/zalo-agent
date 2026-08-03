/**
 * Gấp chuỗi về dạng dễ so khớp khi TÌM KIẾM: thường hóa + bỏ dấu tiếng Việt.
 *
 * Đây là ngoại lệ thứ hai (cùng với `slugify-vietnamese.ts`) được phép bỏ dấu,
 * và chỉ vì một lý do hẹp: người dùng gõ "ho chi minh" phải ra "Hồ Chí Minh".
 * Kết quả của hàm này KHÔNG BAO GIỜ được hiển thị hay lưu - nó chỉ đi vào phép
 * so sánh rồi bị vứt. Chuỗi hiện trên màn hình luôn là bản gốc còn nguyên dấu.
 *
 * `đ`/`Đ` phải thay TƯỜNG MINH trước `normalize("NFD")`: chúng là chữ cái riêng
 * trong bảng chữ cái chứ không phải chữ nền cộng dấu tổ hợp, nên NFD không tách
 * ra được (cùng cái bẫy đã ghi ở `slugify-vietnamese.ts`).
 *
 * Hàm thuần, không import gì.
 */

/** Dấu tổ hợp Unicode: đủ cho mọi thanh điệu và dấu mũ/móc tiếng Việt */
const DAU_TO_HOP = /[̀-ͯ]/g;

export function foldForSearch(input: string): string {
  return input
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFD")
    .replace(DAU_TO_HOP, "")
    .toLowerCase()
    .trim();
}

/**
 * Nhãn có khớp từ khóa không - tách rời khỏi component để test được mà không
 * cần dựng DOM. Mỗi tiếng trong từ khóa phải xuất hiện đâu đó trong nhãn, không
 * bắt buộc liền nhau: gõ "ho chi" vẫn ra "Asia/Ho_Chi_Minh", gõ "minh ho" cũng
 * vậy - người dùng không nhớ đúng thứ tự thì vẫn tìm được.
 */
export function nhanKhopTuKhoa(nhan: string, tuKhoa: string): boolean {
  const kim = foldForSearch(tuKhoa);
  if (!kim) return true;
  const dong = foldForSearch(nhan);
  return kim.split(/\s+/).every((tieng) => dong.includes(tieng));
}
