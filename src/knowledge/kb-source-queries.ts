/**
 * Đọc GỌN / lọc ở SQL cho `kb_sources` - tách khỏi `kb-source-store.ts` để
 * file gốc không vỡ trần 200 dòng. Route dashboard và worker không cần kéo cả
 * `noi_dung_goc` (nguồn gõ tay có thể dài hàng chục nghìn ký tự) hay cả bảng
 * (worker quét mỗi 5s, phần lớn nguồn đang `san_sang`/`hong` không liên quan).
 */

import { db } from "../conversation/database.js";
import type { KbSource, KbSourceRow, TrangThaiNguon } from "./kb-source-store.js";

export type KbSourceTomTat = Omit<KbSource, "noiDungGoc">;
type KbSourceRowGon = Omit<KbSourceRow, "noi_dung_goc">;

/**
 * `KbSource` đầy đủ (đã đọc ngược từ DB, vd sau `taoNguon`/`layNguon`) -> bản
 * GỌN không `noiDungGoc`, dùng cho response API. `POST /sources/text` và
 * `POST /sources/:id/reindex` (`kb-routes.ts`) trước đây dội nguyên toàn văn
 * vừa gõ/đang lưu về client - cùng họ lỗi với "GET /sources lộ toàn văn" đã vá
 * ở vòng rà soát trước, sót lại ở hai route này vì chúng đọc qua `taoNguon`/
 * `layNguon` (đầy đủ) chứ không qua `danhSachNguonGon`.
 */
export function boNoiDungGoc(s: KbSource): KbSourceTomTat {
  const { noiDungGoc: _bo, ...gon } = s;
  return gon;
}

