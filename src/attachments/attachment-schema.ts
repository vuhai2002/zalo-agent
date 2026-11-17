import type { DatabaseSync } from "node:sqlite";

/**
 * Bảng tệp đính kèm người dùng gửi qua Zalo (`share.file`).
 *
 * Ba lớp tuổi thọ (xem plan đọc tệp đính kèm):
 *  - dòng + `href`: sống tới `xoa_luc` (= lúc gửi + `ATTACHMENT_RETENTION_DAYS`,
 *    khớp tuổi link Zalo đo được: dưới 7 ngày tải lại 835/835);
 *  - chữ đã trích/OCR (`noi_dung_json`, `trang_ocr_json`): hạn TRƯỢT
 *    `cache_het_han` - mỗi lần đọc gia hạn `ATTACHMENT_CACHE_IDLE_HOURS`, không
 *    vượt `xoa_luc`. Hết hạn thì NULL hóa, đọc lại thì tải + trích lại;
 *  - byte gốc: KHÔNG bao giờ ở đây (chỉ trong RAM).
 *
 * Chữ trích ra KHÔNG vào bảng `messages` (lịch sử chỉ có thẻ tên tệp) - nội
 * dung người lạ không được nằm bền trong thứ model đọc lại ở mọi lượt.
 *
 * Không FOREIGN KEY (repo không bật): `deleteAccount` và `xoaNguCanhThread` tự dọn.
 */
export function taoBangTepDinhKem(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tep_dinh_kem (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      history_row_id INTEGER NOT NULL,
      sender_id TEXT NOT NULL,
      ten TEXT NOT NULL,
      duoi_khai TEXT NOT NULL,
      co_khai INTEGER,
      href TEXT NOT NULL,
      created_at TEXT NOT NULL,
      xoa_luc TEXT NOT NULL,
      dinh_dang TEXT,
      so_trang INTEGER,
      noi_dung_json TEXT,
      trang_ocr_json TEXT,
      trang_can_ocr_json TEXT,
      canh_bao_json TEXT,
      ma_loi TEXT,
      cache_het_han TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tep_dinh_kem_thread ON tep_dinh_kem (account_id, thread_id, id);
    CREATE INDEX IF NOT EXISTS idx_tep_dinh_kem_xoa_luc ON tep_dinh_kem (xoa_luc);
  `);
}
