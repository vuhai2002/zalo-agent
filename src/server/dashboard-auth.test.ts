import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let auth: typeof import("./dashboard-auth.js");
let sessions: typeof import("./dashboard-session-store.js");

before(async () => {
  dataDir = setupTestEnv({ DASHBOARD_PASSWORD: "mat-khau-test-123" });
  auth = await import("./dashboard-auth.js");
  sessions = await import("./dashboard-session-store.js");
});

after(async () => {
  // Phải đóng SQLite trước khi xóa thư mục, Windows không cho xóa file đang mở
  const { closeDatabase } = await import("../conversation/database.js");
  closeDatabase();
  cleanupTestEnv(dataDir);
});

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
    assert.equal(auth.verifySessionToken("thieu-secret."), false);

    // Đúng session id nhưng secret bịa -> không khớp hash trong DB
    const [id] = token.split(".");
    assert.equal(auth.verifySessionToken(`${id}.secret-bia-ra`), false);
    // Secret đúng nhưng session id không tồn tại
    const secret = token.slice(token.indexOf(".") + 1);
    assert.equal(auth.verifySessionToken(`0000000000000000.${secret}`), false);
  });

  it("token hết hạn bị từ chối và bị xóa khỏi DB", () => {
    const now = Date.now();
    const token = auth.createSessionToken(now);
    const after8Days = now + 8 * 24 * 60 * 60 * 1000;

    assert.equal(auth.verifySessionToken(token, after8Days), false);
    // Lượt verify hết hạn tự dọn bản ghi
    assert.equal(auth.verifySessionToken(token, now), false);
  });

  it("logout thu hồi thật: token cũ không dùng lại được", () => {
    const token = auth.createSessionToken();
    assert.equal(auth.verifySessionToken(token), true);

    auth.revokeSessionToken(token);
    assert.equal(auth.verifySessionToken(token), false);
  });

  it("đổi DASHBOARD_PASSWORD làm mọi phiên cũ hết hiệu lực", async () => {
    const { env } = await import("../config/env.js");
    const token = auth.createSessionToken();
    assert.equal(auth.verifySessionToken(token), true);

    env.DASHBOARD_PASSWORD = "mat-khau-moi-456";
    assert.equal(auth.verifySessionToken(token), false, "password đổi -> phiên cũ phải chết");

    env.DASHBOARD_PASSWORD = "mat-khau-test-123";
  });

  it("login mới dọn phiên hết hạn, bảng không phình vô hạn", () => {
    const now = Date.now();
    const before = sessions.countSessions();
    auth.createSessionToken(now - 8 * 24 * 60 * 60 * 1000); // đã hết hạn từ trước
    auth.createSessionToken(now);

    assert.ok(sessions.countSessions() <= before + 1, "phiên hết hạn phải bị dọn khi login");
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

  it("bucket rate-limit hết hạn bị dọn, Map không phình theo số IP từng gặp", () => {
    const now = Date.now();
    for (let i = 0; i < 600; i++) auth.allowLoginAttempt(`10.0.${Math.floor(i / 256)}.${i % 256}`, now);
    const peak = auth.loginAttemptBucketCount();
    assert.ok(peak > 500, "phải vượt ngưỡng trước khi dọn");

    // Cửa sổ của toàn bộ bucket cũ đã trôi qua -> lần gọi sau dọn sạch
    auth.allowLoginAttempt("8.8.8.8", now + 61_000);
    assert.ok(auth.loginAttemptBucketCount() < peak, "bucket hết hạn phải bị dọn");
  });
});
