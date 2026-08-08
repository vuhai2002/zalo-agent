import type { DatabaseSync } from "node:sqlite";

/**
 * Chạy `viec` trong một giao dịch SQLite, viết tay vì `node:sqlite` KHÔNG có
 * `db.transaction()` như better-sqlite3.
 *
 * `BEGIN IMMEDIATE` chứ không phải `BEGIN`: lấy khóa ghi ngay từ đầu thay vì
 * nâng cấp giữa chừng. Cả process dùng CHUNG một connection SQLite, nên nơi
 * gọi hàm này phải tự đảm bảo không có giao dịch nào khác đang mở lồng vào -
 * `node:sqlite` không hỗ trợ giao dịch lồng nhau.
 *
 * Lỗi khi ROLLBACK bị NUỐT (không ném ra ngoài): ném lỗi rollback đè lên lỗi
 * gốc là giấu mất nguyên nhân thật khiến giao dịch phải hủy - người gọi cần
 * biết TẠI SAO `viec()` hỏng, không phải tại sao ROLLBACK hỏng. Lỗi gốc luôn
 * được ném lại nguyên vẹn dù rollback có thành công hay không.
 */
export function trongGiaoDich<T>(db: DatabaseSync, viec: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const ketQua = viec();
    db.exec("COMMIT");
    return ketQua;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* giữ nguyên lỗi gốc */
    }
    throw err;
  }
}
