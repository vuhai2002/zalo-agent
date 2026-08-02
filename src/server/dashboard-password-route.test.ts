import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Hono } from "hono";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * POST /api/auth/password - đổi mật khẩu dashboard.
 *
 * File TÁCH RIÊNG khỏi `dashboard-server.test.ts`: route này đụng vào bộ đếm
 * rate-limit login (sống theo tiến trình) và đổi mật khẩu đang hiệu lực - trộn
 * chung sẽ làm phiên đăng nhập của các ca test khác chết giữa chừng.
 */

const PASSWORD_BAN_DAU = "mat-khau-ban-dau-123";

let dataDir: string;
let app: Hono;
let cookie: string;
let database: typeof import("../conversation/database.js");

async function dangNhap(password: string): Promise<Response> {
  return app.request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password }),
    headers: { "content-type": "application/json" },
  });
}

before(async () => {
  dataDir = setupTestEnv({ DASHBOARD_PASSWORD: PASSWORD_BAN_DAU });
  const { buildDashboardApp } = await import("./dashboard-server.js");
  app = buildDashboardApp();
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(async () => {
  database.db.exec("DELETE FROM runtime_settings WHERE key = 'dashboard_password';");
  database.db.exec("DELETE FROM dashboard_sessions;");
  const login = await dangNhap(PASSWORD_BAN_DAU);
  cookie = login.headers.get("set-cookie")!.split(";")[0]!;
});

const doiMatKhau = (body: unknown, dungCookie = true) =>
  app.request("/api/auth/password", {
    method: "POST",
    headers: dungCookie
      ? { cookie, "content-type": "application/json" }
      : { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/auth/password", () => {
  it("đổi được khi nhập đúng mật khẩu hiện tại, và đăng nhập lại bằng mật khẩu MỚI", async () => {
    const r = await doiMatKhau({ currentPassword: PASSWORD_BAN_DAU, newPassword: "mat-khau-moi-456" });
    assert.equal(r.status, 200);

    assert.equal((await dangNhap("mat-khau-moi-456")).status, 200);
    assert.equal((await dangNhap(PASSWORD_BAN_DAU)).status, 401, "mật khẩu cũ phải hết dùng được");
  });

  it("SAI mật khẩu hiện tại thì bị từ chối - cookie bị mượn không đổi được mật khẩu", async () => {
    const r = await doiMatKhau({ currentPassword: "doan-bua", newPassword: "mat-khau-moi-456" });
    assert.equal(r.status, 401);
    assert.equal((await dangNhap(PASSWORD_BAN_DAU)).status, 200, "mật khẩu cũ phải còn nguyên");
  });

  it("chưa đăng nhập thì không gọi được", async () => {
    const r = await doiMatKhau(
      { currentPassword: PASSWORD_BAN_DAU, newPassword: "mat-khau-moi-456" },
      false,
    );
    assert.equal(r.status, 401);
  });

  it("mật khẩu mới dưới 8 ký tự bị chặn - khớp ràng buộc của schema env", async () => {
    const r = await doiMatKhau({ currentPassword: PASSWORD_BAN_DAU, newPassword: "ngan" });
    assert.equal(r.status, 400);
    assert.match(((await r.json()) as { error: string }).error, /8 ký tự/);
  });

  it("mật khẩu mới trùng mật khẩu cũ bị chặn", async () => {
    const r = await doiMatKhau({ currentPassword: PASSWORD_BAN_DAU, newPassword: PASSWORD_BAN_DAU });
    assert.equal(r.status, 400);
  });

  it("đổi xong người vừa đổi được cấp cookie MỚI, dùng tiếp được ngay", async () => {
    const r = await doiMatKhau({ currentPassword: PASSWORD_BAN_DAU, newPassword: "mat-khau-moi-456" });
    const cookieMoi = r.headers.get("set-cookie")!.split(";")[0]!;

    const me = await app.request("/api/auth/me", { headers: { cookie: cookieMoi } });
    assert.equal(me.status, 200, "không cấp cookie mới thì người vừa đổi bị đá ra khỏi trang");
  });

  it("phiên trên thiết bị KHÁC bị thu hồi sau khi đổi", async () => {
    const thietBiKhac = (await dangNhap(PASSWORD_BAN_DAU)).headers.get("set-cookie")!.split(";")[0]!;
    assert.equal((await app.request("/api/auth/me", { headers: { cookie: thietBiKhac } })).status, 200);

    await doiMatKhau({ currentPassword: PASSWORD_BAN_DAU, newPassword: "mat-khau-moi-456" });

    const sau = await app.request("/api/auth/me", { headers: { cookie: thietBiKhac } });
    assert.equal(sau.status, 401, "thiết bị khác vẫn vào được thì đổi mật khẩu không cứu được tài khoản bị lộ");
  });
});
