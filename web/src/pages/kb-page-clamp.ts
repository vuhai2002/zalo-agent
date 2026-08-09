/**
 * Trang CUỐI CÙNG còn dữ liệu, theo tổng số dòng đã lọc và số dòng/trang.
 * Tách thành hàm thuần để test không lệch khỏi code thật (Việc 2, rà soát
 * phase 06 vòng 2: bản trước comment nói "kẹp về trang cuối" nhưng code lại
 * `setPage(0)` vô điều kiện - xóa 1 dòng ở trang 5 ném thẳng người dùng về
 * trang 1).
 */
export function trangCuoiCungConDuLieu(tongSoDaLoc: number, kichTrang: number): number {
  return Math.max(0, Math.ceil(tongSoDaLoc / kichTrang) - 1);
}
