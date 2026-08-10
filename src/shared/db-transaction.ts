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
 *
 * `viec` BỊ CHẶN Ở KIỂU nếu trả về `Promise` - `COMMIT` chạy NGAY SAU
 * `viec()` một cách ĐỒNG BỘ, không `await` gì cả (đúng bản chất của
 * `BEGIN IMMEDIATE...COMMIT` viết tay ở đây), nên một callback `async` sẽ bị
 * COMMIT trước khi phần việc thật bên trong nó kịp chạy - giao dịch coi như
 * KHÔNG bảo vệ được gì, lỗi ném ra sau đó rơi ra ngoài phạm vi try/catch này
 * và không ai ROLLBACK. `NotPromise<T>` làm `T = Promise<X>` suy ra tham số
 * kiểu `never` - không hàm `async` nào gán được vào đó, nên `tsc` chặn NGAY
 * tại chỗ gọi thay vì để lỗi hiện ra lúc chạy thật.
 */
type NotPromise<T> = T extends Promise<unknown> ? never : T;

export function trongGiaoDich<T>(db: DatabaseSync, viec: () => NotPromise<T>): T {
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
