import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Hono } from "hono";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";

/** API /api/image-gen - cấu hình endpoint vẽ ảnh cho tool create_image */

let dataDir: string;
let app: Hono;
let sessionCookie: string;

const PASSWORD = "mat-khau-image-123";

before(async () => {
  dataDir = setupTestEnv({ DASHBOARD_PASSWORD: PASSWORD, IMAGE_GEN_BASE_URL: "", IMAGE_GEN_MODEL: "" });
  const { buildDashboardApp } = await import("../dashboard-server.js");
  app = buildDashboardApp();

  const login = await app.request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password: PASSWORD }),
    headers: { "content-type": "application/json" },
  });
  sessionCookie = login.headers.get("set-cookie")!.split(";")[0]!;
});

after(async () => {
  const { closeDatabase } = await import("../../conversation/database.js");
  closeDatabase();
  cleanupTestEnv(dataDir);
});

const authed = (path: string, init: RequestInit = {}) =>
  app.request(path, { ...init, headers: { ...init.headers, cookie: sessionCookie } });

const patchImage = (body: unknown) =>
  authed("/api/image-gen", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

type ImageView = {
  baseUrl: string;
  model: string;
  apiKeyMasked: string;
  hasApiKey: boolean;
  configured: boolean;
};

const getImage = async (): Promise<ImageView> => (await (await authed("/api/image-gen")).json()) as ImageView;

const FULL = { baseUrl: "https://router.test", model: "cx/gpt-5.5-image", apiKey: "sk-bi-mat-can-xoa" };

describe("/api/image-gen", () => {
  it("chưa login -> 401", async () => {
    assert.equal((await app.request("/api/image-gen")).status, 401);
    assert.equal((await app.request("/api/image-gen", { method: "DELETE" })).status, 401);
  });

  it("lúc đầu chưa cấu hình gì", async () => {
    const view = await getImage();
    assert.equal(view.configured, false);
    assert.equal(view.hasApiKey, false);
  });

  it("PATCH đủ 3 field -> configured, key bị mask", async () => {
    const res = await patchImage(FULL);
    assert.equal(res.status, 200);

    const view = await getImage();
    assert.equal(view.baseUrl, "https://router.test");
    assert.equal(view.model, "cx/gpt-5.5-image");
    assert.equal(view.configured, true);
    assert.equal(view.hasApiKey, true);
    assert.notEqual(view.apiKeyMasked, FULL.apiKey);
  });

  it("API KHÔNG BAO GIỜ trả key plaintext", async () => {
    const raw = await (await authed("/api/image-gen")).text();
    assert.ok(!raw.includes(FULL.apiKey), "key thật lọt ra response là lỗi bảo mật");
  });

  it("PATCH không kèm apiKey thì GIỮ key cũ", async () => {
    await patchImage({ model: "cx/gpt-5.3-image" });
    const view = await getImage();
    assert.equal(view.model, "cx/gpt-5.3-image");
    assert.equal(view.hasApiKey, true, "đổi mỗi model mà mất key là bẫy người dùng");
  });

  it("base URL không phải http -> 400", async () => {
    assert.equal((await patchImage({ baseUrl: "ftp://sai.test" })).status, 400);
  });

  it("DELETE xóa sạch cả key - đường duy nhất gỡ key vì PATCH quy ước giữ key cũ", async () => {
    const res = await authed("/api/image-gen", { method: "DELETE" });
    assert.equal(res.status, 200);

    const view = await getImage();
    assert.equal(view.hasApiKey, false);
    assert.equal(view.baseUrl, "");
    assert.equal(view.model, "");
    assert.equal(view.configured, false);
  });

  it("POST /test khi chưa cấu hình -> 502 kèm lý do, không phải crash 500", async () => {
    const res = await authed("/api/image-gen/test", { method: "POST" });
    assert.equal(res.status, 502);
    const body = (await res.json()) as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.match(body.error, /chưa cấu hình/i);
  });
});
