import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { laCoDoiNguon } from "./kb-agent-sources-dirty";

describe("laCoDoiNguon (I17 - gộp cờ dirty của khối Kho tri thức)", () => {
  it("chưa tick gì khác bản đã lưu -> không dirty", () => {
    const banDau = new Set(["a", "b"]);
    assert.equal(laCoDoiNguon(new Set(banDau), banDau), false);
  });

  it("gạt thêm 1 nguồn -> dirty", () => {
    const banDau = new Set(["a"]);
    const checked = new Set(["a", "b"]);
    assert.equal(laCoDoiNguon(checked, banDau), true);
  });

  it("bỏ tick 1 nguồn đã lưu -> dirty (cùng số lượng khác nhau cũng phải bắt được)", () => {
    const banDau = new Set(["a", "b"]);
    const checked = new Set(["a", "c"]); // cùng size=2 nhưng khác nội dung
    assert.equal(laCoDoiNguon(checked, banDau), true);
  });

  it("lưu xong (banDau cập nhật theo checked) -> không còn dirty", () => {
    const checked = new Set(["a", "b", "c"]);
    const banDauSauKhiLuu = new Set(checked);
    assert.equal(laCoDoiNguon(checked, banDauSauKhiLuu), false);
  });

  it("cả hai đều rỗng -> không dirty", () => {
    assert.equal(laCoDoiNguon(new Set(), new Set()), false);
  });
});
