import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Hono } from "hono";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";

/**
 * API /api/tuning - các tham số vốn chỉ sửa được trong `.env`.
 *
 * Route này ghi thẳng vào `runtime_settings` nên phải chặn được key bịa (rác
 * vĩnh viễn trong bảng) và giá trị ngoài khoảng (bot chạy sai mà không ai biết).
 */

let dataDir: string;
let app: Hono;
let cookie: string;
let database: typeof import("../../conversation/database.js");

const PASSWORD = "mat-khau-tuning-123";

before(async () => {
  dataDir = setupTestEnv({ DASHBOARD_PASSWORD: PASSWORD, LLM_MAX_STEPS: "8" });
  const { buildDashboardApp } = await import("../dashboard-server.js");
  app = buildDashboardApp();
  database = await import("../../conversation/database.js");

  const login = await app.request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password: PASSWORD }),
    headers: { "content-type": "application/json" },
  });
  cookie = login.headers.get("set-cookie")!.split(";")[0]!;
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(() => {
  database.db.exec("DELETE FROM runtime_settings WHERE key LIKE 'tuning_%';");
});

const luu = (values: Record<string, unknown>) =>
  app.request("/api/tuning", {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ values }),
  });

describe("GET /api/tuning", () => {
  it("trả cả định nghĩa lẫn giá trị - web không phải chép lại danh mục", async () => {
    const r = await app.request("/api/tuning", { headers: { cookie } });
    assert.equal(r.status, 200);
    const body = (await r.json()) as {
      groups: { id: string }[];
      defs: Record<string, { label: string; group: string }>;
      values: { key: string; value: unknown; fromEnv: boolean }[];
    };
    assert.ok(body.groups.length > 0);
    assert.ok(body.defs.LLM_MAX_STEPS?.label);
    assert.equal(body.values.find((v) => v.key === "LLM_MAX_STEPS")?.value, 8);
    assert.equal(body.values.find((v) => v.key === "LLM_MAX_STEPS")?.fromEnv, true);
  });

  it("mỗi tham số phải thuộc một nhóm CÓ THẬT, không thì nó không hiện trên web", async () => {
    const r = await app.request("/api/tuning", { headers: { cookie } });
    const body = (await r.json()) as {
      groups: { id: string }[];
      defs: Record<string, { group: string }>;
    };
    const ids = new Set(body.groups.map((g) => g.id));
    for (const [key, def] of Object.entries(body.defs)) {
      assert.ok(ids.has(def.group), `${key} thuộc nhóm "${def.group}" không tồn tại`);
    }
  });

  it("chưa đăng nhập thì không xem được", async () => {
    assert.equal((await app.request("/api/tuning")).status, 401);
  });
});

describe("PUT /api/tuning", () => {
  it("lưu rồi đọc lại thấy giá trị mới và fromEnv = false", async () => {
    const r = await luu({ LLM_MAX_STEPS: 12 });
    assert.equal(r.status, 200);
    const body = (await r.json()) as { values: { key: string; value: unknown; fromEnv: boolean }[] };
    const o = body.values.find((v) => v.key === "LLM_MAX_STEPS")!;
    assert.equal(o.value, 12);
    assert.equal(o.fromEnv, false);
  });

  it("null = trả về giá trị trong .env", async () => {
    await luu({ LLM_MAX_STEPS: 12 });
    const r = await luu({ LLM_MAX_STEPS: null });
    const body = (await r.json()) as { values: { key: string; value: unknown; fromEnv: boolean }[] };
    const o = body.values.find((v) => v.key === "LLM_MAX_STEPS")!;
    assert.equal(o.value, 8);
    assert.equal(o.fromEnv, true);
  });

  it("key bịa bị chặn - nếu không sẽ thành rác vĩnh viễn trong runtime_settings", async () => {
    const r = await luu({ KHONG_CO_THAM_SO_NAY: 1 });
    assert.equal(r.status, 400);
    const con = database.db
      .prepare("SELECT COUNT(*) n FROM runtime_settings WHERE key LIKE 'tuning_%'")
      .get() as { n: number };
    assert.equal(con.n, 0, "không được ghi gì khi dữ liệu sai");
  });

  it("số ngoài khoảng cho phép bị chặn kèm câu nói rõ khoảng", async () => {
    const r = await luu({ LLM_MAX_STEPS: 999 });
    assert.equal(r.status, 400);
    assert.match((await r.json() as { error: string }).error, /1 - 30/);
  });

  it("sai kiểu bị chặn", async () => {
    assert.equal((await luu({ LLM_MAX_STEPS: "tam" })).status, 400);
    assert.equal((await luu({ AGENT_TRACE_ENABLED: 5 })).status, 400);
    assert.equal((await luu({ LLM_REASONING_EFFORT: "sieu-cao" })).status, 400);
  });

  it("ràng buộc chéo bị chặn kèm lý do đọc được", async () => {
    const r = await luu({ LLM_TURN_TIMEOUT_MS: 120_000, IMAGE_GEN_TIMEOUT_MS: 600_000 });
    assert.equal(r.status, 400);
    assert.match((await r.json() as { error: string }).error, /lớn hơn trần thời gian mỗi ảnh/);
  });

  it("một ô sai thì KHÔNG ô nào được ghi - tránh lưu nửa vời", async () => {
    await luu({ LLM_MAX_STEPS: 12, WEB_FETCH_MAX_CHARS: 99_999_999 });
    const con = database.db
      .prepare("SELECT COUNT(*) n FROM runtime_settings WHERE key LIKE 'tuning_%'")
      .get() as { n: number };
    assert.equal(con.n, 0);
  });

  it("chưa đăng nhập thì không sửa được", async () => {
    const r = await app.request("/api/tuning", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ values: { LLM_MAX_STEPS: 3 } }),
    });
    assert.equal(r.status, 401);
  });
});
