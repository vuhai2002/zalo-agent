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
 * HAI cầu dao, cho HAI loại tài liệu độc khác nhau - cần cả hai:
 *
 * 1. CPU (`hanMs` + `worker.terminate()`): đặt timeout cho code ĐỒNG BỘ đang
 *    quay CPU trên CÙNG một luồng là KHÔNG LÀM ĐƯỢC - `setTimeout`/
 *    `AbortSignal` chỉ được xét ở RANH GIỚI event loop, mà một vòng lặp/regex
 *    đồng bộ đang quay không bao giờ nhả ranh giới đó cho tới khi xong.
 *    `worker.terminate()` là cách DUY NHẤT có thật để dừng nó - đo được cắt
 *    một vòng lặp CPU đồng bộ trong 2,2 ms (xem báo cáo nghiên cứu phase này,
 *    mục "Câu hỏi 2"). Đừng thử lại hướng timeout-trên-cùng-luồng.
 *
 * 2. RAM (`resourceLimits`): trần thời gian KHÔNG chặn được tài liệu phình bộ
 *    nhớ NHANH - nó chết trước khi `hanMs` kịp tới. Xem `TRAN_RAM_WORKER_MB`
 *    ngay dưới cho số đo, cách suy con số, và HAI GIỚI HẠN của cầu dao này.
 */

export type KetQuaTrichXuat = { chu: string; doan: DoanMoi[] };

/**
 * Trần RAM MẶC ĐỊNH cho worker trích xuất, dùng khi caller không truyền
 * `tranRamMb` (mọi đường chạy thật đều truyền từ `getTuning`; hằng số này là
 * lưới an toàn cho test và cho lời gọi trực tiếp).
 *
 * Vì sao BẮT BUỘC phải đặt: đo trên Node 24.11.1, `resourceLimits` MẶC ĐỊNH
 * của worker là `maxOldGenerationSizeMb: 4096` - worker được phép phình tới
 * ~4 GB (đo thật: cấp phát được 4092 MB rồi mới `ERR_WORKER_OUT_OF_MEMORY`)
 * trong một container 768 MB. Đặt trần rồi thì worker dừng đúng ở mốc xin
 * (xin 64 -> cấp phát được 56 MB; xin 256 -> 252 MB).
 *
 * TRẦN THẬT = `maxOld + maxYoung`, KHÔNG phải riêng `maxOld` - đo
 * `v8.getHeapStatistics().heap_size_limit` ngay trong worker:
 *
 *   maxOld=192, young MẶC ĐỊNH (192) -> 384 MB
 *   maxOld=192, young=32             -> 240 MB
 *   maxOld=512, young MẶC ĐỊNH       -> 704 MB
 *
 * Vì vậy PHẢI đặt `maxYoungGenerationSizeMb` tường minh: để mặc định thì mỗi
 * MB xin cho old space kéo theo 192 MB young space không ai xin, và
 * 384 (worker) + ~384 (old space luồng chính, `docs/system-architecture.md`)
 * = trọn 768 MB ngân sách container, không còn một byte đệm cho RSS overhead
 * (đo: RSS 321 MB khi `heapUsed` mới 206 MB). 32 MB young là dư cho một worker
 * chỉ đọc luồng rồi cắt đoạn; trần thật thành 192 + 32 = 240 MB.
 *
 * HAI GIỚI HẠN phải biết trước khi tin vào cầu dao này:
 *
 * 1. KHÔNG ĐẢM BẢO bắt được thành `'error'`. Thường thì vượt trần cho
 *    `ERR_WORKER_OUT_OF_MEMORY` và luồng chính sống (đo ở đây: 8/8 mốc từ 16
 *    tới 512 MB, hai hình dạng cấp phát). Nhưng vòng rà soát đo được hình dạng
 *    cấp phát KHÁC làm V8 `abort()` CẢ TIẾN TRÌNH ("FATAL ERROR: Reached heap
 *    limit", exit 134, không sự kiện JS nào) ở đúng mốc 128 và 192, trong khi
 *    các mốc khác vẫn sạch - tức kết quả là hàm của (trần, HÌNH DẠNG cấp
 *    phát), không phải của riêng con số. Đừng viết ở đâu rằng trần này biến
 *    OOM thành lỗi bắt được.
 * 2. CHỈ chặn HEAP JS, KHÔNG chặn bộ nhớ NGOÀI heap. `ArrayBuffer`/`Buffer`/
 *    `TypedArray` là external memory: đo được worker trần `maxOld=16` cấp phát
 *    trọn 6.000 MB `Float64Array` rồi kết thúc BÌNH THƯỜNG (exit 0). Đường PDF
 *    (`extract-pdf-text.ts` -> `getDocumentProxy(new Uint8Array(buf))`, pdfjs
 *    làm việc trên typed array) nằm gần như trọn ngoài tầm cầu dao này.
 *
 * CẢNH BÁO khi đo lại: nếu tiến trình cha chạy KÈM `--max-old-space-size`, cờ
 * đó (cờ V8 toàn tiến trình) ĐÈ luôn `resourceLimits` của worker - đo được
 * worker dừng ở cùng một mốc cho mọi giá trị xin vào. Bot không đặt cờ này
 * (không có `NODE_OPTIONS` trong Dockerfile lẫn compose) nên trần dưới đây có
 * tác dụng thật; đừng thêm cờ đó mà không đo lại.
 */
