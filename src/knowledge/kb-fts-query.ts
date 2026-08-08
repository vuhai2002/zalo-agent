/**
 * Dựng truy vấn MATCH an toàn cho `kb_chunks_fts` và chạy bm25 trên đó.
 *
 * Câu hỏi của khách đi thẳng vào đây - có thể chứa `-`, `*`, `"`, `(`, `:`,
 * `^` là cú pháp riêng của FTS5, không bọc là `MATCH` ném lỗi cú pháp và tool
 * chết giữa chừng. Xem thêm `kb-schema.ts` (vì sao cột `phang` đã bỏ dấu).
 */

import { db } from "../conversation/database.js";
import { boDauTiengViet } from "../shared/bo-dau-tieng-viet.js";

/**
 * "" khi câu hỏi không còn TỪ nào dùng được (toàn dấu câu/emoji) - gọi nơi
 * cần phải tự kiểm chuỗi rỗng trước khi dựng MATCH, vì MATCH '' cũng là lỗi
 * cú pháp FTS5.
 *
 * Bọc TỪNG từ trong nháy kép rồi nối OR (không phải AND mặc định của FTS5):
 * AND đòi mọi từ phải khớp, một câu hỏi tự nhiên có từ thừa không nằm trong
 * tài liệu (vd "ship" trong "phí ship nội thành") làm cả câu không khớp gì.
 */
export function dungTruyVanFts(cauHoi: string): string {
  const tuKhoa = boDauTiengViet(cauHoi).match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tuKhoa.length === 0) return "";
  return tuKhoa.map((tu) => `"${tu}"`).join(" OR ");
}

export type KetQuaFts = { chunkId: number };

/**
 * Tìm theo từ khóa qua bm25, chỉ trong `sourceIds` truyền vào - lọc NGAY
 * TRONG WHERE, không lấy top rồi lọc sau: lấy top-50 rồi lọc còn vài nguồn
 * là mất kết quả đúng đang nằm ở hạng ngoài 50.
 *
 * `rowid` của `kb_chunks_fts` chính là `kb_chunks.id` (gán tường minh lúc
 * chèn ở `kb-chunk-store.ts`) nên JOIN thẳng qua đó, không cần bảng trung gian.
 *
 * Không cache statement ở top-level: số lượng placeholder của `sourceIds`
 * đổi theo từng lần gọi (giống `layDoanTheoId`).
 */
export function timTheoTuKhoa(cauHoi: string, sourceIds: string[], soLuong: number): KetQuaFts[] {
  if (sourceIds.length === 0) return [];

  const matchQuery = dungTruyVanFts(cauHoi);
  if (!matchQuery) return [];

  const placeholders = sourceIds.map(() => "?").join(", ");
  // bm25() đòi TÊN BẢNG FTS5 thật, không nhận alias ("no such column: f" khi
  // gọi bm25(f)) - đã đo trên node:sqlite. Vì vậy JOIN không đặt alias cho
  // kb_chunks_fts, dùng thẳng tên bảng ở cả MATCH lẫn ORDER BY.
  const stmt = db.prepare(`
    SELECT c.id AS chunk_id
      FROM kb_chunks_fts
      JOIN kb_chunks c ON c.id = kb_chunks_fts.rowid
     WHERE kb_chunks_fts.phang MATCH ?
       AND c.source_id IN (${placeholders})
     ORDER BY bm25(kb_chunks_fts)
     LIMIT ?
  `);
  const rows = stmt.all(matchQuery, ...sourceIds, soLuong) as unknown as { chunk_id: number }[];
  return rows.map((r) => ({ chunkId: r.chunk_id }));
}
