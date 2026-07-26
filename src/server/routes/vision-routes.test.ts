import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Hono } from "hono";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";

/**
 * API /api/vision - tách khỏi dashboard-server.test.ts (đã dài) vì đây là
 * nhóm route riêng: cấu hình đọc ảnh + sidecar.
 */

let dataDir: string;
let app: Hono;
let sessionCookie: string;

const PASSWORD = "mat-khau-vision-123";

before(async () => {
  dataDir = setupTestEnv({ DASHBOARD_PASSWORD: PASSWORD });
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

const patchVision = (body: unknown) =>
  authed("/api/vision", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

type VisionView = {
  mode: string;
  sidecar: {
    baseUrl: string;
    model: string;
    apiKeyMasked: string;
    hasApiKey: boolean;
    configured: boolean;
  };
  imageMode: string;
};

const getVision = async (): Promise<VisionView> => (await (await authed("/api/vision")).json()) as VisionView;

const SIDECAR = {
  sidecarBaseUrl: "https://gemini.test/v1beta/openai",
  sidecarModel: "gemini-3.5-flash-lite",
  sidecarApiKey: "AIza-secret-can-xoa",
};

describe("/api/vision", () => {
  it("chưa login -> 401", async () => {
    assert.equal((await app.request("/api/vision")).status, 401);
    assert.equal((await app.request("/api/vision/sidecar", { method: "DELETE" })).status, 401);
  });

  it("GET trả mode + trạng thái sidecar, chưa cấu hình thì configured = false", async () => {
    const data = await getVision();
    assert.equal(data.mode, "auto");
    assert.equal(data.sidecar.configured, false);
    assert.equal(data.sidecar.hasApiKey, false);
    assert.ok(["native", "describe", "hybrid", "blind"].includes(data.imageMode));
  });

  it("hasApiKey là cờ riêng vì apiKeyMasked KHÔNG BAO GIỜ rỗng (UI dựa vào để hiện nút xóa)", async () => {
    const empty = await getVision();
    assert.equal(empty.sidecar.hasApiKey, false);
    assert.notEqual(empty.sidecar.apiKeyMasked, "", "mask trống vẫn ra chuỗi mô tả, không phải ''");
  });

  it("PATCH lưu sidecar; key trả về LUÔN masked, không lộ plaintext", async () => {
    const res = await patchVision(SIDECAR);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(!body.includes(SIDECAR.sidecarApiKey), "response không được chứa key nguyên văn");

    const data = await getVision();
    assert.equal(data.sidecar.configured, true);
    assert.equal(data.sidecar.model, SIDECAR.sidecarModel);
    assert.notEqual(data.sidecar.apiKeyMasked, SIDECAR.sidecarApiKey);
  });

  it("PATCH bỏ trống key = GIỮ key cũ (vì thế mới cần nút xóa riêng)", async () => {
    await patchVision({ sidecarModel: "gemini-3.1-flash-lite" });
    const data = await getVision();
    assert.equal(data.sidecar.model, "gemini-3.1-flash-lite");
    assert.equal(data.sidecar.configured, true, "key vẫn còn nên vẫn đủ cấu hình");
  });

  it("PATCH chặn dữ liệu sai (baseUrl không phải http)", async () => {
    const res = await patchVision({ sidecarBaseUrl: "ftp://sai" });
    assert.equal(res.status, 400);
  });

  it("PATCH mode off có hiệu lực ngay: imageMode chuyển sang describe (đang có sidecar)", async () => {
    await patchVision({ mode: "off" });
    const data = await getVision();
    assert.equal(data.mode, "off");
    assert.equal(data.imageMode, "describe");
  });

  it("DELETE /sidecar xóa SẠCH cả key - sidecar tắt, imageMode rơi về blind", async () => {
    const res = await authed("/api/vision/sidecar", { method: "DELETE" });
    assert.equal(res.status, 200);

    const data = await getVision();
    assert.equal(data.sidecar.configured, false);
    assert.equal(data.sidecar.baseUrl, "");
    assert.equal(data.sidecar.model, "");
    assert.equal(data.sidecar.hasApiKey, false, "key phải bị gỡ khỏi DB, không chỉ ẩn đi");
    // mode vẫn off + không còn sidecar -> bot bỏ ảnh và nói thật
    assert.equal(data.imageMode, "blind");
  });

  it("sau khi xóa, read_image biến mất khỏi schema gửi model (qua /api/tools)", async () => {
    const tools = (await (await authed("/api/tools")).json()) as {
      items: { key: string; available: boolean }[];
    };
    assert.equal(tools.items.find((t) => t.key === "read_image")?.available, false);
  });

  it("POST /test khi chưa cấu hình -> 502 kèm lý do, không 500", async () => {
    const res = await authed("/api/vision/test", { method: "POST" });
    assert.equal(res.status, 502);
    const data = (await res.json()) as { ok: boolean; error: string };
    assert.equal(data.ok, false);
    assert.match(data.error, /base URL \+ model \+ API key/);
  });
});
