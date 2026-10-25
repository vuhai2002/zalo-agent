import type { DatabaseSync } from "node:sqlite";

/**
 * Bảng ghi chú NGUYÊN VĂN (tool `verbatim_note`).
 *
 * TÁCH khỏi `memories` vì hai thứ khác bản chất: fact là tóm tắt ngắn, nhét vào
 * MỌI lượt; ghi chú là nguyên một đoạn người dùng muốn nhận lại đúng từng chữ,
 * chỉ đọc khi được hỏi. Dồn vào `memories` thì vướng trần 500 ký tự (model tự
 * chia phần, phần đầu có thể bị cắt khỏi trần số fact trước phần sau) và mỗi
 * lượt chat phải gánh cả đoạn dài - đo trên prod: một lời dặn thường đã 700
 * ký tự.
 *
 * `title_key` = tên đã chuẩn hóa (NFC, gộp khoảng trắng, chữ thường) để "Thông
 * báo suất ăn" và "thông báo  suất ăn" là một. `learned_in_group` theo đúng luật
 * bất đối xứng của `memories`: ghi chú lưu ở chat riêng không bao giờ hiện
 * trong nhóm.
 *
 * KHÔNG FOREIGN KEY (`database.ts` không bật `PRAGMA foreign_keys`): xóa account
 * (`deleteAccount`) và xóa ngữ cảnh thread (`wipe-thread-context.ts`) tự dọn.
 */
export function taoBangVerbatimNotes(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS verbatim_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      title TEXT NOT NULL,
      title_key TEXT NOT NULL,
      content TEXT NOT NULL,
      learned_in_thread_id TEXT NOT NULL,
      learned_in_group INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE (account_id, subject_id, title_key)
    );
  `);
}
