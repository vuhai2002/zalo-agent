import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { Worker } from "node:worker_threads";
// Module thuần (worker/extractor không chạm env/DB, xem đầu file
// chay-trich-xuat-tach-luong.ts) - import tĩnh được, giống extract-docx-text.test.ts.
import { LoiTrichXuatBiNgatGiuaChung, trichXuatTachLuong } from "./chay-trich-xuat-tach-luong.js";
import type { ThamSoCat } from "./chunk-text.js";
import { bomQuayCpuDocx } from "./kb-slow-docx-test-fixture.js";
import { docxChiCoAnh } from "./ooxml-zip-test-helper.js";

const MAC_DINH: ThamSoCat = { coDoanToiDa: 1600, chongLan: 10 };

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

  // Test QUAN TRỌNG NHẤT của phase - đo đúng thứ bị hỏng: luồng chính có sống
  // không khi worker quay CPU 100%. Khẳng định theo SỐ NHỊP chạy được, không
  // theo thời gian tổng (thời gian tổng dao động theo máy, số nhịp thì không).
  it("trích xuất quá hạn thì worker bị terminate và ném lỗi, luồng chính KHÔNG treo", async () => {
    const nhipTruoc: number[] = [];
    const dem = setInterval(() => nhipTruoc.push(Date.now()), 10);

    // Theo dõi terminate() có THẬT SỰ được gọi không - độc lập với số nhịp đo
    // được ở dưới. Trên máy nhiều lõi, không gọi terminate() vẫn có thể để lọt
    // test đo nhịp (worker mồ côi chạy tiếp trên lõi RẢNH, không tranh CPU với
    // luồng chính) - `mock.method` giữ nguyên hành vi thật (vẫn gọi qua bản
    // gốc) nên đây KHÔNG phải giả lập, chỉ THÊM một điểm quan sát.
    const terminateMock = mock.method(Worker.prototype, "terminate");

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
    } finally {
      terminateMock.mock.restore();
    }

    clearInterval(dem);
    assert.ok(nhipTruoc.length >= 10, `luồng chính chỉ chạy được ${nhipTruoc.length} nhịp trong lúc worker quay CPU - vẫn bị khoá`);
    // Đúng LOẠI lỗi, không chỉ đúng chuỗi - kb-ingest-worker.ts dùng `instanceof`
    // để quyết định "để nguyên dang_xu_ly" hay "đánh hong ngay", một message
    // trùng khớp tình cờ từ lỗi loại khác sẽ đi nhầm nhánh.
    assert.ok(loi instanceof LoiTrichXuatBiNgatGiuaChung, "phải là LoiTrichXuatBiNgatGiuaChung, không phải Error thường");
  });
});
