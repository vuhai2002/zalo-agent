import {
  chayTienTrinhCon,
  LoiTienTrinhConBiNgat,
  LoiTuTienTrinhCon,
  urlScriptCon,
} from "../shared/chay-tien-trinh-con-co-tran.js";
import { xepHangTrichXuat } from "../shared/hang-doi-trich-xuat.js";
import type { ThamSoCat } from "./chunk-text.js";
import type { DinhDangKb } from "./doc-text-extract.js";
import type { DoanMoi } from "./kb-chunk-store.js";

/**
 * Trích xuất + cắt đoạn một nguồn Kho tri thức trong TIẾN TRÌNH CON, xếp
 * chung hàng đợi 1-việc với tệp chat. Con KHÔNG mở SQLite (bất biến "một
 * connection cho cả process") - nó chỉ trả `{chu, doan}`, luồng chính tự ghi.
 *
 * Lịch sử: bản trước chạy trong worker thread với `resourceLimits`. Hai lỗ đo
 * được bằng PoC khiến phải bỏ:
 *  1. Bộ nhớ NGOÀI heap: PDF 128 KB có luồng Flate bom phình thành 385 MB
 *     ArrayBuffer, worker vẫn trả "ok", container 768 MB chết. `resourceLimits`
 *     chỉ thấy heap JS.
 *  2. V8 vượt heap trong worker có lúc `abort()` CẢ tiến trình (exit 134) thay
 *     vì phát `ERR_WORKER_OUT_OF_MEMORY` - kéo chết mọi account Zalo.
 * Tiến trình con thì SIGKILL luôn an toàn và RSS đo được từ ngoài
 * (`chay-tien-trinh-con-co-tran.ts`).
 */

export type KetQuaTrichXuat = { chu: string; doan: DoanMoi[] };

/** Trần heap mặc định của tiến trình con (MB) khi caller không truyền */
export const TRAN_HEAP_CON_MAC_DINH_MB = 192;
/** Trần RSS mặc định của tiến trình con (MB) khi caller không truyền */
export const TRAN_RSS_CON_MAC_DINH_MB = 320;

/**
 * Con bị buộc dừng GIỮA CHỪNG (quá hạn, vượt trần RAM, chết bất thường) -
 * khác hẳn lỗi trích xuất THƯỜNG (file hỏng). Ở ca này KHÔNG BIẾT tài liệu
 * hỏng thật hay chỉ máy chậm/chật, nên `kb-ingest-worker.ts` KHÔNG đánh
 * "hong" ngay mà để `goNguonKetDauTick()` quyết định thử lại hay bỏ.
 */
export class LoiTrichXuatBiNgatGiuaChung extends Error {}

const SCRIPT_CON = urlScriptCon("./kb-extract-child", import.meta.url);

export async function trichXuatTachLuong(p: {
  buf: Buffer;
  dinhDang: DinhDangKb;
  thamSoCat: ThamSoCat;
  hanMs: number;
  /** Trần HEAP của con (MB). Nhận qua tham số, không tự `getTuning`: module phải THUẦN */
  tranRamMb?: number;
  /** Trần RSS của con (MB) - bắt cả bộ nhớ ngoài heap */
  tranRssMb?: number;
  /** Xem `chayTienTrinhCon` - caller tự log vì module này thuần */
  baoKhongDoDuocRss?: () => void;
}): Promise<KetQuaTrichXuat> {
  try {
    return await xepHangTrichXuat(() =>
      chayTienTrinhCon<{ buf: Buffer; dinhDang: DinhDangKb; thamSoCat: ThamSoCat }, KetQuaTrichXuat>({
        script: SCRIPT_CON,
        duLieu: { buf: p.buf, dinhDang: p.dinhDang, thamSoCat: p.thamSoCat },
        baoKhongDoDuocRss: p.baoKhongDoDuocRss,
        tran: {
          hanMs: p.hanMs,
          tranHeapMb: p.tranRamMb ?? TRAN_HEAP_CON_MAC_DINH_MB,
          tranRssMb: p.tranRssMb ?? TRAN_RSS_CON_MAC_DINH_MB,
        },
      }),
    );
  } catch (err) {
    if (err instanceof LoiTienTrinhConBiNgat) throw new LoiTrichXuatBiNgatGiuaChung(err.message);
    // Lỗi NỘI DUNG do con báo: trả về Error thường mang đúng câu của extractor
    if (err instanceof LoiTuTienTrinhCon) throw new Error(err.message);
    throw err;
  }
}
