/**
 * Đổi tên hiển thị tiếng Việt thành ID kebab-case cho agent.
 *
 * Đây là chỗ DUY NHẤT trong dự án được phép bỏ dấu tiếng Việt: ID agent phải
 * khớp `^[a-z0-9][a-z0-9-]*$` (xem `createSchema` ở `agent-routes.ts`). Mọi chỗ
 * khác giữ nguyên dấu.
 *
 * Bẫy chính: `"đ".normalize("NFD")` KHÔNG tách ra `d` + dấu. `đ`/`Đ`
 * (U+0111/U+0110) là chữ cái riêng trong bảng chữ cái, không phải chữ nền cộng
 * dấu tổ hợp - khác hẳn `ă â ê ô ơ ư` vốn tách được. Không thay tường minh
 * TRƯỚC khi normalize thì "Đặng" ra `ang` (chữ Đ rơi vào nhánh "ký tự lạ" rồi
 * thành dấu gạch, sau đó bị cắt ở đầu chuỗi).
 *
 * Hàm thuần, không import gì - chạy được cả trong test Node lẫn trình duyệt.
 */

/** Dấu tổ hợp Unicode: đủ cho mọi thanh điệu và dấu mũ/móc tiếng Việt */
const DAU_TO_HOP = /[̀-ͯ]/g;

/**
 * Trần độ dài ID. Tên dài không giới hạn nhưng ID thì nên đọc được và nằm gọn
 * trong URL `/agents/:id`.
 */
const DAI_TOI_DA = 60;

export function slugifyVietnamese(input: string): string {
  const khongDau = input
    // Phải đứng TRƯỚC normalize - xem giải thích ở đầu file
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFD")
    .replace(DAU_TO_HOP, "");

  return (
    khongDau
      .toLowerCase()
      // Mọi thứ không phải chữ/số thành một dấu gạch (gộp luôn dãy liên tiếp)
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, DAI_TOI_DA)
      // Cắt gạch thừa SAU khi cắt độ dài, để cắt giữa chừng không để lại đuôi "-"
      .replace(/^-+|-+$/g, "")
  );
}
