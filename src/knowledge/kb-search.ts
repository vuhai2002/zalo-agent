/**
 * Ghép tầng tìm kiếm Kho tri thức: nguồn được PHÉP đọc của agent -> bm25 ->
 * hợp nhất RRF -> khử trùng nội dung -> tra ngược ra đoạn đầy đủ (kèm tên
 * nguồn) để trả cho model.
 *
 * Chỉ có MỘT bộ xếp hạng (bm25 theo từ khóa) ở đợt này, nhưng vẫn đi qua
 * `hopNhatRrf` - xem lý do ở `hop-nhat-rrf.ts`.
 */

import { getTuning } from "../config/runtime-tuning-settings.js";
import { boDauTiengViet } from "../shared/bo-dau-tieng-viet.js";
import { nguonCuaAgent } from "./kb-agent-binding.js";
import { layDoanTheoId } from "./kb-chunk-store.js";
import { timTheoTuKhoa } from "./kb-fts-query.js";
import { hopNhatRrf } from "./hop-nhat-rrf.js";

export type KetQuaKb = { sourceId: string; tenNguon: string; tieuDe: string; noiDung: string; diem: number };

// Lấy DƯ trước khi khử trùng (I3): `timTheoTuKhoa` LIMIT đúng trong SQL, nên
// khử trùng SAU đó (hai nguồn chép y hệt nhau chỉ giữ 1) sẽ THIẾU nếu không
// lấy dư - một cặp trùng chiếm 2 trong số suất ít ỏi, khử xong hụt mất một
// suất chứ không tự lấy bù đoạn khác đang nằm ngoài LIMIT. x3 đủ chừa chỗ cho
// ca thực tế nhất (một vài bản trùng lặp), lấy dư QUÁ nhiều chỉ tốn thêm một
// truy vấn rẻ (bảng `kb_chunks_fts` của một bot cá nhân không lớn).
//
// CHƯA đo được số lượng bản trùng THẬT của một kho tri thức thật (không có
// dữ liệu người dùng để đo) - x3 là suy luận, không phải số đo. Ca hỏng nếu
// suy luận sai: kho có NHIỀU hơn `soLuong * (HE_SO_LAY_DU - 1)` bản trùng
// đồng hạng cho cùng một câu hỏi (vd soLuong=5 mà có >10 bản gần như y hệt
// nhau đều khớp top) thì khử trùng vẫn THIẾU đúng kiểu I3 mô tả - chỉ ở quy
// mô nhỏ hơn hẳn bug gốc (LIMIT=soLuong, x1). Nếu gặp ca này thật, nâng
// `HE_SO_LAY_DU` chứ đừng đổi kiến trúc.
const HE_SO_LAY_DU = 3;

export function timTrongKhoTriThuc(p: { cauHoi: string; agentId: string; soLuong?: number }): KetQuaKb[] {
  // Mặc định ĐÓNG: agent chưa gán nguồn nào (chưa cấu hình gì, xem
  // kb-agent-binding.ts) thì không đọc được nguồn nào, KHÔNG PHẢI đọc hết -
  // đảo ngược điều này là rò tài liệu của agent khác.
  const sourceIds = nguonCuaAgent(p.agentId);
  if (sourceIds.length === 0) return [];

  const soLuong = p.soLuong ?? getTuning("KB_TOP_K");
  const ftsKetQua = timTheoTuKhoa(p.cauHoi, sourceIds, soLuong * HE_SO_LAY_DU);
  if (ftsKetQua.length === 0) return [];

  const k = getTuning("KB_RRF_K");
  // KHÔNG slice(0, soLuong) ở đây - hopNhatRrf chỉ có một danh sách đầu vào
  // (đã LIMIT dư ở trên) nên nó trả nguyên số lượng đó; cắt về đúng soLuong
  // phải đợi SAU khi khử trùng, không thì mất chính phần "dư" vừa lấy để dành.
  const hopNhat = hopNhatRrf([ftsKetQua], (x) => String(x.chunkId), k);

  const diemTheoChunkId = new Map(hopNhat.map((h) => [h.item.chunkId, h.diem]));
  // layDoanTheoId trả về ĐÚNG thứ tự ids truyền vào - giữ nguyên thứ hạng RRF
  const doan = layDoanTheoId(hopNhat.map((h) => h.item.chunkId));

  // Khử trùng (I3): hai nguồn KHÁC NHAU chép y hệt nội dung không nên chiếm 2
  // slot trong top-k model thấy. So khớp theo NỘI DUNG đã chuẩn hóa (tiêu đề +
  // thân bài, bỏ dấu) - CỐ Ý không gồm tên nguồn: hai nguồn khác tên vẫn phải
  // khử được nếu nội dung y hệt, đó chính là ca cần khử. Giữ bản xếp hạng CAO
  // NHẤT (đầu tiên gặp, `doan` đã đúng thứ tự RRF), bỏ các bản trùng sau.
  const daGap = new Set<string>();
  const daKhuTrung: typeof doan = [];
  for (const d of doan) {
    const chuKy = boDauTiengViet(`${d.tieuDe} ${d.noiDung}`.trim());
    if (daGap.has(chuKy)) continue;
    daGap.add(chuKy);
    daKhuTrung.push(d);
    if (daKhuTrung.length >= soLuong) break;
  }

  return daKhuTrung.map((d) => ({
    sourceId: d.sourceId,
    tenNguon: d.tenNguon,
    tieuDe: d.tieuDe,
    noiDung: d.noiDung,
    diem: diemTheoChunkId.get(d.id) ?? 0,
  }));
}
