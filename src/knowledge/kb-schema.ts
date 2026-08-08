import type { DatabaseSync } from "node:sqlite";

/**
 * Lược đồ Kho tri thức: nguồn tài liệu -> đoạn cắt -> FTS5 tìm bằng bm25 ->
 * gán cho từng agent. Gọi từ `database.ts` (`runMigrations()`), CÙNG connection
 * với mọi bảng khác trong DB.
 *
 * KHÔNG dùng FOREIGN KEY: `database.ts` không bật `PRAGMA foreign_keys`, nên
 * khai `REFERENCES ... ON DELETE CASCADE` chỉ là lời hứa suông. Mọi nơi xóa
 * `kb_sources` phải tự dọn `kb_chunks`, `kb_chunks_fts`, `agent_kb_sources`
 * tường minh trong một giao dịch - xem `kb-source-store.ts#xoaNguon`.
 *
 * `kb_chunks_fts` là bảng ẢO thường (không `content=''`): xóa hàng chỉ cần
 * `DELETE ... WHERE rowid = ?` bình thường, không phải câu lệnh đặc biệt
 * `INSERT INTO fts(fts,rowid,...) VALUES('delete',...)` mà bản contentless đòi
 * hỏi - dễ quên và hỏng câm. `rowid` của bảng FTS được gán bằng đúng
 * `kb_chunks.id` khi chèn (`kb-chunk-store.ts`), để `bm25()` trả rowid là tra
 * ngược ra đúng đoạn.
 */
export function taoBangKnowledgeBase(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kb_sources (
      id           TEXT PRIMARY KEY,
      ten          TEXT NOT NULL,
      loai         TEXT NOT NULL CHECK (loai IN ('file', 'text')),
      dinh_dang    TEXT NOT NULL DEFAULT '',
      duong_dan    TEXT NOT NULL DEFAULT '',
      noi_dung_goc TEXT NOT NULL DEFAULT '',
      trang_thai   TEXT NOT NULL DEFAULT 'cho_xu_ly'
                   CHECK (trang_thai IN ('cho_xu_ly', 'dang_xu_ly', 'san_sang', 'hong')),
      loi          TEXT NOT NULL DEFAULT '',
      so_doan      INTEGER NOT NULL DEFAULT 0,
      so_byte      INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS kb_chunks (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      thu_tu    INTEGER NOT NULL,
      tieu_de   TEXT NOT NULL DEFAULT '',
      noi_dung  TEXT NOT NULL,
      phang     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kb_chunks_source ON kb_chunks (source_id);

    -- Bảng ảo: chỉ index cột đã BỎ DẤU. Câu hỏi cũng bỏ dấu trước khi tìm -
    -- xem bo-dau-tieng-viet.ts. remove_diacritics 2 của SQLite không xử lý
    -- được chữ 'đ' (U+0111 là chữ cái có gạch ngang, không phải dấu phụ tổ
    -- hợp) nên không dùng tokenchars/remove_diacritics của FTS5 mà tự bỏ dấu
    -- trước khi ghi.
    CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5(
      phang,
      tokenize = 'unicode61'
    );

    CREATE TABLE IF NOT EXISTS agent_kb_sources (
      agent_id  TEXT NOT NULL,
      source_id TEXT NOT NULL,
      PRIMARY KEY (agent_id, source_id)
    );
  `);
}
