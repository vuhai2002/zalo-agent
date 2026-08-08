/**
 * CRUD nguồn của Kho tri thức + trạng thái xử lý. Lược đồ ở `kb-schema.ts`.
 */

import { randomBytes } from "node:crypto";
import { db } from "../conversation/database.js";

export type TrangThaiNguon = "cho_xu_ly" | "dang_xu_ly" | "san_sang" | "hong";
export type LoaiNguon = "file" | "text";

export type KbSource = {
  id: string;
  ten: string;
  loai: LoaiNguon;
  dinhDang: string;
  duongDan: string;
  noiDungGoc: string;
  trangThai: TrangThaiNguon;
  loi: string;
  soDoan: number;
  soByte: number;
  createdAt: string;
  updatedAt: string;
};

type KbSourceRow = {
  id: string;
  ten: string;
  loai: LoaiNguon;
  dinh_dang: string;
  duong_dan: string;
  noi_dung_goc: string;
  trang_thai: TrangThaiNguon;
  loi: string;
  so_doan: number;
  so_byte: number;
  created_at: string;
  updated_at: string;
};

function mapRow(row: KbSourceRow): KbSource {
  return {
    id: row.id,
    ten: row.ten,
    loai: row.loai,
    dinhDang: row.dinh_dang,
    duongDan: row.duong_dan,
    noiDungGoc: row.noi_dung_goc,
    trangThai: row.trang_thai,
    loi: row.loi,
    soDoan: row.so_doan,
    soByte: row.so_byte,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const insertStmt = db.prepare(`
  INSERT INTO kb_sources (id, ten, loai, dinh_dang, duong_dan, noi_dung_goc, so_byte)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

export function taoNguon(p: {
  ten: string;
  loai: LoaiNguon;
  dinhDang?: string;
  duongDan?: string;
  noiDungGoc?: string;
  soByte?: number;
}): KbSource {
  const id = randomBytes(8).toString("hex");
  insertStmt.run(id, p.ten, p.loai, p.dinhDang ?? "", p.duongDan ?? "", p.noiDungGoc ?? "", p.soByte ?? 0);
  // Vừa tự ghi xong với id vừa sinh nên đọc lại không thể miss - không kiểm null.
  return layNguon(id)!;
}

const getStmt = db.prepare(`SELECT * FROM kb_sources WHERE id = ?`);

export function layNguon(id: string): KbSource | null {
  const row = getStmt.get(id) as KbSourceRow | undefined;
  return row ? mapRow(row) : null;
}

const listStmt = db.prepare(`SELECT * FROM kb_sources ORDER BY created_at DESC`);

export function danhSachNguon(): KbSource[] {
  const rows = listStmt.all() as unknown as KbSourceRow[];
  return rows.map(mapRow);
}

const setTrangThaiStmt = db.prepare(`
  UPDATE kb_sources
     SET trang_thai = ?, loi = ?, so_doan = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE id = ?
`);

/**
 * `loi`/`soDoan` bỏ trống thì GIỮ NGUYÊN giá trị cũ (đọc lại rồi ghi đè, không
 * phải reset về mặc định) - đổi trạng thái 'dang_xu_ly' -> 'san_sang' không
 * kèm soDoan mới thì không có lý do gì để đè số đoạn hiện có về 0.
 */
export function datTrangThai(
  id: string,
  trangThai: TrangThaiNguon,
  p?: { loi?: string; soDoan?: number },
): void {
  const hienTai = layNguon(id);
  const loi = p?.loi ?? hienTai?.loi ?? "";
  const soDoan = p?.soDoan ?? hienTai?.soDoan ?? 0;
  setTrangThaiStmt.run(trangThai, loi, soDoan, id);
}

// ===== Xóa sạch: bất biến quan trọng nhất của Kho tri thức =====
//
// Không có FOREIGN KEY (xem `kb-schema.ts`), nên phải tự dọn CẢ BỐN nơi trong
// MỘT giao dịch: `kb_sources`, `kb_chunks`, `kb_chunks_fts`, `agent_kb_sources`.
// Xóa hàng FTS TRƯỚC khi xóa `kb_chunks` - subquery tra rowid cần bảng
// `kb_chunks` còn nguyên để biết đoạn nào thuộc nguồn đang xóa.

const demDoanCuaNguonStmt = db.prepare(`SELECT COUNT(*) AS n FROM kb_chunks WHERE source_id = ?`);
const xoaFtsCuaNguonStmt = db.prepare(
  `DELETE FROM kb_chunks_fts WHERE rowid IN (SELECT id FROM kb_chunks WHERE source_id = ?)`,
);
const xoaDoanCuaNguonStmt = db.prepare(`DELETE FROM kb_chunks WHERE source_id = ?`);
const xoaGanAgentCuaNguonStmt = db.prepare(`DELETE FROM agent_kb_sources WHERE source_id = ?`);
const xoaNguonStmt = db.prepare(`DELETE FROM kb_sources WHERE id = ?`);

/**
 * Viết tay `BEGIN IMMEDIATE`/`COMMIT` vì `node:sqlite` KHÔNG có `db.transaction()`
 * như better-sqlite3. `BEGIN IMMEDIATE` lấy khóa ghi ngay từ đầu thay vì nâng
 * cấp giữa chừng - cùng pattern `wipe-thread-context.ts` (chỗ đầu tiên trong
 * repo dùng giao dịch). Cả process dùng CHUNG một connection và không có nơi
 * nào khác mở giao dịch lồng vào thao tác của Kho tri thức.
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

export function xoaNguon(id: string): { soDoanDaXoa: number } {
  return trongGiaoDich(() => {
    const soDoanDaXoa = (demDoanCuaNguonStmt.get(id) as { n: number }).n;
    xoaFtsCuaNguonStmt.run(id);
    xoaDoanCuaNguonStmt.run(id);
    xoaGanAgentCuaNguonStmt.run(id);
    xoaNguonStmt.run(id);
    return { soDoanDaXoa };
  });
}
