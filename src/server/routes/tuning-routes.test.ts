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

  it("mỗi nhóm phải có navHint - thiếu thì mục đó trống chữ ở danh mục bên trái", async () => {
    const r = await app.request("/api/tuning", { headers: { cookie } });
    const body = (await r.json()) as { groups: { id: string; title: string; navHint?: string }[] };
    for (const g of body.groups) {
      assert.ok(g.navHint && g.navHint.trim().length > 0, `nhóm "${g.id}" thiếu navHint`);
      // Nav là ô hẹp - câu dài sẽ bị cắt giữa chừng, đúng lỗi đã phải sửa 1 lần
      assert.ok(g.navHint.length <= 40, `navHint của "${g.id}" dài ${g.navHint.length} ký tự, sẽ bị cắt`);
    }
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

describe("Đặt lại TẤT CẢ - gửi null cho mọi key trong 1 request", () => {
  it("xoá sạch phần đè, mọi ô về lại .env", async () => {
    await luu({ LLM_MAX_STEPS: 12, WEB_SEARCH_MAX_RESULTS: 9 });

    const r = await luu({ LLM_MAX_STEPS: null, WEB_SEARCH_MAX_RESULTS: null });
    assert.equal(r.status, 200);
    const body = (await r.json()) as { values: { key: string; value: unknown; fromEnv: boolean }[] };
    assert.equal(body.values.find((v) => v.key === "LLM_MAX_STEPS")?.fromEnv, true);
    assert.equal(body.values.find((v) => v.key === "WEB_SEARCH_MAX_RESULTS")?.fromEnv, true);
  });

  it("KHÔNG đụng tới mật khẩu dashboard - nó ở khoá riêng, không phải tham số tuning", async () => {
    // Nút "đặt lại cấu hình" mà âm thầm hạ mật khẩu về giá trị .env cũ là ca
    // người dùng không lường trước được, và có thể khoá họ ra khỏi dashboard.
    //
    // Đặt mật khẩu bằng ĐÚNG hàm thật rồi đăng nhập LẠI: ghi thẳng một chuỗi
    // hash giả vào DB làm mọi phiên cũ hết hiệu lực (fingerprint đổi theo), và
    // request sau đó bị chặn 401 TRƯỚC khi tới route - lần đầu viết test này
    // tôi dính đúng bẫy đó, test xanh mà chẳng kiểm được gì.
    const { setStoredPassword } = await import("../dashboard-password-store.js");
    setStoredPassword("mat-khau-moi-de-test-123");
    const loginLai = await app.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: "mat-khau-moi-de-test-123" }),
      headers: { "content-type": "application/json" },
    });
    const cookieMoi = loginLai.headers.get("set-cookie")!.split(";")[0]!;
    const truoc = (
      database.db.prepare("SELECT value FROM runtime_settings WHERE key = 'dashboard_password'").get() as {
        value: string;
      }
    ).value;

    const r = await app.request("/api/tuning", {
      method: "PUT",
      headers: { cookie: cookieMoi, "content-type": "application/json" },
      body: JSON.stringify({ values: { LLM_MAX_STEPS: null, WEB_SEARCH_MAX_RESULTS: null } }),
    });
    assert.equal(r.status, 200, "request phải thật sự tới được route, không phải bị chặn 401");

    const sau = database.db
      .prepare("SELECT value FROM runtime_settings WHERE key = 'dashboard_password'")
      .get() as { value: string } | undefined;
    assert.equal(sau?.value, truoc, "mật khẩu phải còn NGUYÊN sau khi đặt lại toàn bộ cấu hình");

    // Trả mật khẩu về .env RỒI đăng nhập lại: `cookie` dùng chung cả file được
    // ký theo mật khẩu cũ, đổi mật khẩu là nó hết hiệu lực và mọi ca test chạy
    // sau đây nhận 401 - đúng lỗi vừa dính khi viết ca này.
    database.db.exec("DELETE FROM runtime_settings WHERE key = 'dashboard_password';");
    const dangNhapLai = await app.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: PASSWORD }),
      headers: { "content-type": "application/json" },
    });
    cookie = dangNhapLai.headers.get("set-cookie")!.split(";")[0]!;
  });
});

describe("BOT_TIMEZONE - ô chuỗi tự do, hỏng là lệch giờ âm thầm", () => {
  it("nhận tên timezone IANA hợp lệ", async () => {
    const r = await luu({ BOT_TIMEZONE: "Europe/Paris" });
    assert.equal(r.status, 200);
    const body = (await r.json()) as { values: { key: string; value: unknown }[] };
    assert.equal(body.values.find((v) => v.key === "BOT_TIMEZONE")?.value, "Europe/Paris");
  });

  it("tên zone bịa bị chặn ở route - lọt vào DB thì luxon rơi về UTC không báo gì", async () => {
    const r = await luu({ BOT_TIMEZONE: "Asia/Khong_Co_That" });
    assert.equal(r.status, 400);
    assert.match(((await r.json()) as { error: string }).error, /timezone/i);
  });

  it("zone hỏng SẴN trong DB vẫn không làm lệch giờ - getTuning tự rơi về .env", async () => {
    // Đường vòng qua route bị chặn rồi, nhưng DB vẫn có thể hỏng theo đường
    // khác (sửa tay, bản cũ ghi trước khi có kiểm). Đây là lưới đỡ thứ hai.
    database.db
      .prepare(
        "INSERT INTO runtime_settings (key, value, updated_at) VALUES ('tuning_BOT_TIMEZONE', 'Sao/Hoa', 'x')",
      )
      .run();
    const { getTuning } = await import("../../config/runtime-tuning-settings.js");
    assert.equal(getTuning("BOT_TIMEZONE"), "Asia/Ho_Chi_Minh", "phải rơi về giá trị .env, không trả zone hỏng");
  });
});
