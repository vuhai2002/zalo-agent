import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { conViecDoiXuLy } from "./kb-poll-guard";

describe("conViecDoiXuLy (B7 - dừng poll khi hết việc)", () => {
  it("mọi nguồn đã san_sang -> không còn việc, phải dừng poll", () => {
    assert.equal(
      conViecDoiXuLy([{ trangThai: "san_sang" }, { trangThai: "san_sang" }]),
      false,
    );
  });

  it("còn 1 nguồn cho_xu_ly giữa nhiều nguồn san_sang -> vẫn còn việc", () => {
    assert.equal(
      conViecDoiXuLy([{ trangThai: "san_sang" }, { trangThai: "cho_xu_ly" }, { trangThai: "san_sang" }]),
      true,
    );
  });

  it("còn nguồn dang_xu_ly -> vẫn còn việc", () => {
    assert.equal(conViecDoiXuLy([{ trangThai: "dang_xu_ly" }]), true);
  });

  it("nguồn hong KHÔNG tính là còn việc - chỉ tự đổi khi người vận hành bấm Xử lý lại", () => {
    assert.equal(conViecDoiXuLy([{ trangThai: "hong" }, { trangThai: "san_sang" }]), false);
  });

  it("danh sách rỗng -> không còn việc", () => {
    assert.equal(conViecDoiXuLy([]), false);
  });
});
