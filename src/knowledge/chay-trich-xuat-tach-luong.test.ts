import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { Worker } from "node:worker_threads";
// Module thuần (worker/extractor không chạm env/DB, xem đầu file
// chay-trich-xuat-tach-luong.ts) - import tĩnh được, giống extract-docx-text.test.ts.
import { LoiTrichXuatBiNgatGiuaChung, trichXuatTachLuong } from "./chay-trich-xuat-tach-luong.js";
import type { ThamSoCat } from "./chunk-text.js";
import { bomQuayCpuDocx } from "./kb-slow-docx-test-fixture.js";
import { docxChiCoAnh, docxNhieuChu } from "./ooxml-zip-test-helper.js";

const MAC_DINH: ThamSoCat = { coDoanToiDa: 1600, chongLan: 10 };

/**
 * Theo dõi "luồng chính có sống trong lúc worker chạy không" mà KHÔNG phụ
 * thuộc lịch của hệ điều hành.
 *
 * Cách CŨ (`assert.ok(nhip.length >= 10)` trên cửa sổ 300 ms, kỳ vọng ~30) chỉ
 * chịu được hệ số 3x, mà `node --test` chạy nhiều file SONG SONG nên tải thật
 * cao hơn hẳn - đo được đỏ 2/2 lần khi chạy full suite kèm 12 tiến trình đốt
 * CPU, với thông điệp "chỉ chạy được 7 nhịp". Đếm ĐỦ N nhịp là đo tốc độ máy,
 * không phải đo thứ cần đo.
 *
 * Cách MỚI đo đúng bất biến: luồng chính phải ĐÁP ỨNG ít nhất một lần trong
 * NỬA ĐẦU quãng worker chạy. Nếu trích xuất chạy trên CÙNG luồng (đúng hồi quy
 * cần chặn - kiến trúc trước khi có worker thread), vòng lặp đồng bộ giữ chặt
 * event loop nên không nhịp nào phát được: mọi timer bị dồn lại, chỉ chạy SAU
 * khi nhả. Ngân sách ở đây là NỬA quãng (~150ms trên quãng 300ms) cho MỘT lần
 * đáp ứng của một interval 10ms - rộng gấp bội so với "đếm đủ 10 nhịp", mà một
 * luồng bị khoá thì vẫn trượt bất kể máy nhanh cỡ nào.
 *
 * Vì sao NỬA ĐẦU chứ không phải "có nhịp nào đó trong cả quãng": bản đầu viết
 * kiểu sau và phép phá cho thấy nó QUÁ YẾU - chèn một vòng khoá 400ms vào đầu
 * `trichXuatTachLuong` vẫn XANH, vì phần sau của quãng chạy bình thường nên
 * thừa nhịp để thoả. Neo vào nửa đầu bắt được cả ca khoá MỘT PHẦN.
 */
function theoDoiNhipLuongChinh(): { dung(): void; khangDinhKhongBiKhoa(batDau: number, ketThuc: number): void } {
  const nhip: number[] = [];
  const dem = setInterval(() => nhip.push(Date.now()), 10);
  dem.unref(); // không cho interval này tự giữ tiến trình sống dù có quên dọn
  return {
    dung: () => clearInterval(dem),
    khangDinhKhongBiKhoa(batDau, ketThuc) {
      const giua = batDau + (ketThuc - batDau) / 2;
      const nuaDau = nhip.filter((t) => t > batDau && t <= giua);
      assert.ok(
        nuaDau.length >= 1,
        `luồng chính KHÔNG đáp ứng lần nào trong ${Math.round(giua - batDau)}ms đầu của quãng ` +
          `${ketThuc - batDau}ms worker làm việc (tổng ${nhip.length} nhịp, ` +
          `${nhip.filter((t) => t > batDau && t < ketThuc).length} nhịp trong cả quãng) - bị khoá`,
      );
    },
  };
}

