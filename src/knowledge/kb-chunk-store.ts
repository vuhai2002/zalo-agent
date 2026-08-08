/**
 * Lưu/xóa đoạn (chunk) của một nguồn Kho tri thức, giữ bảng ảo `kb_chunks_fts`
 * đồng bộ với `kb_chunks`. Lược đồ ở `kb-schema.ts`.
 */

import { db } from "../conversation/database.js";
import { boDauTiengViet } from "../shared/bo-dau-tieng-viet.js";

export type DoanMoi = { thuTu: number; tieuDe: string; noiDung: string };

const xoaFtsCuaNguonStmt = db.prepare(
  `DELETE FROM kb_chunks_fts WHERE rowid IN (SELECT id FROM kb_chunks WHERE source_id = ?)`,
);
const xoaDoanCuaNguonStmt = db.prepare(`DELETE FROM kb_chunks WHERE source_id = ?`);
const chenDoanStmt = db.prepare(`
  INSERT INTO kb_chunks (source_id, thu_tu, tieu_de, noi_dung, phang)
  VALUES (?, ?, ?, ?, ?)
`);
// `rowid` gán TƯỜNG MINH bằng đúng `kb_chunks.id` vừa chèn - đây là điều kiện
// để `bm25()` trả rowid tra ngược ra đúng đoạn ở phase 03.
const chenFtsStmt = db.prepare(`INSERT INTO kb_chunks_fts (rowid, phang) VALUES (?, ?)`);

/**
 * Cùng pattern `trongGiaoDich` của `kb-source-store.ts` (viết tay vì
 * `node:sqlite` không có `db.transaction()`) - xem chú thích ở đó để biết vì
 * sao `BEGIN IMMEDIATE`.
 */
function trongGiaoDich<T>(viec: () => T): T {
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

/**
 * THAY THẾ toàn bộ đoạn của nguồn, không cộng dồn: mỗi lần cắt lại tài liệu
 * (phase 02) coi như một bản chốt mới, không phải bản vá thêm vào bản cũ - xóa
 * sạch đoạn cũ (cả FTS lẫn `kb_chunks`) rồi chèn lại từ đầu, trong một giao dịch.
 */
export function luuDoan(sourceId: string, doan: DoanMoi[]): void {
  trongGiaoDich(() => {
    xoaFtsCuaNguonStmt.run(sourceId);
    xoaDoanCuaNguonStmt.run(sourceId);
    for (const d of doan) {
      // Tiêu đề CŨNG vào cột phang: khách hỏi bằng chữ nằm trong tiêu đề (vd
      // "chính sách đổi trả") phải tìm ra được đoạn, không chỉ khớp nội dung.
      const phang = boDauTiengViet(`${d.tieuDe} ${d.noiDung}`.trim());
      const result = chenDoanStmt.run(sourceId, d.thuTu, d.tieuDe, d.noiDung, phang);
      chenFtsStmt.run(Number(result.lastInsertRowid), phang);
    }
  });
}

const demDoanStmt = db.prepare(`SELECT COUNT(*) AS n FROM kb_chunks WHERE source_id = ?`);

export function demDoan(sourceId: string): number {
  return (demDoanStmt.get(sourceId) as { n: number }).n;
}

type DoanTraNguoc = { id: number; sourceId: string; tenNguon: string; tieuDe: string; noiDung: string };
type DoanTraNguocRow = {
  id: number;
  source_id: string;
  ten_nguon: string;
  tieu_de: string;
  noi_dung: string;
};

/**
 * Tra ngược đoạn từ id, ĐÃ JOIN sang `kb_sources` để lấy tên nguồn. Phase 03
 * cần `tenNguon` để model dẫn nguồn cho khách - join ở đây chứ không bắt caller
 * tự join, tránh hai nơi cùng biết cách nối bảng.
 *
 * Trả về theo ĐÚNG thứ tự của `ids` truyền vào (thứ tự do RRF quyết ở phase
 * 03), không theo thứ tự SQL trả về. `id` không còn tồn tại (đoạn vừa bị xóa
 * giữa lúc tìm và lúc tra) thì bị bỏ qua lặng lẽ, không throw.
 */
export function layDoanTheoId(ids: number[]): DoanTraNguoc[] {
  if (ids.length === 0) return [];

  const placeholders = ids.map(() => "?").join(", ");
  // Không cache được statement này ở top-level: số lượng placeholder đổi theo
  // độ dài `ids` ở từng lần gọi.
  const stmt = db.prepare(`
    SELECT c.id AS id, c.source_id AS source_id, s.ten AS ten_nguon,
           c.tieu_de AS tieu_de, c.noi_dung AS noi_dung
      FROM kb_chunks c
      JOIN kb_sources s ON s.id = c.source_id
     WHERE c.id IN (${placeholders})
  `);
  const rows = stmt.all(...ids) as unknown as DoanTraNguocRow[];

  const theoId = new Map(rows.map((r) => [r.id, r]));
  const ketQua: DoanTraNguoc[] = [];
  for (const id of ids) {
    const r = theoId.get(id);
    if (!r) continue;
    ketQua.push({ id: r.id, sourceId: r.source_id, tenNguon: r.ten_nguon, tieuDe: r.tieu_de, noiDung: r.noi_dung });
  }
  return ketQua;
}
