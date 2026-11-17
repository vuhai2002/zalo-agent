import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { taoPdfBomFlate } from "./fixtures/tao-pdf-thu-nghiem.js";
// Module thuần (worker/extractor không chạm env/DB, xem đầu file
// chay-trich-xuat-tach-luong.ts) - import tĩnh được, giống extract-docx-text.test.ts.
import { LoiTrichXuatBiNgatGiuaChung, trichXuatTachLuong } from "./chay-trich-xuat-tach-luong.js";
import type { ThamSoCat } from "./chunk-text.js";
import { bomQuayCpuDocx } from "./kb-slow-docx-test-fixture.js";
import { docxChiCoAnh, docxNhieuChu } from "./ooxml-zip-test-helper.js";

const MAC_DINH: ThamSoCat = { coDoanToiDa: 1600, chongLan: 10 };

/**
 * Hạn RỘNG RÃI cho các ca KHÔNG đo hạn giờ (trích xuất thành công, giữ nguyên
 * buffer, lỗi nội dung). 5000ms từng đủ trên máy rảnh nhưng ĐỎ khi chạy full
 * suite kèm 12 tiến trình đốt CPU - worker mất hơn 5 giây chỉ để khởi động rồi
 * đọc xong, thế là rơi nhầm vào nhánh quá hạn và ca test hỏng vì lý do chẳng
 * liên quan gì tới thứ nó định đo. Chỉ ca ĐO hạn giờ mới đặt hạn ngắn.
 */
const HAN_ROI_RAI = 60_000;

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

