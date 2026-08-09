import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { xayThongDiepXoaNguon } from "./kb-delete-warning-message";

describe("xayThongDiepXoaNguon (I19 - cảnh báo trung thực khi xóa nguồn)", () => {
  it("2 agent đang dùng -> nói rõ số 2 và 'mất quyền tra cứu'", () => {
    const msg = xayThongDiepXoaNguon(["a1", "a2"]);
    assert.match(msg, /2 agent/);
    assert.match(msg, /mất quyền tra cứu/i);
  });

  it("1 agent đang dùng -> vẫn nói đúng số 1", () => {
    assert.match(xayThongDiepXoaNguon(["a1"]), /1 agent/);
  });

  it("chưa agent nào dùng -> nói rõ 'chưa agent nào', không phải câu vẫn ngầm cảnh báo mất quyền", () => {
    const msg = xayThongDiepXoaNguon([]);
    assert.match(msg, /chưa agent nào/i);
    assert.doesNotMatch(msg, /mất quyền tra cứu/i);
  });

  it("không kiểm tra được (route lỗi) -> nói THẬT là không biết, KHÔNG ngầm định 0", () => {
    const msg = xayThongDiepXoaNguon(null);
    assert.match(msg, /không kiểm tra được/i);
    assert.doesNotMatch(msg, /chưa agent nào/i);
  });

  it("mọi nhánh đều nhắc 'không khôi phục được'", () => {
    for (const input of [null, [], ["a1"]] as (string[] | null)[]) {
      assert.match(xayThongDiepXoaNguon(input), /không khôi phục được/i);
    }
  });
});
