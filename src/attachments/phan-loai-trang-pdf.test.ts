import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { phanLoaiTrang } from "./phan-loai-trang-pdf.js";

describe("phanLoaiTrang", () => {
  it("đủ chữ (kể cả lớp OCR ẩn) -> chu; ít chữ -> ocr", () => {
    assert.equal(phanLoaiTrang({ so: 1, doDaiChu: 200 }), "chu");
    assert.equal(phanLoaiTrang({ so: 1, doDaiChu: 30 }), "chu");
    assert.equal(phanLoaiTrang({ so: 1, doDaiChu: 29 }), "ocr");
    assert.equal(phanLoaiTrang({ so: 1, doDaiChu: 1 }), "ocr"); // chỉ có số trang "3"
    assert.equal(phanLoaiTrang({ so: 1, doDaiChu: 0 }), "ocr"); // trang quét, hoặc trang trắng thật
  });
});
