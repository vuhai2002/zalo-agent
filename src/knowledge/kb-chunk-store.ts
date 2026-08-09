/**
 * Lưu/xóa đoạn (chunk) của một nguồn Kho tri thức, giữ bảng ảo `kb_chunks_fts`
 * đồng bộ với `kb_chunks`. Lược đồ ở `kb-schema.ts`.
 */

import { db } from "../conversation/database.js";
import { boDauTiengViet } from "../shared/bo-dau-tieng-viet.js";
import { trongGiaoDich } from "../shared/db-transaction.js";

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
 * THAY THẾ toàn bộ đoạn của nguồn, không cộng dồn: mỗi lần cắt lại tài liệu
 * (phase 02) coi như một bản chốt mới, không phải bản vá thêm vào bản cũ - xóa
 * sạch đoạn cũ (cả FTS lẫn `kb_chunks`) rồi chèn lại từ đầu, trong một giao dịch.
 *
 * `tenNguon` mặc định "" (KHÔNG bắt buộc) - cố ý, để không phải sửa hàng chục
 * chỗ gọi hàm này chỉ để nạp fixture (chúng không cần tên nguồn vào chỉ mục).
 * Đường nạp THẬT (`kb-ingest-worker.ts`) PHẢI truyền tên nguồn thật: thiếu nó
 * thì tra đúng TÊN TÀI LIỆU/TÊN NGUỒN ra rỗng (I1) vẫn còn nguyên.
 */
export function luuDoan(sourceId: string, doan: DoanMoi[], tenNguon = ""): void {
  trongGiaoDich(db, () => {
    xoaFtsCuaNguonStmt.run(sourceId);
    xoaDoanCuaNguonStmt.run(sourceId);
    for (const d of doan) {
      // Tên nguồn + tiêu đề (breadcrumb H1>H2>H3, xem chunk-text.ts) CŨNG vào
      // cột phang: khách hỏi bằng chính TÊN TÀI LIỆU hay TÊN NGUỒN (vd "chính
      // sách đổi trả", "bảng giá quán") phải tìm ra được đoạn, không chỉ khớp
      // thân bài - đúng lỗi I1. `filter(Boolean)` bỏ phần rỗng để không để lại
      // khoảng trắng thừa khi tenNguon/tieuDe trống.
      const phang = boDauTiengViet([tenNguon, d.tieuDe, d.noiDung].filter(Boolean).join(" "));
      const result = chenDoanStmt.run(sourceId, d.thuTu, d.tieuDe, d.noiDung, phang);
      chenFtsStmt.run(Number(result.lastInsertRowid), phang);
    }
  });
}

const demDoanStmt = db.prepare(`SELECT COUNT(*) AS n FROM kb_chunks WHERE source_id = ?`);

export function demDoan(sourceId: string): number {
  return (demDoanStmt.get(sourceId) as { n: number }).n;
}

export type DoanCuaNguon = { thuTu: number; tieuDe: string; noiDung: string };
type DoanCuaNguonRow = { thu_tu: number; tieu_de: string; noi_dung: string };

const layTrangDoanStmt = db.prepare(`
  SELECT thu_tu, tieu_de, noi_dung FROM kb_chunks
   WHERE source_id = ?
   ORDER BY thu_tu ASC
   LIMIT ? OFFSET ?
`);

/**
 * Trang đoạn đã cắt của MỘT nguồn, PHÂN TRANG bắt buộc (I21 - dashboard) -
 * một nguồn dài (sách hướng dẫn cả trăm trang) có thể cắt ra hàng nghìn đoạn,
 * kéo hết về một lần là đúng lỗi OOM mà `kb-route-guards.ts` đã chặn ở đường
 * upload, không thể mở lại ở đường ĐỌC. `tieuDe` LUÔN đi kèm (kể cả rỗng) -
 * đây là breadcrumb duy nhất để người vận hành tự nhận ra bot đọc nhầm cấu
 * trúc tài liệu (H1>H2>H3, xem chunk-text.ts) mà không cần bật AGENT_TRACE_ENABLED.
 */
export function layDoanCuaNguon(sourceId: string, offset: number, limit: number): DoanCuaNguon[] {
  const rows = layTrangDoanStmt.all(sourceId, limit, offset) as unknown as DoanCuaNguonRow[];
  return rows.map((r) => ({ thuTu: r.thu_tu, tieuDe: r.tieu_de, noiDung: r.noi_dung }));
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
