import { Worker } from "node:worker_threads";
import type { ThamSoCat } from "./chunk-text.js";
import type { DinhDangKb } from "./doc-text-extract.js";
import type { ThongDiepTuWorker } from "./kb-extract-worker.js";
import type { DoanMoi } from "./kb-chunk-store.js";

/**
 * Chạy trích xuất + cắt đoạn trong `node:worker_threads`, KHÔNG mở kết nối
 * SQLite (bất biến "một connection cho cả process" - worker chỉ trích xuất và
 * cắt đoạn, luồng chính tự ghi DB sau khi nhận kết quả qua `postMessage`).
 *
 * Đặt timeout cho code ĐỒNG BỘ đang quay CPU trên CÙNG một luồng là KHÔNG LÀM
 * ĐƯỢC: `setTimeout`/`AbortSignal` chỉ được xét ở RANH GIỚI event loop, mà một
 * vòng lặp/regex đồng bộ đang quay không bao giờ nhả ranh giới đó cho tới khi
 * xong. `worker.terminate()` là cách DUY NHẤT có thật để dừng nó - đo được cắt
 * một vòng lặp CPU đồng bộ trong 2,2 ms (xem báo cáo nghiên cứu phase này,
 * mục "Câu hỏi 2"). Đừng thử lại hướng timeout-trên-cùng-luồng.
 */

export type KetQuaTrichXuat = { chu: string; doan: DoanMoi[] };

/**
 * Worker bị buộc dừng GIỮA CHỪNG (quá hạn `hanMs`, hoặc tự chết bất thường -
 * uncaught exception, `resourceLimits`...) - khác hẳn lỗi trích xuất THƯỜNG
 * (file hỏng, ok:false từ chính worker). Ở ca này KHÔNG BIẾT tài liệu có hỏng
 * thật hay chỉ máy chậm/OOM thoáng qua, nên caller (`kb-ingest-worker.ts`)
 * KHÔNG được đánh "hong" ngay - phải để nguyên `dang_xu_ly`, chờ
 * `goNguonKetLucKhoiDong()` (đọc `so_lan_thu`, gọi lúc khởi động lại) quyết
 * định thử lại hay bỏ hẳn. Xem thêm phần đầu file đó.
 */
export class LoiTrichXuatBiNgatGiuaChung extends Error {}

const URL_WORKER = new URL("./kb-extract-worker.js", import.meta.url);

/**
 * Buffer nhỏ (dưới `Buffer.poolSize >>> 1`, mặc định 4096 byte) có thể chỉ là
 * MỘT LÁT của một `ArrayBuffer` pool dùng CHUNG cho nhiều `Buffer.allocUnsafe`/
 * `Buffer.from(string)` cấp phát liền kề (đo thật trên Node 24: hai buffer nhỏ
 * cấp liên tiếp CÙNG một `buf.buffer`, pool 8192 byte). Transfer thẳng
 * `buf.buffer` (zero-copy) sẽ DETACH cả pool - xoá sạch MỌI buffer khác đang
 * mượn cùng pool tại thời điểm transfer, kể cả buffer không liên quan gì tới
 * lần trích xuất này (vd một `randomBytes()` sinh id ở nơi khác trong tiến
 * trình, xảy ra đúng lúc). Chỉ transfer thẳng khi buffer sở hữu TRỌN
 * `ArrayBuffer` của nó (file lớn - trường hợp thường gặp, được zero-copy thật
 * sự); ngược lại sao chép ra một `ArrayBuffer` riêng trước khi transfer.
 */
function arrayBufferRiengDeTransfer(buf: Buffer): ArrayBuffer {
  if (buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength) {
    return buf.buffer as ArrayBuffer;
  }
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export function trichXuatTachLuong(p: {
  buf: Buffer;
  dinhDang: DinhDangKb;
  thamSoCat: ThamSoCat;
  hanMs: number;
}): Promise<KetQuaTrichXuat> {
  return new Promise((resolve, reject) => {
    const ab = arrayBufferRiengDeTransfer(p.buf);
    const worker = new Worker(URL_WORKER, {
      workerData: { buf: ab, dinhDang: p.dinhDang, thamSoCat: p.thamSoCat },
      transferList: [ab],
    });

    // Chặn settle (resolve/reject) hai lần: nhiều sự kiện (message/error/exit)
    // có thể bắn liên tiếp sau khi đã settle một lần (vd terminate() sau khi
    // nhận message vẫn có thể kéo theo 'exit').
    let daXong = false;

    const hetHan = setTimeout(() => {
      if (daXong) return;
      daXong = true;
      // Đây là cách DUY NHẤT dừng được code đồng bộ đang quay CPU - xem
      // comment đầu file, không có cách nào làm việc đó trên cùng một luồng.
      void worker.terminate();
      reject(
        new LoiTrichXuatBiNgatGiuaChung(
          `Trích xuất quá thời gian cho phép (${p.hanMs}ms) - tài liệu này có thể chứa dữ liệu gây treo`,
        ),
      );
    }, p.hanMs);
    hetHan.unref();

    worker.once("message", (msg: ThongDiepTuWorker) => {
      if (daXong) return;
      daXong = true;
      clearTimeout(hetHan);
      void worker.terminate();
      if (msg.ok) resolve({ chu: msg.chu, doan: msg.doan });
      else reject(new Error(msg.loi));
    });

    worker.once("error", (err: Error) => {
      if (daXong) return;
      daXong = true;
      clearTimeout(hetHan);
      reject(new LoiTrichXuatBiNgatGiuaChung(`Worker trích xuất dừng bất thường: ${err.message}`));
    });

    worker.once("exit", (code) => {
      if (daXong) return;
      daXong = true;
      clearTimeout(hetHan);
      reject(
        new LoiTrichXuatBiNgatGiuaChung(`Worker trích xuất thoát bất thường (mã ${code}) mà không trả kết quả`),
      );
    });
  });
}