export const TRAN_RAM_WORKER_MB = 192;

/**
 * Young generation của worker. Đặt TƯỜNG MINH vì mặc định là 192 MB - cộng
 * thẳng vào trần thật (xem bảng đo ở `TRAN_RAM_WORKER_MB`), biến "xin 192"
 * thành 384 MB. Worker này chỉ đọc theo luồng rồi cắt đoạn: vòng đời phần lớn
 * là chuỗi lớn đi thẳng vào old space, không phải rác trẻ ngắn hạn.
 */
const TRAN_RAM_YOUNG_WORKER_MB = 32;

/**
 * Worker bị buộc dừng GIỮA CHỪNG (quá hạn `hanMs`, hoặc tự chết bất thường -
 * uncaught exception, vượt trần RAM `resourceLimits`) - khác hẳn lỗi trích xuất THƯỜNG
 * (file hỏng, ok:false từ chính worker). Ở ca này KHÔNG BIẾT tài liệu có hỏng
 * thật hay chỉ máy chậm/OOM thoáng qua, nên caller (`kb-ingest-worker.ts`)
 * KHÔNG được đánh "hong" ngay - phải để nguyên `dang_xu_ly`, chờ
 * `goNguonKetDauTick()` (đọc `so_lan_thu`, chạy đầu mỗi tick) quyết định thử
 * lại hay bỏ hẳn. Xem thêm phần đầu file đó.
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
  /** Trần RAM (MB) cho worker - mặc định `TRAN_RAM_WORKER_MB`. Nhận qua tham
   * số chứ KHÔNG tự đọc `getTuning` ở đây: module này phải giữ THUẦN (không
   * chạm env/DB) để test import tĩnh được, đúng cách `hanMs` đang làm. */
  tranRamMb?: number;
}): Promise<KetQuaTrichXuat> {
  return new Promise((resolve, reject) => {
    const ab = arrayBufferRiengDeTransfer(p.buf);
    const worker = new Worker(URL_WORKER, {
      workerData: { buf: ab, dinhDang: p.dinhDang, thamSoCat: p.thamSoCat },
      transferList: [ab],
      // Cầu dao RAM. Vượt trần THƯỜNG cho `'error'` với
      // `ERR_WORKER_OUT_OF_MEMORY` (rơi đúng nhánh `worker.once("error")` bên
      // dưới) nhưng KHÔNG ĐẢM BẢO, và không chặn bộ nhớ ngoài heap - đọc kỹ
      // "HAI GIỚI HẠN" ở `TRAN_RAM_WORKER_MB` trước khi dựa vào nó.
      //
      // `maxYoungGenerationSizeMb` PHẢI đặt cùng: trần thật là tổng hai số,
      // để mặc định là cộng thêm 192 MB không ai xin.
      resourceLimits: {
        maxOldGenerationSizeMb: p.tranRamMb ?? TRAN_RAM_WORKER_MB,
        maxYoungGenerationSizeMb: TRAN_RAM_YOUNG_WORKER_MB,
      },
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
