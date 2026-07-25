import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Hono } from "hono";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

// buildDashboardApp kéo theo account-manager (zca-js) + toàn bộ store - chỉ
// import module, không login gì. app.request() chạy handler không cần mở port.
let dataDir: string;
let app: Hono;
let sessionCookie: string;

before(async () => {
  dataDir = setupTestEnv({ DASHBOARD_PASSWORD: "mat-khau-test-123" });

  const threads = await import("../conversation/thread-store.js");
  const history = await import("../conversation/history-store.js");
  threads.recordThreadActivity({
    accountId: "acc-1",
    threadId: "t-1",
    threadType: 0,
    displayName: "Hải",
    lastSenderName: "Hải",
  });
  history.appendMessage("acc-1", "t-1", { role: "user", content: "hi", senderName: "Hải" });
  history.appendMessage("acc-1", "t-1", { role: "assistant", content: "chào bạn" });

  const { buildDashboardApp } = await import("./dashboard-server.js");
  app = buildDashboardApp();

  const login = await app.request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password: "mat-khau-test-123" }),
    headers: { "content-type": "application/json" },
  });
  sessionCookie = login.headers.get("set-cookie")!.split(";")[0]!;
});

after(async () => {
  const { closeDatabase } = await import("../conversation/database.js");
  closeDatabase();
  cleanupTestEnv(dataDir);
});

const authed = (path: string, init: RequestInit = {}) =>
  app.request(path, { ...init, headers: { ...init.headers, cookie: sessionCookie } });

describe("dashboard-server", () => {
  it("health không cần auth và không cache", async () => {
    const res = await app.request("/api/health");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  it("chưa login -> 401 mọi API", async () => {
    assert.equal((await app.request("/api/threads?accountId=acc-1")).status, 401);
    assert.equal((await app.request("/api/contacts?accountId=acc-1")).status, 401);
    assert.equal((await app.request("/api/overview")).status, 401);
  });

  it("login sai mật khẩu -> 401", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: "sai" }),
      headers: { "content-type": "application/json" },
    });
    assert.equal(res.status, 401);
  });

  it("login đúng -> cookie dùng được cho /api/auth/me", async () => {
    const res = await authed("/api/auth/me");
    assert.equal(res.status, 200);
  });

  it("GET /api/threads trả thread kèm usage", async () => {
    const res = await authed("/api/threads?accountId=acc-1");
    assert.equal(res.status, 200);
    const data = (await res.json()) as { items: { threadId: string; usage: unknown }[] };
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0]!.threadId, "t-1");
    assert.deepEqual(data.items[0]!.usage, { turns: 0, totalTokens: 0 });
  });

  it("GET messages của thread trả đúng thứ tự", async () => {
    const res = await authed("/api/threads/t-1/messages?accountId=acc-1");
    const data = (await res.json()) as { items: { content: string }[] };
    assert.deepEqual(data.items.map((m) => m.content), ["hi", "chào bạn"]);
  });

  it("PATCH bật/tắt bot per thread", async () => {
    const res = await authed("/api/threads/t-1", {
      method: "PATCH",
      body: JSON.stringify({ accountId: "acc-1", botEnabled: false }),
      headers: { "content-type": "application/json" },
    });
    assert.equal(res.status, 200);

    const threads = await import("../conversation/thread-store.js");
    assert.equal(threads.isBotEnabled("acc-1", "t-1"), false);
  });

  it("PATCH thread không tồn tại -> 404", async () => {
    const res = await authed("/api/threads/t-ma", {
      method: "PATCH",
      body: JSON.stringify({ accountId: "acc-1", botEnabled: false }),
      headers: { "content-type": "application/json" },
    });
    assert.equal(res.status, 404);
  });

  it("GET /api/provider trả key masked, không bao giờ plaintext", async () => {
    const res = await authed("/api/provider");
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(!body.includes("test-key"), "response không được chứa key đầy đủ");
    const data = JSON.parse(body) as { apiKeyMasked: string; hasOverride: boolean };
    assert.equal(data.hasOverride, false);
  });

  it("PATCH /api/provider đổi model, có hiệu lực ngay trong GET sau đó", async () => {
    const res = await authed("/api/provider", {
      method: "PATCH",
      body: JSON.stringify({ model: "model-tu-dashboard" }),
      headers: { "content-type": "application/json" },
    });
    assert.equal(res.status, 200);

    const after = (await (await authed("/api/provider")).json()) as {
      model: string;
      hasOverride: boolean;
    };
    assert.equal(after.model, "model-tu-dashboard");
    assert.equal(after.hasOverride, true);
  });

  it("PATCH /api/provider chặn dữ liệu sai (baseUrl không phải http)", async () => {
    const res = await authed("/api/provider", {
      method: "PATCH",
      body: JSON.stringify({ baseUrl: "ftp://sai" }),
      headers: { "content-type": "application/json" },
    });
    assert.equal(res.status, 400);
  });

  it("DELETE /api/provider xóa override", async () => {
    const res = await authed("/api/provider", { method: "DELETE" });
    assert.equal(res.status, 200);
    const data = (await (await authed("/api/provider")).json()) as { hasOverride: boolean };
    assert.equal(data.hasOverride, false);
  });
});
