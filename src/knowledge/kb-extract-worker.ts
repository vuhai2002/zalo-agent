import { parentPort, workerData } from "node:worker_threads";
import { catThanhDoan } from "./chunk-text.js";
import type { ThamSoCat } from "./chunk-text.js";
import { docChuTuFile } from "./doc-text-extract.js";
import type { DinhDangKb } from "./doc-text-extract.js";
import type { DoanMoi } from "./kb-chunk-store.js";

/**
 * Thân worker thread của trích xuất Kho tri thức - CHẠY TRONG THREAD RIÊNG,
 * dùng bởi `chay-trich-xuat-tach-luong.ts` (`new Worker(...)`). Bất biến bắt
 * buộc phải giữ: KHÔNG mở kết nối SQLite ở đây - "một connection dùng chung
 * cho cả process" (`conversation/database.ts`) không được phá. File này CHỈ
 * import module THUẦN (`chunk-text.ts` không import gì; `doc-text-extract.ts`
 * chỉ điều phối các extractor thuần) và `type`-only từ `kb-chunk-store.ts`
 * (import kiểu bị TypeScript XOÁ HẲN lúc build/chạy, không kéo theo
 * `conversation/database.ts` mà file đó import ở đầu).
 *
 * Chỉ nhận buffer (đã transfer, xem cảnh báo pool ở file gọi) + định dạng +
 * tham số cắt đoạn qua `workerData`; trả chữ đã trích và đoạn đã cắt qua
 * `postMessage` - luồng chính tự ghi DB sau khi nhận.
 */

type DuLieuVao = { buf: ArrayBuffer; dinhDang: DinhDangKb; thamSoCat: ThamSoCat };

export type ThongDiepTuWorker = { ok: true; chu: string; doan: DoanMoi[] } | { ok: false; loi: string };

async function chay(): Promise<void> {
  const { buf, dinhDang, thamSoCat } = workerData as DuLieuVao;
  try {
    const chu = await docChuTuFile(Buffer.from(buf), dinhDang);
    const doan = catThanhDoan(chu, thamSoCat);
    const ketQua: ThongDiepTuWorker = { ok: true, chu, doan };
    parentPort?.postMessage(ketQua);
  } catch (err) {
    // Lỗi trích xuất THƯỜNG (file hỏng, định dạng lạ, đọc không ra chữ) - đóng
    // gói thành chuỗi rồi gửi về, KHÔNG ném ra ngoài (worker ném ra ngoài thì
    // Node phát sự kiện 'error' và tự terminate worker - luồng chính không
    // phân biệt được đây là lỗi NỘI DUNG hay worker CHẾT BẤT THƯỜNG, hai loại
    // cần xử lý khác nhau, xem `chay-trich-xuat-tach-luong.ts`).
    const loi = err instanceof Error ? err.message : String(err);
    const ketQua: ThongDiepTuWorker = { ok: false, loi };
    parentPort?.postMessage(ketQua);
  }
}

void chay();
