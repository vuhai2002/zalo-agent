/**
 * Kiểm từng ô của form agent NGAY TRÊN CLIENT, khớp đúng giới hạn của
 * `patchSchema` ở `src/server/routes/agent-routes.ts`.
 *
 * Có các hàm này vì server gộp mọi lỗi zod thành đúng một câu "Dữ liệu không
 * hợp lệ" và `request()` vứt mảng `issues` - nên nếu để server bắt thì người
 * dùng chỉ nhận một câu chung chung, không biết ô nào sai.
 *
 * File riêng (không nằm trong section hay trong `agent-detail-form.ts`) để cả
 * hai bên cùng import mà không tạo vòng import.
 *
 * Quy ước chung: trả chuỗi RỖNG nghĩa là hợp lệ. Ô rỗng luôn hợp lệ vì nó mang
 * nghĩa "theo Cấu hình chung".
 */

/** Khớp `patchSchema.maxSteps`: số nguyên 1-30 */
export function kiemSoBuoc(raw: string): string {
  const s = raw.trim();
  if (s === "") return "";
  if (!/^\d+$/.test(s)) return "Chỉ nhập số nguyên, hoặc để trống để theo Cấu hình chung";
  const n = Number(s);
  if (n < 1 || n > 30) return "Phải trong khoảng 1 - 30";
  return "";
}

/** Khớp `patchSchema.contextWindow` và schema env `LLM_CONTEXT_WINDOW` */
export function kiemTranContext(raw: string): string {
  const s = raw.trim();
  if (s === "") return "";
  if (!/^\d+$/.test(s)) return "Chỉ nhập số nguyên, hoặc để trống để theo Cấu hình chung";
  const n = Number(s);
  if (n < 4_000 || n > 2_000_000) return "Phải trong khoảng 4.000 - 2.000.000";
  return "";
}