function mapRowGon(row: KbSourceRowGon): KbSourceTomTat {
  return {
    id: row.id,
    ten: row.ten,
    loai: row.loai,
    dinhDang: row.dinh_dang,
    duongDan: row.duong_dan,
    trangThai: row.trang_thai,
    loi: row.loi,
    soDoan: row.so_doan,
    soByte: row.so_byte,
    soLanThu: row.so_lan_thu,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const listGonStmt = db.prepare(`
  SELECT id, ten, loai, dinh_dang, duong_dan, trang_thai, loi, so_doan, so_byte, so_lan_thu, created_at, updated_at
    FROM kb_sources ORDER BY created_at DESC
`);

/**
 * Liệt kê KHÔNG kèm `noi_dung_goc` - dùng cho route dashboard (`GET /api/kb/sources`),
 * nơi giao diện chỉ hiện metadata chứ không hiện toàn văn. Trang tự làm mới
 * mỗi vài giây nên kéo dư toàn văn là phí băng thông vô ích.
 */
export function danhSachNguonGon(): KbSourceTomTat[] {
  const rows = listGonStmt.all() as unknown as KbSourceRowGon[];
  return rows.map(mapRowGon);
}

const listTheoTrangThaiStmt = db.prepare(`
  SELECT id, ten, loai, dinh_dang, duong_dan, trang_thai, loi, so_doan, so_byte, so_lan_thu, created_at, updated_at
    FROM kb_sources WHERE trang_thai = ? ORDER BY created_at DESC
`);

/**
 * Liệt kê nguồn ĐÚNG một trạng thái - lọc NGAY Ở SQL, không kéo hết bảng rồi
 * lọc bằng JS. `kb-ingest-worker.ts` gọi mỗi 5s (`cho_xu_ly` lúc quét,
 * `dang_xu_ly` lúc gỡ kẹt khởi động) - kéo cả bảng kèm `noi_dung_goc` của mọi
 * nguồn (kể cả `san_sang`/`hong` không liên quan) mỗi lần quét là phí.
 *
 * KHÔNG kèm `noi_dung_goc` (đo được: 8 nguồn x 5 triệu ký tự = +30 MB một lần
 * gọi nếu snapshot kéo toàn văn MỌI nguồn đang chờ vào RAM cùng lúc) - nguồn
 * `loai='text'` cần đọc lại toàn văn thì gọi `layNguon(id)` MỘT nguồn tại một
 * thời điểm, đúng lúc thật sự cần xử lý nguồn đó (xem `kb-ingest-worker.ts`).
 */
export function layNguonTheoTrangThai(trangThai: TrangThaiNguon): KbSourceTomTat[] {
  const rows = listTheoTrangThaiStmt.all(trangThai) as unknown as KbSourceRowGon[];
  return rows.map(mapRowGon);
}

/**
 * Tập id THẬT SỰ tồn tại trong số các id truyền vào - route gán nguồn cho
 * agent (`PUT /api/kb/agents/:id/sources`) dùng để chặn id rác mà không phải
 * kéo cả bảng (kèm toàn văn) về so sánh trong JS.
 */
export function locIdTonTai(ids: string[]): Set<string> {
  if (ids.length === 0) return new Set();
  const placeholders = ids.map(() => "?").join(", ");
  // Không cache được statement này ở top-level: số lượng placeholder đổi theo
  // độ dài `ids` ở từng lần gọi - cùng lý do với `layDoanTheoId` (kb-chunk-store.ts).
  const stmt = db.prepare(`SELECT id FROM kb_sources WHERE id IN (${placeholders})`);
  const rows = stmt.all(...ids) as unknown as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

const claimStmt = db.prepare(`
  UPDATE kb_sources
     SET trang_thai = 'dang_xu_ly', so_lan_thu = so_lan_thu + 1,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE id = ? AND trang_thai = 'cho_xu_ly' AND so_lan_thu < ?
`);

/**
 * Giành nguồn để xử lý - CHỈ thành công khi nguồn ĐANG ở `cho_xu_ly` VÀ chưa
 * chạm `tranLanThu` lúc câu UPDATE này chạy (so sánh-rồi-đổi NGUYÊN TỬ trong
 * một câu lệnh, không phải đọc rồi ghi 2 bước). Trả `false` nếu nguồn đã bị
 * giành/xử lý bởi lượt khác, hoặc đã hết lượt thử (trần thường bị hạ ngay
 * trước khi nguồn kịp bị đưa sang `hong` - phòng hờ, `goNguonKetDauTick()`
 * mới là nơi CHỦ ĐỘNG chuyển nguồn hết lượt sang `hong`).
 *
 * `so_lan_thu` tăng NGAY TRONG câu UPDATE này, KHÔNG phải sau khi xử lý xong:
 * nguồn làm worker CHẾT/TREO giữa chừng không bao giờ chạy tới được code "sau
 * khi hỏng" - tăng ở nhánh catch thì vô dụng đúng với ca cần đếm nhất (poison
 * pill làm treo tiến trình, không phải lỗi bắt được gọn gàng).
 *
 * Worker BẮT BUỘC dùng hàm này ở bước giành, không dùng `datTrangThai(id,
 * "dang_xu_ly")` (UPDATE VÔ ĐIỀU KIỆN): hai vòng `xuLyMotVong()` có thể chồng
 * lấn thời gian thật (một vòng đang `await` đọc file lớn thì tick 5s sau đã
 * bắn tiếp, tới lượt nó qua nguồn NÀY từ một snapshot cũ) - UPDATE vô điều
 * kiện sẽ giành LẠI được nguồn dù nguồn đó vòng khác đã giành/xử lý xong,
 * gây xử lý trùng và trạng thái cuối phụ thuộc vòng nào ghi SAU CÙNG.
 */
export function giaNguonChoXuLy(id: string, tranLanThu: number): boolean {
  return claimStmt.run(id, tranLanThu).changes > 0;
}

const coNguonNaoStmt = db.prepare(`SELECT 1 FROM kb_sources LIMIT 1`);

/**
 * Kho tri thức đã có ÍT NHẤT một nguồn chưa - dùng cho `kb_search.available()`
 * (`tool-catalog-read.ts`) khi không biết agent cụ thể nào (trang Tools phạm
 * vi tài khoản). `SELECT 1 ... LIMIT 1` thay vì `danhSachNguon().length > 0`:
 * hàm cũ kéo cả bảng (kèm toàn văn của MỌI nguồn) chỉ để tính một boolean, mà
 * `available()` chạy mỗi lần dựng catalog tool - tức MỖI LƯỢT AGENT, hai lần
 * một lượt (dựng schema tool + dựng persona).
 */
export function coNguonNao(): boolean {
  return coNguonNaoStmt.get() !== undefined;
}
