import assert from "node:assert/strict";
import { describe, it } from "node:test";
// Module thuần (chỉ đụng zip/zlib) - không chạm env/DB nên import tĩnh được
import { moPhienDocZip } from "./zip-stream-entry.js";
import { LoiVuotTran } from "../knowledge/ooxml-limits.js";
import { buildZipBuffer, buildZipBufferTaiSuDungNen, chuKhoNen } from "../knowledge/ooxml-zip-test-helper.js";

async function gomHetChunk(gen: AsyncGenerator<string>): Promise<{ text: string; soChunk: number }> {
  let text = "";
  let soChunk = 0;
  for await (const chunk of gen) {
    text += chunk;
    soChunk++;
  }
  return { text, soChunk };
}

describe("zip-stream-entry - đọc đúng nội dung", () => {
  it("entry nhỏ đọc đúng nội dung, giữ nguyên tiếng Việt có dấu", async () => {
    const goc = "Chính sách bảo hành 12 tháng cho mọi sản phẩm.";
    const zip = buildZipBuffer([{ name: "word/document.xml", data: Buffer.from(goc, "utf-8") }]);
    const { text } = await gomHetChunk(moPhienDocZip(zip).docEntryTheoLuong("word/document.xml"));
    assert.equal(text, goc);
  });

  it("entry lớn đọc THEO LUỒNG (ra nhiều chunk), ráp lại đúng byte gốc", async () => {
    // >16KB (cỡ buffer nội bộ zlib mặc định) để chắc chắn zlib phải phát ra
    // NHIỀU lần - nếu code âm thầm quay lại đọc 1 phát thì test này bắt được.
    const goc = "Báo giá tháng 8: cà phê 25.000đ, trà đá 10.000đ. ".repeat(20_000); // ~950 KB
    const zip = buildZipBuffer([{ name: "xl/sharedStrings.xml", data: Buffer.from(goc, "utf-8") }]);
    const { text, soChunk } = await gomHetChunk(
      moPhienDocZip(zip).docEntryTheoLuong("xl/sharedStrings.xml"),
    );
    assert.equal(text, goc, "ráp các chunk lại phải ra ĐÚNG BYTE gốc, không lệch/thiếu/dư");
    assert.ok(soChunk > 1, `phải ra nhiều chunk (đo được ${soChunk}) - chứng minh có đọc theo luồng`);
  });

  it("giữ đúng ký tự tiếng Việt dù ranh giới chunk cắt ngay giữa ký tự nhiều byte", async () => {
    // Test đúng bẫy UTF-8: một ký tự có dấu chiếm 2-3 byte, ranh giới 16KB
    // của zlib gần như chắc chắn rơi giữa một ký tự nào đó trong khối lặp
    // dày đặc dấu tiếng Việt này. `setEncoding("utf8")` phải tự đệm byte dở.
    const goc = "Tiếng Việt có dấu: ă â đ ê ô ơ ư, á à ả ã ạ, ế ề ể ễ ệ. ".repeat(15_000);
    const zip = buildZipBuffer([{ name: "word/document.xml", data: Buffer.from(goc, "utf-8") }]);
    const { text } = await gomHetChunk(moPhienDocZip(zip).docEntryTheoLuong("word/document.xml"));
    assert.equal(text, goc);
    assert.doesNotMatch(text, /�/, "không được có ký tự thay thế () - dấu hiệu decode UTF-8 sai");
  });

  it("entry không tồn tại ném lỗi tiếng Việt rõ ràng", async () => {
    const zip = buildZipBuffer([{ name: "word/document.xml", data: Buffer.from("x") }]);
    await assert.rejects(async () => {
      for await (const _ of moPhienDocZip(zip).docEntryTheoLuong("khong-ton-tai.xml")) void _;
    }, /không tìm thấy/i);
  });

  it("danhSachEntry() liệt kê đúng tên, không cần giải nén gì", () => {
    const zip = buildZipBuffer([
      { name: "word/document.xml", data: Buffer.from("a") },
      { name: "[Content_Types].xml", data: Buffer.from("b") },
    ]);
    assert.deepEqual(moPhienDocZip(zip).danhSachEntry(), ["word/document.xml", "[Content_Types].xml"]);
  });
});

