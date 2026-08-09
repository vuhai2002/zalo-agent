import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { trangCuoiCungConDuLieu } from "./kb-page-clamp";

describe("trangCuoiCungConDuLieu", () => {
  it("21 dòng, 20 dòng/trang -> trang cuối là 1 (trang thứ 2)", () => {
    assert.equal(trangCuoiCungConDuLieu(21, 20), 1);
  });

  it("xóa 1 dòng còn 20 dòng, 20 dòng/trang -> trang cuối co về 0 (chỉ còn 1 trang)", () => {
    assert.equal(trangCuoiCungConDuLieu(20, 20), 0);
  });

  it("danh sách rỗng -> trang cuối là 0, không âm", () => {
    assert.equal(trangCuoiCungConDuLieu(0, 20), 0);
  });

  it("101 dòng, 20 dòng/trang -> trang cuối là 5 (trang thứ 6), không nhảy về 0", () => {
    assert.equal(trangCuoiCungConDuLieu(101, 20), 5);
  });
});
