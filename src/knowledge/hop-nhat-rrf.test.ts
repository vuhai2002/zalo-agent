import assert from "node:assert/strict";
import { describe, it } from "node:test";
// Module thuần (không import gì ngoài chính nó) - không chạm env/DB nên import tĩnh được
import { hopNhatRrf } from "./hop-nhat-rrf.js";

describe("hopNhatRrf", () => {
  it("một danh sách: RRF giữ nguyên thứ tự", () => {
    const r = hopNhatRrf([["a", "b", "c"]], (x) => x, 20);
    assert.deepEqual(
      r.map((x) => x.item),
      ["a", "b", "c"],
    );
  });

  it("mục xuất hiện ở CẢ HAI danh sách được đẩy lên trên", () => {
    //  x: hạng 2 và hạng 1  ->  1/22 + 1/21
    //  a: hạng 1, vắng mặt danh sách hai  ->  1/21
    const r = hopNhatRrf(
      [
        ["a", "x"],
        ["x", "b"],
      ],
      (v) => v,
      20,
    );
    assert.equal(r[0]!.item, "x", "có mặt ở hai nguồn phải thắng hạng-1-một-nguồn");
  });

  it("k nhỏ làm top có trọng lượng hơn", () => {
    const nho = hopNhatRrf([["a"], ["b"]], (v) => v, 1)[0]!.diem;
    const lon = hopNhatRrf([["a"], ["b"]], (v) => v, 100)[0]!.diem;
    assert.ok(nho > lon);
  });

  it("danh sách rỗng không làm hỏng gì", () => {
    assert.deepEqual(
      hopNhatRrf([[], ["a"]], (v) => v, 20).map((x) => x.item),
      ["a"],
    );
  });
});