describe("trichXuatTachLuong - trích xuất + cắt đoạn trong worker thread", () => {
  it("trích xuất .txt thành công, trả đúng chữ và đoạn đã cắt qua worker", async () => {
    const buf = Buffer.from("# Bảo hành\n\n12 tháng kể từ ngày mua", "utf-8");
    const ket = await trichXuatTachLuong({ buf, dinhDang: "txt", thamSoCat: MAC_DINH, hanMs: 5000 });
    assert.match(ket.chu, /12 tháng kể từ ngày mua/);
    assert.ok(ket.doan.length > 0, "phải cắt ra ít nhất 1 đoạn");
    assert.equal(ket.doan[0]!.tieuDe, "Bảo hành");
  });

  it("lỗi trích xuất THƯỜNG (docx chỉ có ảnh, không chữ) reject với đúng thông điệp, không đợi hết hanMs", async () => {
    const bd = Date.now();
    await assert.rejects(
      () => trichXuatTachLuong({ buf: docxChiCoAnh(), dinhDang: "docx", thamSoCat: MAC_DINH, hanMs: 5000 }),
      /không đọc được chữ nào/i,
    );
    const mat = Date.now() - bd;
    assert.ok(mat < 2000, `lỗi nội dung phải reject nhanh, không rơi vào nhánh quá hạn - mất ${mat}ms`);
  });

  it("buffer nhỏ dùng chung pool với buffer khác không bị hỏng khi transfer sang worker", async () => {
    // Buffer nhỏ (dưới Buffer.poolSize>>>1, mặc định 4096 byte) có thể là một
    // LÁT của một ArrayBuffer pool dùng CHUNG cho nhiều buffer cấp phát liền
    // kề - transfer thẳng buf.buffer (zero-copy) sẽ DETACH cả pool, xoá sạch
    // MỌI buffer khác đang mượn cùng pool, không riêng gì buffer đang transfer.
    const giuNguyen = Buffer.allocUnsafe(10);
    giuNguyen.write("BEN_CANH_1", "utf-8");
    const buf = Buffer.from("noi dung nho, cung pool", "utf-8");
    assert.equal(buf.buffer, giuNguyen.buffer, "tiền đề test sai: 2 buffer này phải chung một pool ArrayBuffer");

    const ket = await trichXuatTachLuong({ buf, dinhDang: "txt", thamSoCat: MAC_DINH, hanMs: 5000 });

    assert.equal(ket.chu, "noi dung nho, cung pool");
    assert.equal(giuNguyen.toString("utf-8"), "BEN_CANH_1", "buffer khác dùng chung pool bị hỏng sau khi transfer");
  });

  it("worker vượt trần RAM thì REJECT đúng loại lỗi, và TIẾN TRÌNH TEST VẪN SỐNG", async () => {
    // Cầu dao THỨ HAI (song song với `hanMs`): tài liệu phình bộ nhớ chết
    // trước khi trần thời gian kịp tới, nên `terminate()` không cứu được.
    //
    // Đo trên Node 24.11.1: `resourceLimits` MẶC ĐỊNH là
    // `maxOldGenerationSizeMb: 4096` - worker cấp phát được 4092 MB rồi mới
    // `ERR_WORKER_OUT_OF_MEMORY`, quá xa ngân sách 768 MB của container. Đặt
    // trần rồi thì worker dừng đúng ở mốc xin (đo: xin 64 -> 56 MB, xin 256 ->
    // 252 MB). Test này KHÔNG khẳng định cầu dao LUÔN cho một lỗi bắt được -
    // xem "HAI GIỚI HẠN" ở `TRAN_RAM_WORKER_MB`; nó chỉ khẳng định đường đã
    // nối đúng ở hình dạng cấp phát này.
    //
    // Hạ trần xuống 16 MB thay vì dựng "bom RAM": mọi trần ở `ooxml-limits.ts`
    // được đặt CHÍNH ĐỂ không tài liệu hợp lệ nào ăn nổi hàng trăm MB, nên
    // không có bom hợp lệ nào để dựng. Tài liệu 6 MB chữ dưới đây HỢP LỆ hoàn
    // toàn - chỉ vượt cái trần 16 MB cố tình hạ thấp của riêng test này.
    const nhip = theoDoiNhipLuongChinh();
    const batDau = Date.now();
    let loi: unknown;
    try {
      await assert.rejects(
        () =>
          trichXuatTachLuong({
            buf: docxNhieuChu(6),
            dinhDang: "docx",
            thamSoCat: MAC_DINH,
            hanMs: 60_000, // rộng rãi: phải rơi vào nhánh RAM, không phải nhánh quá hạn
            tranRamMb: 16,
          }).catch((e: unknown) => {
            loi = e;
            throw e;
          }),
        /dừng bất thường/i,
      );
      // Đúng LOẠI lỗi: `kb-ingest-worker.ts` dùng `instanceof` để quyết định
      // "để nguyên dang_xu_ly" (thử lại) hay "đánh hong ngay". Hết RAM là ca
      // KHÔNG BIẾT tài liệu hỏng thật hay máy đang chật - phải đi nhánh thử lại.
      assert.ok(
        loi instanceof LoiTrichXuatBiNgatGiuaChung,
        `phải là LoiTrichXuatBiNgatGiuaChung, nhận được: ${String(loi)}`,
      );
      assert.match(
        (loi as Error).message,
        /out of memory/i,
        `phải giữ nguyên mã lỗi gốc của Node để chẩn đoán được: ${(loi as Error).message}`,
      );
      // Phần ĐẮT GIÁ NHẤT của ca này: tiến trình test còn sống để chạy tiếp
      // tới đây (OOM worker không kéo theo tiến trình cha), và luồng chính
      // không hề bị khoá trong lúc worker ngốn RAM.
      nhip.khangDinhKhongBiKhoa(batDau, Date.now());
    } finally {
      nhip.dung();
    }
  });

  // Test QUAN TRỌNG NHẤT của phase - đo đúng thứ bị hỏng: luồng chính có sống
  // không khi worker quay CPU 100%. Khẳng định bằng "có nhịp nào rơi vào GIỮA
  // quãng worker chạy không" (xem `theoDoiNhipLuongChinh`), KHÔNG phải đếm đủ
  // N nhịp: đếm đủ N là đo tốc độ máy, và đã đo được đỏ 2/2 lần khi chạy full
  // suite kèm 12 tiến trình đốt CPU ("chỉ chạy được 7 nhịp" trên sàn 10).
  //
  // KỶ LUẬT DỌN TÀI NGUYÊN kép, cố ý: `dem.unref()` NGAY sau khi tạo (không
  // cho interval này tự giữ tiến trình sống dù có quên dọn) VÀ `clearInterval`
  // nằm trong `finally` bao TRỌN mọi khẳng định (không riêng gì khẳng định
  // cuối). Bản trước của test này đặt hai khẳng định TRONG `try` nhưng
  // `clearInterval` lại nằm SAU `finally` - khẳng định nào ném là interval
  // không bao giờ được dọn, và thiếu `unref()` thì tiến trình `node --test`
  // treo VÔ HẠN thay vì thoát (đo thật: `timeout 25 node --test` trả rc=124,
  // xem báo cáo phase để đọc lại lần đo và phần chẩn đoán đã sửa).
  it("trích xuất quá hạn thì worker bị terminate và ném lỗi, luồng chính KHÔNG treo", async () => {
    const nhip = theoDoiNhipLuongChinh();
    const batDau = Date.now();

    // Theo dõi terminate() có THẬT SỰ được gọi không - độc lập với số nhịp đo
    // được ở dưới. Trên máy nhiều lõi, không gọi terminate() vẫn có thể để lọt
    // test đo nhịp (worker mồ côi chạy tiếp trên lõi RẢNH, không tranh CPU với
    // luồng chính) - `mock.method` giữ nguyên hành vi thật (vẫn gọi qua bản
    // gốc, capture qua `originalTerminate` để KHÔNG đệ quy vào chính mock) nên
    // đây KHÔNG phải giả lập, chỉ THÊM hai điểm quan sát: đã GỌI terminate()
    // (đếm) và worker đã THẬT SỰ CHẾT (sự kiện 'exit' của chính instance đó -
    // gọi terminate() không chứng minh worker chết, chỉ chứng minh có gọi).
    const originalTerminate = Worker.prototype.terminate;
    let thoatWorker: Promise<void> | undefined;
    const terminateMock = mock.method(
      Worker.prototype,
      "terminate",
      function (this: Worker, ...args: Parameters<typeof originalTerminate>) {
        // Đăng ký listener 'exit' NGAY TRONG lời gọi terminate() - trước cả
        // khi originalTerminate chạy - để không lỡ mất sự kiện nếu nó bắn ra
        // sớm hơn dự kiến (đăng ký SAU một `await` là có cửa sổ lỡ mất).
        thoatWorker = new Promise<void>((resolve) => this.once("exit", () => resolve()));
        return originalTerminate.apply(this, args);
      },
    );

    let loi: unknown;
    try {
      await assert.rejects(
        () =>
          trichXuatTachLuong({ buf: bomQuayCpuDocx(), dinhDang: "docx", thamSoCat: MAC_DINH, hanMs: 300 }).catch(
            (e: unknown) => {
              loi = e;
              throw e;
            },
          ),
        /quá thời gian/i,
      );

      assert.equal(terminateMock.mock.callCount(), 1, "worker.terminate() phải được gọi ĐÚNG 1 lần khi quá hạn");
      nhip.khangDinhKhongBiKhoa(batDau, Date.now());
      // Đúng LOẠI lỗi, không chỉ đúng chuỗi - kb-ingest-worker.ts dùng `instanceof`
      // để quyết định "để nguyên dang_xu_ly" hay "đánh hong ngay", một message
      // trùng khớp tình cờ từ lỗi loại khác sẽ đi nhầm nhánh.
      assert.ok(loi instanceof LoiTrichXuatBiNgatGiuaChung, "phải là LoiTrichXuatBiNgatGiuaChung, không phải Error thường");

      // Khẳng định QUAN TRỌNG NHẤT của test này: worker THẬT SỰ chết (sự kiện
      // 'exit' bắn ra), không chỉ terminate() được GỌI.
      //
      // Trần 3000ms (KHÔNG phải 300ms như bản đầu): trần này chỉ để phân biệt
      // "có gọi terminate()" với "không bao giờ exit" - phép phá tương ứng (bỏ
      // hẳn terminate()) KHÔNG BAO GIỜ resolve, nên nới rộng 10 lần vẫn phân
      // biệt được y hệt, chỉ bỏ đi phần nhấp nháy khi máy đang bận. 300ms quá
      // sát: chi phí terminate() thật chỉ ~2,2ms nhưng một máy đang chạy đầy
      // tiến trình khác có thể trễ lịch hơn thế nhiều lần.
      assert.ok(thoatWorker, "terminate() không được gọi nên không có gì để theo dõi sự kiện exit");
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          thoatWorker,
          new Promise((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error("worker không tự thoát (sự kiện 'exit') trong 3000ms sau khi bị terminate()")),
              3000,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    } finally {
      terminateMock.mock.restore();
      nhip.dung();
    }
  });
});
