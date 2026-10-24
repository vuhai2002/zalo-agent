import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catTranVanBanMcp } from "./mcp-tool-result-text.js";

// Module thuần - import tĩnh được, không cần setupTestEnv

describe("catTranVanBanMcp", () => {
  it("không xé đôi cặp surrogate ở điểm cắt - nửa cặp mồ côi là chuỗi UTF-16 hỏng", () => {
    // "ab" + emoji (2 đơn vị UTF-16) + "cd": cắt ở 3 rơi đúng giữa emoji
    const kq = catTranVanBanMcp("ab\u{1F600}cd", 3);
    const phanGiu = kq.split("\n")[0]!;
    assert.equal(phanGiu, "ab");
    assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(kq), false, "không còn high surrogate mồ côi");
  });

  it("điểm cắt không chạm surrogate thì cắt đúng trần", () => {
    assert.equal(catTranVanBanMcp("abcdef", 4).split("\n")[0], "abcd");
    assert.equal(catTranVanBanMcp("abc", 10), "abc");
  });
});
