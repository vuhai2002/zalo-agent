/**
 * Tệp đã làm tiến trình con chết (hết giờ/vượt RAM) bao nhiêu lần, trong cửa
 * sổ `CUA_SO_BI_NGAT_MS`. Đủ `SO_LAN_BI_NGAT_TOI_DA` lần thì thôi tải + trích
 * lại tới hết cửa sổ: tệp độc thì mỗi lần hỏi lại là thêm 60 giây chiếm chỗ
 * duy nhất của hàng đợi trích xuất dùng chung (Kho tri thức cũng chờ ở đó).
 * KHÔNG ghi vào DB như lỗi vĩnh viễn: bị ngắt có thể chỉ vì máy bận lúc đó, và
 * người vận hành nâng trần là phải đọc lại được. Mất khi khởi động lại - chấp nhận.
 */
const SO_LAN_BI_NGAT_TOI_DA = 2;
const CUA_SO_BI_NGAT_MS = 60 * 60 * 1000;
const biNgat = new Map<number, { lan: number; dau: number }>();
export function daBiNgatQuaNhieu(id: number, now: Date): boolean {
  const b = biNgat.get(id);
  if (!b) return false;
  if (now.getTime() - b.dau >= CUA_SO_BI_NGAT_MS) {
    biNgat.delete(id);
    return false;
  }
  return b.lan >= SO_LAN_BI_NGAT_TOI_DA;
}
export function ghiBiNgat(id: number, now: Date): void {
  const b = biNgat.get(id);
  if (b && now.getTime() - b.dau < CUA_SO_BI_NGAT_MS) b.lan++;
  else biNgat.set(id, { lan: 1, dau: now.getTime() });
}
