/**
 * CRUD nguồn của Kho tri thức + trạng thái xử lý. Lược đồ ở `kb-schema.ts`.
 */

import { randomBytes } from "node:crypto";
import { db } from "../conversation/database.js";
import { trongGiaoDich } from "../shared/db-transaction.js";

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
  /** Số lần đã GIÀNH để xử lý (tăng ngay lúc giành, xem giaNguonChoXuLy) - trần chặn nguồn làm worker treo/chết lặp lại vô hạn */
  soLanThu: number;
  createdAt: string;
  updatedAt: string;
};

export type KbSourceRow = {
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
  so_lan_thu: number;
  created_at: string;
  updated_at: string;
};

/** Export để `kb-source-queries.ts` dùng lại - một nguồn ánh xạ row->domain, không lặp lại ở nơi khác */
export function mapRow(row: KbSourceRow): KbSource {
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
    soLanThu: row.so_lan_thu,
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
     SET trang_thai = ?, loi = ?, so_doan = ?, so_lan_thu = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE id = ?
`);

/**
 * `loi`/`soDoan`/`soLanThu` bỏ trống thì GIỮ NGUYÊN giá trị cũ (đọc lại rồi
 * ghi đè, không phải reset về mặc định) - đổi trạng thái 'dang_xu_ly' ->
 * 'san_sang' không kèm soDoan mới thì không có lý do gì để đè số đoạn hiện có
 * về 0.
 *
 * `soLanThu` KHÔNG tự reset theo `trangThai` - caller phải truyền TƯỜNG MINH
 * khi muốn cấp lại một budget mới (nguồn vừa xử lý XONG, hoặc người vận hành
 * bấm "Xử lý lại" trên dashboard). Nếu tự động reset theo trạng thái đích thì
 * `goNguonKetLucKhoiDong()` (đưa `dang_xu_ly` -> `cho_xu_ly` để THỬ LẠI) sẽ vô
 * tình xoá mất chính bộ đếm nó cần đọc để quyết định thử tiếp hay bỏ hẳn.
 */
export function datTrangThai(
  id: string,
  trangThai: TrangThaiNguon,
  p?: { loi?: string; soDoan?: number; soLanThu?: number },
): void {
  const hienTai = layNguon(id);
  const loi = p?.loi ?? hienTai?.loi ?? "";
  const soDoan = p?.soDoan ?? hienTai?.soDoan ?? 0;
  const soLanThu = p?.soLanThu ?? hienTai?.soLanThu ?? 0;
  setTrangThaiStmt.run(trangThai, loi, soDoan, soLanThu, id);
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

export function xoaNguon(id: string): { soDoanDaXoa: number } {
  return trongGiaoDich(db, () => {
    const soDoanDaXoa = (demDoanCuaNguonStmt.get(id) as { n: number }).n;
    xoaFtsCuaNguonStmt.run(id);
    xoaDoanCuaNguonStmt.run(id);
    xoaGanAgentCuaNguonStmt.run(id);
    xoaNguonStmt.run(id);
    return { soDoanDaXoa };
  });
}
