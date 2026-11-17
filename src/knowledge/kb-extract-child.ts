import { phucVuTienTrinhCon } from "../shared/phuc-vu-tien-trinh-con.js";
import { catThanhDoan } from "./chunk-text.js";
import type { ThamSoCat } from "./chunk-text.js";
import { docChuTuFile } from "./doc-text-extract.js";
import type { DinhDangKb } from "./doc-text-extract.js";
import type { KetQuaTrichXuat } from "./chay-trich-xuat-tach-luong.js";

/**
 * Thân TIẾN TRÌNH CON trích xuất Kho tri thức, dựng bởi
 * `chay-trich-xuat-tach-luong.ts`. Bất biến bắt buộc: chỉ import module THUẦN -
 * KHÔNG `config/env.ts` (con chạy với env tối thiểu, thiếu khóa giải mã là chết
 * ngay lúc nạp), KHÔNG `conversation/database.ts` (một connection cho cả
 * process). Import `type` bị TypeScript xoá hẳn nên không kéo module theo.
 *
 * Lỗi trích xuất THƯỜNG (file hỏng, đọc không ra chữ) đi về qua `{ok:false}`
 * của `phucVuTienTrinhCon` - khác hẳn con bị giết giữa chừng, hai loại cần xử
 * lý khác nhau ở `kb-ingest-worker.ts`.
 */

type DuLieuVao = { buf: Buffer; dinhDang: DinhDangKb; thamSoCat: ThamSoCat };

phucVuTienTrinhCon<DuLieuVao, KetQuaTrichXuat>(async ({ buf, dinhDang, thamSoCat }) => {
  const chu = await docChuTuFile(Buffer.from(buf), dinhDang);
  return { chu, doan: catThanhDoan(chu, thamSoCat) };
});
