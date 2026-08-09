import type { KbSourceStatus } from "../dashboard-api-client";

/**
 * Còn nguồn nào ĐANG chờ worker nền xử lý không (`cho_xu_ly`/`dang_xu_ly`) -
 * quyết định trang Kho tri thức có cần hẹn giờ tải lại tiếp hay dừng hẳn.
 *
 * B7: `setInterval(reload, 4000)` cũ chạy VĨNH VIỄN kể cả khi mọi nguồn đã
 * `san_sang`/`hong` (không còn gì để đợi) - phí request vô thời hạn cho một
 * trang đang mở nhưng không ai thao tác gì thêm. `hong` KHÔNG tính là "còn
 * việc": nguồn hỏng chỉ đổi trạng thái lại khi người vận hành chủ động bấm
 * "Xử lý lại" (route `POST /reindex`), không tự chuyển - đợi tiếp vô ích.
 */
export function conViecDoiXuLy(sources: { trangThai: KbSourceStatus }[]): boolean {
  return sources.some((s) => s.trangThai === "cho_xu_ly" || s.trangThai === "dang_xu_ly");
}
