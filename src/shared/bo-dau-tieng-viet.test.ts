import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boDauTiengViet } from "./bo-dau-tieng-viet.js";

describe("boDauTiengViet", () => {
  it("bỏ dấu thanh, dấu mũ và chữ đ", () => {
    assert.equal(boDauTiengViet("Chính sách đổi trả"), "Chinh sach doi tra");
    assert.equal(boDauTiengViet("ĐƯỢC"), "DUOC");
  });

  it("giữ nguyên chữ và số không dấu", () => {
    assert.equal(boDauTiengViet("Bao hanh 12 thang"), "Bao hanh 12 thang");
  });
});