describe("trichXuatTachLuong - trích xuất + cắt đoạn trong tiến trình con", () => {
  it("trích xuất .txt thành công, trả đúng chữ và đoạn đã cắt qua tiến trình con", async () => {
    const buf = Buffer.from("# Bảo hành\n\n12 tháng kể từ ngày mua", "utf-8");
    const ket = await trichXuatTachLuong({ buf, dinhDang: "txt", thamSoCat: MAC_DINH, hanMs: HAN_ROI_RAI });
    assert.match(ket.chu, /12 tháng kể từ ngày mua/);
    assert.ok(ket.doan.length > 0, "phải cắt ra ít nhất 1 đoạn");
    assert.equal(ket.doan[0]!.tieuDe, "Bảo hành");
  });

  it("lỗi trích xuất THƯỜNG (docx chỉ có ảnh, không chữ) reject với đúng thông điệp, KHÔNG đi nhánh quá hạn", async () => {
    // Đo bằng LOẠI LỖI, không bằng đồng hồ. Bản trước khẳng định
    // `mat < 2000` với `hanMs: 5000` - suy ra "nhanh nghĩa là không phải nhánh
    // quá hạn", đúng về logic nhưng là phép đo tốc độ máy: đo được 5024ms (tức
    // ĐỎ) khi chạy full suite kèm 12 tiến trình đốt CPU. Hai nhánh này trả HAI
    // LOẠI lỗi khác nhau nên phân biệt được trực tiếp, không cần đồng hồ:
    // nhánh quá hạn cho `LoiTrichXuatBiNgatGiuaChung`, nhánh nội dung cho
    // `Error` thường. Khẳng định theo cấu trúc vừa mạnh hơn vừa không nhấp nháy.
    let loi: unknown;
    await assert.rejects(
      () =>
        trichXuatTachLuong({ buf: docxChiCoAnh(), dinhDang: "docx", thamSoCat: MAC_DINH, hanMs: HAN_ROI_RAI }).catch(
          (e: unknown) => {
            loi = e;
            throw e;
          },
        ),
      /không đọc được chữ nào/i,
    );
    assert.equal(
      loi instanceof LoiTrichXuatBiNgatGiuaChung,
      false,
      "lỗi NỘI DUNG bị gán nhầm thành lỗi bị ngắt giữa chừng - kb-ingest-worker sẽ thử lại thay vì đánh hong",
    );
  });

  it("buffer nhỏ dùng chung pool với buffer khác không bị hỏng khi gửi sang tiến trình con", async () => {
    // Buffer nhỏ (dưới Buffer.poolSize>>>1, mặc định 4096 byte) có thể là một
    // LÁT của một ArrayBuffer pool dùng CHUNG cho nhiều buffer cấp phát liền
    // kề - transfer thẳng buf.buffer (zero-copy) sẽ DETACH cả pool, xoá sạch
    // MỌI buffer khác đang mượn cùng pool, không riêng gì buffer đang transfer.
    const giuNguyen = Buffer.allocUnsafe(10);
    giuNguyen.write("BEN_CANH_1", "utf-8");
    const buf = Buffer.from("noi dung nho, cung pool", "utf-8");
    assert.equal(buf.buffer, giuNguyen.buffer, "tiền đề test sai: 2 buffer này phải chung một pool ArrayBuffer");

    const ket = await trichXuatTachLuong({ buf, dinhDang: "txt", thamSoCat: MAC_DINH, hanMs: HAN_ROI_RAI });

    assert.equal(ket.chu, "noi dung nho, cung pool");
    assert.equal(giuNguyen.toString("utf-8"), "BEN_CANH_1", "buffer khác dùng chung pool bị hỏng sau khi transfer");
  });

  it("tiến trình con vượt trần HEAP thì REJECT đúng loại lỗi, và TIẾN TRÌNH TEST VẪN SỐNG", async () => {
    // Trần heap (`--max-old-space-size` của con) hạ thấp để một tài liệu HỢP
    // LỆ 6 MB chữ vượt nó. V8 vượt heap thì abort CHÍNH tiến trình con - ở
    // worker thread cũ cùng cú abort đó kéo chết cả tiến trình cha (exit 134).
    // Trần RSS để rộng: ca này phải rơi đúng nhánh heap.
    // Dựng fixture TRƯỚC khi bật đồng hồ theo dõi: deflate 6 MB là việc đồng
    // bộ trên luồng chính, nằm trong quãng đo là tự khoá event loop.
    const buf = docxNhieuChu(6);
    const nhip = theoDoiNhipLuongChinh();
    const batDau = Date.now();
    let loi: unknown;
    try {
      await assert.rejects(
        () =>
          trichXuatTachLuong({
            buf,
            dinhDang: "docx",
            thamSoCat: MAC_DINH,
            hanMs: HAN_ROI_RAI,
            tranRamMb: 16,
            tranRssMb: 4000,
          }).catch((e: unknown) => {
            loi = e;
            throw e;
          }),
        /bất thường/i,
      );
      // `kb-ingest-worker.ts` dùng `instanceof` để chọn "thử lại" thay vì
      // "đánh hong": hết RAM là ca không biết tài liệu hỏng thật hay máy chật.
      assert.ok(
        loi instanceof LoiTrichXuatBiNgatGiuaChung,
        `phải là LoiTrichXuatBiNgatGiuaChung, nhận được: ${String(loi)}`,
      );
      assert.match((loi as Error).message, /heap|memory/i, `phải giữ dấu vết OOM để chẩn đoán: ${(loi as Error).message}`);
      nhip.khangDinhKhongBiKhoa(batDau, Date.now());
    } finally {
      nhip.dung();
    }
  });

  it("PDF bom Flate (bộ nhớ NGOÀI heap) bị giết theo trần RSS, tiến trình cha không phình", async () => {
    // Ca thật đo bằng PoC: PDF 128 KB -> 385 MB ArrayBuffer khi pdf.js đọc
    // chữ, worker thread cũ trả "ok" và container 768 MB chết. Trần heap
    // không thấy loại bộ nhớ này - chỉ trần RSS đo từ ngoài mới thấy.
    const bom = taoPdfBomFlate(256);
    const rssTruoc = process.memoryUsage().rss;
    let loi: unknown;
    await assert.rejects(
      () =>
        trichXuatTachLuong({
          buf: bom,
          dinhDang: "pdf",
          thamSoCat: MAC_DINH,
          hanMs: HAN_ROI_RAI,
          tranRssMb: 160,
        }).catch((e: unknown) => {
          loi = e;
          throw e;
        }),
      /vượt trần bộ nhớ/i,
    );
    assert.ok(loi instanceof LoiTrichXuatBiNgatGiuaChung);
    assert.ok(process.memoryUsage().rss - rssTruoc < 60 * 1024 * 1024, "RSS của cha không được phình theo con");
  });

  it("trích xuất quá hạn thì tiến trình con bị giết và ném lỗi, luồng chính KHÔNG treo", async () => {
    // Dựng fixture TRƯỚC khi bật đồng hồ theo dõi (việc đồng bộ trên luồng chính).
    // Việc "con THẬT SỰ chết" đã được canh ở `chay-tien-trinh-con-co-tran.test.ts`
    // (SIGKILL ở mọi đường settle); ca này canh hợp đồng của Kho tri thức:
    // đúng loại lỗi + luồng chính không bị khoá trong lúc con quay CPU.
    const bom = bomQuayCpuDocx();
    const nhip = theoDoiNhipLuongChinh();
    const batDau = Date.now();
    let loi: unknown;
    try {
      await assert.rejects(
        () =>
          trichXuatTachLuong({ buf: bom, dinhDang: "docx", thamSoCat: MAC_DINH, hanMs: 300 }).catch((e: unknown) => {
            loi = e;
            throw e;
          }),
        /quá thời gian/i,
      );
      nhip.khangDinhKhongBiKhoa(batDau, Date.now());
      assert.ok(loi instanceof LoiTrichXuatBiNgatGiuaChung, "phải là LoiTrichXuatBiNgatGiuaChung, không phải Error thường");
    } finally {
      nhip.dung();
    }
  });
});
