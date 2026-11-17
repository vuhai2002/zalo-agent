import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderXlsx } from "../documents/render-xlsx.js";
import { taoPdfNhieuTrang } from "../knowledge/fixtures/tao-pdf-thu-nghiem.js";
import { buildZipBuffer, docxTuXml } from "../knowledge/ooxml-zip-test-helper.js";
import { giaiMaVanBan, nhanDienDinhDang } from "./nhan-dien-dinh-dang-tep.js";

// PNG 1x1 hợp lệ
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6300010000050001" + "0d0a2db40000000049454e44ae426082",
  "hex",
);
const CFB = Buffer.concat([Buffer.from("d0cf11e0a1b11ae1", "hex"), Buffer.alloc(600)]);

describe("nhanDienDinhDang - theo byte thật, không tin đuôi", () => {
  it("PDF thật nhận là pdf", () => {
    assert.equal(nhanDienDinhDang(taoPdfNhieuTrang(["a"]), "pdf"), "pdf");
  });

  it("docx khai đuôi .pdf vẫn là docx", () => {
    assert.equal(nhanDienDinhDang(docxTuXml("<w:p/>"), "pdf"), "docx");
  });

  it("xlsx nhận là xlsx", async () => {
    const buf = await renderXlsx([{ name: "A", headers: ["x"], rows: [] }]);
    assert.equal(nhanDienDinhDang(buf, "xlsx"), "xlsx");
  });

  it("zip thường khai đuôi .docx là khong-ro", () => {
    const zip = buildZipBuffer([{ name: "a.txt", data: Buffer.from("x") }]);
    assert.equal(nhanDienDinhDang(zip, "docx"), "khong-ro");
  });

  it("HTML khai đuôi .pdf là khong-ro (trang 'link hết hạn' của CDN)", () => {
    assert.equal(nhanDienDinhDang(Buffer.from("<!doctype html><html>expired</html>"), "pdf"), "khong-ro");
  });

  it("PNG khai đuôi .pdf là anh", () => {
    assert.equal(nhanDienDinhDang(PNG, "pdf"), "anh");
  });

  it("UTF-8 tiếng Việt khai .txt/.csv/.md là van-ban", () => {
    const chu = Buffer.from("Tên,Số cây\nLinh,12\n", "utf-8");
    assert.equal(nhanDienDinhDang(chu, "txt"), "van-ban");
    assert.equal(nhanDienDinhDang(chu, "CSV"), "van-ban");
    assert.equal(nhanDienDinhDang(chu, "md"), "van-ban");
  });

  it("cùng chữ đó khai .exe là khong-ro; chữ có byte NUL khai .txt cũng khong-ro", () => {
    assert.equal(nhanDienDinhDang(Buffer.from("abc", "utf-8"), "exe"), "khong-ro");
    assert.equal(nhanDienDinhDang(Buffer.from([0x61, 0x00, 0x62]), "txt"), "khong-ro");
  });

  it("byte không phải UTF-8 nhưng không có NUL khai .txt là van-ban (mã 8-bit cũ, đọc theo cp1258)", () => {
    assert.equal(nhanDienDinhDang(Buffer.from([0xc3, 0x28, 0x61]), "txt"), "van-ban");
  });

  it("byte CFB (Office 97-2003 / Office có mật khẩu) là cfb để bước sau quyết", () => {
    assert.equal(nhanDienDinhDang(CFB, "doc"), "cfb");
  });

  it("buffer rỗng là khong-ro", () => {
    assert.equal(nhanDienDinhDang(Buffer.alloc(0), "pdf"), "khong-ro");
  });
});

describe("nhanDienDinhDang + giaiMaVanBan - văn bản không phải UTF-8 thuần", () => {
  it("tệp chữ có nhắc '%PDF-1.7' trong 1 KB đầu vẫn là van-ban, không bị đẩy sang trình đọc PDF", () => {
    assert.equal(nhanDienDinhDang(Buffer.from("Ghi chú: chuẩn %PDF-1.7 đã cũ\n", "utf-8"), "txt"), "van-ban");
  });

  it("CSV ANSI (cp1258, mặc định Excel trên Windows tiếng Việt) là van-ban và giải mã đúng dấu", () => {
    // "Số cây" trong cp1258: S=53 ố=(o FF? ) - dựng bằng TextEncoder không có cp1258,
    // nên ghi tay byte: "So" + 0xF4 (ô) + 0xEC (dấu sắc kết hợp) không cần - dùng chữ có sẵn trong bảng
    const buf = Buffer.from([0x54, 0xea, 0x6e, 0x2c, 0x53, 0x6f, 0x0a]); // "Tên,So\n" với ê = 0xEA
    assert.equal(nhanDienDinhDang(buf, "csv"), "van-ban");
    assert.equal(giaiMaVanBan(buf), "Tên,So\n");
  });

  it("UTF-16LE có BOM (Excel 'Unicode Text') là van-ban và giải mã đúng", () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Tên\tSố\n", "utf16le")]);
    assert.equal(nhanDienDinhDang(buf, "txt"), "van-ban");
    assert.equal(giaiMaVanBan(buf), "Tên\tSố\n");
  });

  it("UTF-8 có BOM: bỏ BOM khỏi chữ", () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("Xin chào", "utf-8")]);
    assert.equal(giaiMaVanBan(buf), "Xin chào");
  });
});
