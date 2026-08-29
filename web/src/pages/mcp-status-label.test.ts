import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nhanTrangThai } from "./mcp-status-label.js";

describe("nhanTrangThai", () => {
  it("map đủ 4 trạng thái sang chữ + tông màu", () => {
    assert.equal(nhanTrangThai("da_ket_noi").chu, "Đã kết nối");
    assert.equal(nhanTrangThai("da_ket_noi").tone, "ok");
    assert.equal(nhanTrangThai("loi").chu, "Lỗi");
    assert.equal(nhanTrangThai("loi").tone, "warn");
    assert.equal(nhanTrangThai("can_duyet_lai").chu, "Chờ duyệt lại");
    assert.equal(nhanTrangThai("can_duyet_lai").tone, "warn");
    assert.equal(nhanTrangThai("cho_ket_noi").chu, "Chờ kết nối");
    assert.equal(nhanTrangThai("cho_ket_noi").tone, "muted");
  });
});