describe("zip-stream-entry - trần an toàn", () => {
  it("entry giải nén vượt trần MỘT entry (32 MB) bị từ chối, thông báo KHÔNG buộc tội 'zip bomb'", async () => {
    // Vượt trần vì file TO THẬT khác hẳn vượt trần vì HÌNH DẠNG khả nghi (tỉ
    // lệ nén/số entry bất thường) - buộc tội "zip bomb" cho một bảng tính hợp
    // lệ chỉ đơn giản LỚN là sai, và người vận hành không đối chiếu được với
    // file trên đĩa của họ. Xem `zip-stream-entry.ts` (loiVuotTranMotEntry).
    const raw = Buffer.alloc(33 * 1024 * 1024, 0x41);
    const zip = buildZipBuffer([{ name: "word/document.xml", data: raw }]);
    await assert.rejects(async () => {
      for await (const _ of moPhienDocZip(zip).docEntryTheoLuong("word/document.xml")) void _;
    }, (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /quá lớn để xử lý/i);
      assert.match(err.message, /vượt quá giới hạn/i);
      assert.doesNotMatch(err.message, /zip bomb/i, "không được buộc tội file to thật là zip bomb");
      // Kích thước đọc THẲNG entry.uncompSize trong central directory (chưa
      // giải nén byte nào) -> "khai-bao", không phải đếm thật lúc giải nén.
      assert.ok(err instanceof LoiVuotTran);
      assert.equal(err.entryName, "word/document.xml");
      assert.equal(err.nguon, "khai-bao");
      return true;
    });
  });

  it("tổng giải nén vượt trần archive (64 MB) dù mỗi entry đều dưới trần entry", async () => {
    // Chữ KHÓ NÉN (không phải Buffer.alloc lặp 1 byte) - lặp 1 byte nén tới
    // >1000:1, giờ sẽ bị CHÍNH chốt tỉ lệ (đã sửa) bắt trước, che mất chốt
    // tổng cần đo ở đây. Xem comment `chuKhoNen` trong test helper.
    // buildZipBufferTaiSuDungNen: nén MỘT LẦN, tái dùng cho 3 tên - thay vì
    // để buildZipBuffer tự nén lại 3 lần trên CÙNG 25 MB dữ liệu khó nén.
    const moiEntry = Buffer.from(chuKhoNen(25 * 1024 * 1024), "utf-8");
    const zip = buildZipBufferTaiSuDungNen(moiEntry, ["a.xml", "b.xml", "c.xml"]);
    const phien = moPhienDocZip(zip);
    // 2 entry đầu (50 MB) đều dưới trần entry LẪN trần tổng - phải đọc trót lọt
    for (const ten of ["a.xml", "b.xml"]) {
      for await (const _ of phien.docEntryTheoLuong(ten)) void _;
    }
    // Entry thứ 3 đẩy tổng lên 75 MB - vượt trần archive dù bản thân nó (25 MB)
    // vẫn dưới trần entry (32 MB). Cùng lý do "không buộc tội zip bomb" như
    // trần MỘT entry ở test trên - vượt trần tổng cũng chỉ là "file to thật".
    await assert.rejects(async () => {
      for await (const _ of phien.docEntryTheoLuong("c.xml")) void _;
    }, (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /quá lớn để xử lý/i);
      assert.match(err.message, /vượt quá giới hạn/i);
      assert.doesNotMatch(err.message, /zip bomb/i, "không được buộc tội file to thật là zip bomb");
      // Ném ở nhánh SỚM (tongByteDaGiaiNen thật của a.xml+b.xml CỘNG
      // entry.uncompSize KHAI của c.xml, chưa giải nén byte nào của c.xml) ->
      // "khai-bao", dù 2 entry trước đó đã đọc thật.
      assert.ok(err instanceof LoiVuotTran);
      assert.equal(err.entryName, "c.xml");
      assert.equal(err.nguon, "khai-bao");
      return true;
    });
  });

  it("tỉ lệ nén vượt 500:1 bị từ chối SỚM (trước khi chạm trần entry) - cùng LỚP bom với bom-1mb.docx thật", async () => {
    // Nội dung LẶP 1 KÝ TỰ, giải nén ra 1 MB (dưới xa trần entry 32 MB) -
    // ĐO THẬT tỉ lệ của CHÍNH fixture này: 1 MB "x" lặp -> 1.033 byte nén,
    // tỉ lệ 1015:1. Con số này KHÁC bom-1mb.docx thật nghiên cứu đo (1,7 KB
    // nén -> 1 MB XML, tỉ lệ ~596:1) - hai file khác nhau, không phải cùng
    // một số - nhưng CÙNG LỚP bom (tỉ lệ nén phi thực tế, ép Nan phần trăm),
    // cả hai đều vượt xa trần 500:1. Trước khi sửa Important 3, chốt tỉ lệ
    // miễn kiểm theo CỠ NÉN (compData.length < 1 MB) nên KHÔNG BAO GIỜ bắt
    // được ca này (phần nén luôn dưới ngưỡng miễn dù tỉ lệ cao). Sau khi sửa
    // (miễn theo OUTPUT đã đọc, kiểu Apache POI), chốt tỉ lệ phải là đường
    // ĐẦU TIÊN chặn - đo bằng cách xác nhận message nói "tỉ lệ nén", không
    // phải "vượt quá giới hạn" (message của trần entry/tổng).
    const raw = "x".repeat(1024 * 1024); // 1 MB, nén cực tốt
    const zip = buildZipBuffer([{ name: "word/document.xml", data: Buffer.from(raw, "utf-8") }]);
    await assert.rejects(async () => {
      for await (const _ of moPhienDocZip(zip).docEntryTheoLuong("word/document.xml")) void _;
    }, (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /tỉ lệ nén vượt quá 500:1/i);
      // Khác trần entry/tổng: tỉ lệ nén phi thực tế LÀ hình dạng khả nghi
      // thật - GIỮ chữ "zip bomb" ở đây (xác nhận DƯƠNG, không chỉ kiểm phủ
      // định ở 2 test trên).
      assert.match(err.message, /zip bomb/i);
      // Ném GIỮA vòng lặp streaming, so `byteEntry` ĐẾM THẬT lúc giải nén
      // (không phải kích thước khai trong central directory) -> "do-that".
      assert.ok(err instanceof LoiVuotTran);
      assert.equal(err.entryName, "word/document.xml");
      assert.equal(err.nguon, "do-that");
      return true;
    });
  });

  it("số entry vượt trần 256 bị từ chối, không cần giải nén entry nào, KHÔNG buộc tội 'zip bomb'", () => {
    // Sửa lại sau rà soát: một .docx nhiều ảnh (mỗi ảnh một entry) đạt 257
    // entry với khoảng 250 ảnh - hoàn toàn hợp lệ. Corpus đo cao nhất 99 chỉ
    // chứng minh corpus không có file ảnh nặng, không chứng minh 257 là bất
    // thường - không được buộc tội "zip bomb" cho ca này.
    const entries = Array.from({ length: 257 }, (_, i) => ({
      name: `f${i}.xml`,
      data: Buffer.from("x"),
    }));
    const zip = buildZipBuffer(entries);
    assert.throws(() => moPhienDocZip(zip), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /quá nhiều phần bên trong/i);
      assert.match(err.message, /257/);
      assert.doesNotMatch(err.message, /zip bomb/i, "không được buộc tội 257 entry là zip bomb");
      // Đọc THẲNG số entry trong central directory, chưa giải nén gì ->
      // "khai-bao". Không gắn với MỘT entry cụ thể nào -> entryName undefined.
      assert.ok(err instanceof LoiVuotTran);
      assert.equal(err.entryName, undefined);
      assert.equal(err.nguon, "khai-bao");
      return true;
    });
  });

  it("zip hỏng (không phải zip) ném lỗi tiếng Việt như read-zip-entry.ts", () => {
    assert.throws(() => moPhienDocZip(Buffer.from("khong phai zip")), /không phải file zip/i);
  });
});
