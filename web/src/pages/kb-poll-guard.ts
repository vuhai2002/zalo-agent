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

/** Kết quả một lần thử tải danh sách nguồn - `thanhCong: false` không kèm `items` vì không có gì mới để đọc. */
export type KetQuaTaiNguon = { thanhCong: true; items: { trangThai: KbSourceStatus }[] } | { thanhCong: false };

/**
 * Có nên hẹn lượt poll KẾ TIẾP hay không, sau MỘT lần thử tải - kể cả khi lần
 * thử đó THẤT BẠI. Bất biến cần giữ: "còn việc thì poll không được chết".
 *
 * Bug cũ (Important 1, phase 06): quyết định "có hẹn lượt kế" nằm trong
 * dependency array của `useEffect` (so theo THAM CHIẾU `sources`). Một lượt
 * tải hỏng (mất mạng, 502) mà nhánh catch trả về ĐÚNG tham chiếu cũ
 * (`setSources(cu => cu ?? [])`) thì effect không chạy lại -> không còn
 * timeout nào được hẹn -> poll CHẾT VĨNH VIỄN dù nguồn vẫn còn `dang_xu_ly`
 * thật. Hàm này thay quyết định đó bằng một phép tính TƯỜNG MINH, không phụ
 * thuộc React re-render: tải lỗi thì xét theo state đã biết TRƯỚC lần tải
 * này (`sourcesDaBiet`) - một lần gọi mạng hỏng không được hiểu nhầm thành
 * "hết việc" khi lần tải THÀNH CÔNG gần nhất còn nguồn đang chờ xử lý.
 */
export function nenHenLuotKe(
  ketQua: KetQuaTaiNguon,
  sourcesDaBiet: { trangThai: KbSourceStatus }[] | null,
): boolean {
  if (ketQua.thanhCong) return conViecDoiXuLy(ketQua.items);
  return sourcesDaBiet !== null && conViecDoiXuLy(sourcesDaBiet);
}
