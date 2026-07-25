import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let auth: typeof import("./dashboard-auth.js");

before(async () => {
  dataDir = setupTestEnv({ DASHBOARD_PASSWORD: "mat-khau-test-123" });
  auth = await import("./dashboard-auth.js");
});

after(() => cleanupTestEnv(dataDir));

describe("dashboard-auth", () => {
  it("password đúng pass, sai fail, rỗng fail", () => {
    assert.equal(auth.checkPassword("mat-khau-test-123"), true);
    assert.equal(auth.checkPassword("sai-mat-khau"), false);
    assert.equal(auth.checkPassword(""), false);
  });

  it("token vừa tạo verify được, token giả mạo thì không", () => {
    const token = auth.createSessionToken();
    assert.equal(auth.verifySessionToken(token), true);

    assert.equal(auth.verifySessionToken(undefined), false);
    assert.equal(auth.verifySessionToken("khong-phai-token"), false);
    // Sửa expiry nhưng giữ chữ ký cũ -> chữ ký không khớp
    const [exp, sig] = token.split(".");
    assert.equal(auth.verifySessionToken(`${Number(exp) + 99999}.${sig}`), false);
  });

  it("token hết hạn bị từ chối", () => {
    const now = Date.now();
    const token = auth.createSessionToken(now);
    const after8Days = now + 8 * 24 * 60 * 60 * 1000;
    assert.equal(auth.verifySessionToken(token, after8Days), false);
  });

  it("rate limit: 5 lần/phút, cửa sổ trôi qua thì reset, login ok thì xóa đếm", () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      assert.equal(auth.allowLoginAttempt("1.2.3.4", now), true, `lần ${i + 1} phải được phép`);
    }
    assert.equal(auth.allowLoginAttempt("1.2.3.4", now), false, "lần 6 phải bị chặn");
    // IP khác không bị ảnh hưởng
    assert.equal(auth.allowLoginAttempt("5.6.7.8", now), true);
    // Hết cửa sổ 60s -> được thử lại
    assert.equal(auth.allowLoginAttempt("1.2.3.4", now + 61_000), true);
    // clearLoginAttempts xóa đếm ngay
    for (let i = 0; i < 5; i++) auth.allowLoginAttempt("9.9.9.9", now);
    auth.clearLoginAttempts("9.9.9.9");
    assert.equal(auth.allowLoginAttempt("9.9.9.9", now), true);
  });
});
