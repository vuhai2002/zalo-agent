/**
 * I20: modal thêm nguồn phải nói trần dung lượng và chặn SỚM ở client - để
 * server (413) từ chối thì người dùng đã đợi hết thời gian tải một file lớn
 * lên vô ích. Tách khỏi component để test được không cần dựng DOM.
 *
 * `chanTranDungLuong` (`src/server/routes/kb-route-guards.ts`) vẫn là hàng
 * phòng thủ THẬT duy nhất - hàm dưới đây chỉ tránh một vòng round-trip, không
 * thay thế được chốt server.
 */

/** Cỡ file (byte) có vượt trần (MB) không - khớp đúng `size > maxSize` của `hono/body-limit` */
export function vuotTranDungLuong(soByte: number, tranMB: number): boolean {
  return soByte > tranMB * 1024 * 1024;
}

/**
 * Đọc trần dung lượng từ CHÍNH `GET /api/tuning` - không hard-code lại số ở
 * modal, đúng nguyên tắc "một nguồn sự thật": đổi KB_MAX_FILE_MB trên trang
 * Cấu hình phải phản ánh ngay ở đây. `null` = chưa tải xong (modal không đoán
 * số, và cũng KHÔNG chặn client khi chưa biết trần thật - server vẫn là chốt
 * cuối cùng nếu người dùng bấm gửi đúng lúc modal chưa tải xong tuning).
 */
export function layTranDungLuongMB(values: { key: string; value: number | boolean | string }[]): number | null {
  const gia = values.find((v) => v.key === "KB_MAX_FILE_MB")?.value;
  return typeof gia === "number" ? gia : null;
}

/** Chuỗi hiện cạnh ô chọn file - rỗng khi chưa tải xong trần */
export function layNhanTranDungLuong(tranMB: number | null): string {
  return tranMB === null ? "" : `Tối đa ${tranMB} MB mỗi file`;
}

/** Câu lỗi hiện khi chặn client - `KbAddSourceModal` gọi khi `vuotTranDungLuong` true */
export function layThongDiepVuotTran(tenFile: string, tranMB: number): string {
  return `File "${tenFile}" vượt quá ${tranMB} MB - chọn file nhỏ hơn`;
}
