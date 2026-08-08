import assert from "node:assert/strict";
import { describe, it } from "node:test";
// Module thuần - không chạm env/DB nên import tĩnh được
import { DINH_DANG_HO_TRO, docChuTuFile, laDinhDangHoTro } from "./doc-text-extract.js";

describe("doc-text-extract - laDinhDangHoTro", () => {
  it("nhận đúng 5 định dạng hỗ trợ", () => {
    assert.deepEqual([...DINH_DANG_HO_TRO], ["txt", "md", "docx", "xlsx", "pdf"]);
    for (const d of DINH_DANG_HO_TRO) assert.equal(laDinhDangHoTro(d), true);
  });

  it("từ chối định dạng lạ", () => {
    for (const x of ["doc", "png", "csv", ""]) assert.equal(laDinhDangHoTro(x), false);
  });
});

describe("doc-text-extract - docChuTuFile (txt/md đọc thẳng)", () => {
  it("txt đọc thẳng UTF-8, giữ nguyên dấu tiếng Việt", async () => {
    const chu = await docChuTuFile(Buffer.from("Xin chào, đây là tài liệu.", "utf-8"), "txt");
    assert.equal(chu, "Xin chào, đây là tài liệu.");
  });

  it("md đọc thẳng UTF-8, không xử lý markdown gì thêm ở tầng đọc file", async () => {
    const chu = await docChuTuFile(Buffer.from("# Tiêu đề\n\nNội dung", "utf-8"), "md");
    assert.equal(chu, "# Tiêu đề\n\nNội dung");
  });
});
