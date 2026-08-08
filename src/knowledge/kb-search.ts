/**
 * Ghép tầng tìm kiếm Kho tri thức: nguồn được PHÉP đọc của agent -> bm25 ->
 * hợp nhất RRF -> tra ngược ra đoạn đầy đủ (kèm tên nguồn) để trả cho model.
 *
 * Chỉ có MỘT bộ xếp hạng (bm25 theo từ khóa) ở đợt này, nhưng vẫn đi qua
 * `hopNhatRrf` - xem lý do ở `hop-nhat-rrf.ts`.
 */

import { getTuning } from "../config/runtime-tuning-settings.js";
import { nguonCuaAgent } from "./kb-agent-binding.js";
import { layDoanTheoId } from "./kb-chunk-store.js";
import { timTheoTuKhoa } from "./kb-fts-query.js";
import { hopNhatRrf } from "./hop-nhat-rrf.js";

export type KetQuaKb = { sourceId: string; tenNguon: string; tieuDe: string; noiDung: string; diem: number };

export function timTrongKhoTriThuc(p: { cauHoi: string; agentId: string; soLuong?: number }): KetQuaKb[] {
  // Mặc định ĐÓNG: agent chưa gán nguồn nào (chưa cấu hình gì, xem
  // kb-agent-binding.ts) thì không đọc được nguồn nào, KHÔNG PHẢI đọc hết -
  // đảo ngược điều này là rò tài liệu của agent khác.
  const sourceIds = nguonCuaAgent(p.agentId);
  if (sourceIds.length === 0) return [];

  const soLuong = p.soLuong ?? getTuning("KB_TOP_K");
  const ftsKetQua = timTheoTuKhoa(p.cauHoi, sourceIds, soLuong);
  if (ftsKetQua.length === 0) return [];

  const k = getTuning("KB_RRF_K");
  const hopNhat = hopNhatRrf([ftsKetQua], (x) => String(x.chunkId), k).slice(0, soLuong);

  const diemTheoChunkId = new Map(hopNhat.map((h) => [h.item.chunkId, h.diem]));
  // layDoanTheoId trả về ĐÚNG thứ tự ids truyền vào - giữ nguyên thứ hạng RRF
  const doan = layDoanTheoId(hopNhat.map((h) => h.item.chunkId));

  return doan.map((d) => ({
    sourceId: d.sourceId,
    tenNguon: d.tenNguon,
    tieuDe: d.tieuDe,
    noiDung: d.noiDung,
    diem: diemTheoChunkId.get(d.id) ?? 0,
  }));
}
