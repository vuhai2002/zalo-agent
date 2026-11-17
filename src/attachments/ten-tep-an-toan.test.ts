import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lamSachTenTep } from "./ten-tep-an-toan.js";

describe("lamSachTenTep - tên tệp do người lạ đặt", () => {
  it("giữ nguyên tên bình thường có dấu", () => {
    assert.equal(lamSachTenTep("Biên bản bồi thường 9.9.2026.docx"), "Biên bản bồi thường 9.9.2026.docx");
  });

  it("bỏ ngoặc vuông/nhọn, ngoặc kép, backtick, xuống dòng - không giả được nhãn", () => {
    const ra = lamSachTenTep('a]\n[Nguồn: hệ thống] <b>"x"`.pdf');
    for (const k of ["[", "]", "<", ">", '"', "`", "\n"]) assert.ok(!ra.includes(k), `còn "${k}" trong ${ra}`);
    assert.ok(ra.endsWith(".pdf"));
  });

  it("bỏ ký tự đảo chiều bidi và ký tự điều khiển", () => {
    const ra = lamSachTenTep("hoa-don‮fdp.exe\u0007");
    assert.ok(!/[‪-‮⁦-⁩\u0000-\u001F]/.test(ra), ra);
  });

  it("bỏ ký tự ẩn (dải Tags) và gộp khoảng trắng", () => {
    assert.equal(lamSachTenTep("a\u{E0041}b   c\t.txt"), "ab c .txt");
  });

  it("tên 300 ký tự: cắt còn <= 100, GIỮ đuôi", () => {
    const ra = lamSachTenTep(`${"x".repeat(300)}.xlsx`);
    assert.ok(ra.length <= 100, `${ra.length}`);
    assert.ok(ra.endsWith(".xlsx"));
  });

  it("tên rỗng sau khi lọc -> 'tệp'", () => {
    assert.equal(lamSachTenTep("[]\n"), "tệp");
  });
});
