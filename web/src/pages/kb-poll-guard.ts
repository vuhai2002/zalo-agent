import type { KbSourceStatus } from "../dashboard-api-client";

/**
 * CHƯA ĐƯỢC NỐI VÀO GIAO DIỆN (rà soát vòng 6, phase 06). `knowledge-page.tsx`
 * đã LÙI về `setInterval(reload, 4000)` đơn giản sau 5 vòng vá liên tiếp đẻ ra
 * 4 hồi quy mới rồi tới "25/540 kịch bản hệ thống tự mâu thuẫn" - "dừng poll
 * khi hết việc" chỉ là tối ưu Minor, không phải lỗi Important. File này (cùng
 * `kb-poll-loop.ts`) GIỮ LẠI nguyên vẹn làm tri thức sống về các bất biến đã
 * học được + điểm khởi đầu cho ai làm lại tối ưu đó - xem mục "dừng poll khi
 * rảnh" trong roadmap (báo cáo phase 06) cho bảng 9 chiều làm điều kiện
 * nghiệm thu và hướng vá đã đo đóng được 25/25 kịch bản còn lại.
 */

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

/**
 * Kết quả một lần thử tải danh sách nguồn - `thanhCong: false` không kèm
 * `items` vì không có gì mới để đọc, chỉ kèm `loi` (tùy chọn) để tầng áp dụng
 * UI hiện đúng thông điệp lỗi mà không phải tự bắt lại exception ở một chỗ
 * khác.
 *
 * Generic theo `T` (mặc định chỉ cần `trangThai`) - `kb-poll-guard.test.ts`
 * dùng fixture tối giản `{ trangThai }`, còn hook React nối vào component
 * thật (nếu tối ưu này được nối lại - xem ghi chú "CHƯA ĐƯỢC NỐI VÀO GIAO
 * DIỆN" ở đầu file) cần NGUYÊN `KbSourceListItem[]` (đủ trường cho
 * `setSources`) để `apDung` (`kb-poll-loop.ts`) không phải ép kiểu mất an toàn.
 */
export type KetQuaTaiNguon<T extends { trangThai: KbSourceStatus } = { trangThai: KbSourceStatus }> =
  | { thanhCong: true; items: T[] }
  | { thanhCong: false; loi?: string };

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
export function nenHenLuotKe<T extends { trangThai: KbSourceStatus }>(
  ketQua: KetQuaTaiNguon<T>,
  sourcesDaBiet: T[] | null,
): boolean {
  if (ketQua.thanhCong) return conViecDoiXuLy(ketQua.items);
  return sourcesDaBiet !== null && conViecDoiXuLy(sourcesDaBiet);
}
