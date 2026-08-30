import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coBanMoiHon } from "./so-sanh-phien-ban.js";

describe("coBanMoiHon", () => {
  it("mới hơn ở từng cấp -> true", () => {
    assert.equal(coBanMoiHon("0.2.0", "0.3.0"), true);
    assert.equal(coBanMoiHon("0.2.0", "1.0.0"), true);
    assert.equal(coBanMoiHon("0.2.3", "0.2.4"), true);
  });

  it("so theo SỐ chứ không theo chuỗi (0.10.0 > 0.2.0)", () => {
    assert.equal(coBanMoiHon("0.2.0", "0.10.0"), true);
    assert.equal(coBanMoiHon("0.9.0", "0.10.0"), true);
    assert.equal(coBanMoiHon("1.2.0", "1.10.0"), true);
  });

  it("bằng hoặc cũ hơn -> false", () => {
    assert.equal(coBanMoiHon("0.2.0", "0.2.0"), false);
    assert.equal(coBanMoiHon("0.3.0", "0.2.0"), false);
    assert.equal(coBanMoiHon("1.0.0", "0.9.9"), false);
    assert.equal(coBanMoiHon("0.10.0", "0.2.0"), false);
  });

  it("bỏ tiền tố v ở cả hai vế", () => {
    assert.equal(coBanMoiHon("v0.2.0", "v0.3.0"), true);
    assert.equal(coBanMoiHon("0.2.0", "v0.2.0"), false);
    assert.equal(coBanMoiHon("V0.2.0", "V0.3.0"), true);
  });

  it("bỏ hậu tố prerelease/build khi lấy lõi", () => {
    assert.equal(coBanMoiHon("0.2.0", "0.3.0-beta.1"), true);
    assert.equal(coBanMoiHon("0.3.0-beta", "0.3.0"), false); // lõi bằng nhau
    assert.equal(coBanMoiHon("0.2.0", "0.3.0+build.7"), true);
  });

  it("đầu vào rác/thiếu/null -> false (không hiện nút sai)", () => {
    assert.equal(coBanMoiHon("0.2.0", null), false);
    assert.equal(coBanMoiHon("0.2.0", undefined), false);
    assert.equal(coBanMoiHon("0.2.0", ""), false);
    assert.equal(coBanMoiHon("0.2.0", "latest"), false);
    assert.equal(coBanMoiHon("0.2.0", "0.3"), false);
    assert.equal(coBanMoiHon("", "0.3.0"), false);
    assert.equal(coBanMoiHon("0.2.0", "0.x.0"), false);
  });
});
