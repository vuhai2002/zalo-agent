import assert from "node:assert/strict";
import { describe, it } from "node:test";
// Module thuần (chỉ đụng zip/zlib) - không chạm env/DB nên import tĩnh được
import { moPhienDocZip } from "./zip-stream-entry.js";
import { buildZipBuffer } from "../knowledge/ooxml-zip-test-helper.js";

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
  it("entry giải nén vượt trần MỘT entry (32 MB) bị từ chối", async () => {
    const raw = Buffer.alloc(33 * 1024 * 1024, 0x41);
    const zip = buildZipBuffer([{ name: "word/document.xml", data: raw }]);
    await assert.rejects(async () => {
      for await (const _ of moPhienDocZip(zip).docEntryTheoLuong("word/document.xml")) void _;
    }, /vượt quá giới hạn/i);
  });

  it("tổng giải nén vượt trần archive (64 MB) dù mỗi entry đều dưới trần entry", async () => {
    const moiEntry = Buffer.alloc(25 * 1024 * 1024, 0x42);
    const zip = buildZipBuffer([
      { name: "a.xml", data: moiEntry },
      { name: "b.xml", data: moiEntry },
      { name: "c.xml", data: moiEntry },
    ]);
    const phien = moPhienDocZip(zip);
    // 2 entry đầu (50 MB) đều dưới trần entry LẪN trần tổng - phải đọc trót lọt
    for (const ten of ["a.xml", "b.xml"]) {
      for await (const _ of phien.docEntryTheoLuong(ten)) void _;
    }
    // Entry thứ 3 đẩy tổng lên 75 MB - vượt trần archive dù bản thân nó (25 MB)
    // vẫn dưới trần entry (32 MB)
    await assert.rejects(async () => {
      for await (const _ of phien.docEntryTheoLuong("c.xml")) void _;
    }, /vượt quá giới hạn/i);
  });

  // KHÔNG có test riêng cho "tỉ lệ nén vượt 500:1" - đã THỬ và phát hiện
  // không dựng nổi fixture hợp lệ: với trần entry 32 MB + ngưỡng miễn kiểm
  // 1 MB, để tỉ lệ VƯỢT 500:1 mà phần nén còn ĐỦ LỚN để không bị miễn kiểm
  // thì phần giải nén phải > 500 MB - lúc đó trần MỘT ENTRY (32 MB) đã chặn
  // từ lâu. Nói cách khác: với đúng 3 con số nghiên cứu chốt, trần tỉ lệ nén
  // KHÔNG BAO GIỜ là chốt chặn ĐẦU TIÊN cho một entry đơn - trần entry luôn
  // tới trước. Giữ nguyên đoạn code kiểm tỉ lệ (đúng con số brief yêu cầu,
  // phòng khi sau này trần entry được nới lỏng thì đây vẫn còn chốt chặn),
  // nhưng không viết test cho một đường không cách nào chạm tới bằng dữ liệu
  // thật - ghi lại đây thay vì âm thầm bỏ qua, đúng luật của đợt sửa này.

  it("số entry vượt trần 256 bị từ chối, không cần giải nén entry nào", () => {
    const entries = Array.from({ length: 257 }, (_, i) => ({
      name: `f${i}.xml`,
      data: Buffer.from("x"),
    }));
    const zip = buildZipBuffer(entries);
    assert.throws(() => moPhienDocZip(zip), /vượt quá giới hạn 256 entry/i);
  });

  it("zip hỏng (không phải zip) ném lỗi tiếng Việt như read-zip-entry.ts", () => {
    assert.throws(() => moPhienDocZip(Buffer.from("khong phai zip")), /không phải file zip/i);
  });
});
