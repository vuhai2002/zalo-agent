import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { Hono } from "hono";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";

/** API /api/logs - đọc lại log toàn hệ thống từ file */

let dataDir: string;
let app: Hono;
let sessionCookie: string;

const PASSWORD = "mat-khau-log-123";

type LogsBody = {
  entries: { level: number; scope: string; msg: string; fields: Record<string, unknown> }[];
  scopes: string[];
  disabled: boolean;
  hint?: string;
};

before(async () => {
  // Bật ghi file để route có cái mà đọc (mặc định test tắt cho gọn)
  dataDir = setupTestEnv({ DASHBOARD_PASSWORD: PASSWORD, LOG_FILE_ENABLED: "true" });

  // Ghi sẵn file log thay vì chờ bot sinh ra - test phải tất định
  const logDir = path.join(dataDir, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const dong = (level: number, scope: string, msg: string, extra = {}) =>
    JSON.stringify({ level, time: Date.now(), scope, msg, ...extra });
  fs.writeFileSync(
    path.join(logDir, "bot.2099-01-01.1.log"),
    [
      dong(20, "agent-loop", "chi tiết step"),
      dong(30, "message-turn", "xử lý lượt", { threadId: "t-9" }),
      dong(50, "account-manager", "mất kết nối Zalo"),
    ].join("\n") + "\n",
  );

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

const authed = (p: string) => app.request(p, { headers: { cookie: sessionCookie } });
const doc = async (p: string): Promise<LogsBody> => (await (await authed(p)).json()) as LogsBody;

describe("/api/logs", () => {
  it("chưa login -> 401", async () => {
    assert.equal((await app.request("/api/logs")).status, 401);
  });

  it("đọc được log, MỚI NHẤT đứng đầu, kèm trường phụ", async () => {
    const b = await doc("/api/logs");
    assert.equal(b.disabled, false);
    assert.equal(b.entries[0]!.msg, "mất kết nối Zalo", "dòng cuối của file mới nhất đứng đầu");
    assert.equal(b.entries[1]!.fields.threadId, "t-9", "trường phụ là chỗ chứa ngữ cảnh");
  });

  it("lọc theo mức: warn trở lên bỏ hết info và debug", async () => {
    const b = await doc("/api/logs?level=warn");
    assert.equal(b.entries[0]!.scope, "account-manager");
    assert.ok(!b.entries.some((e) => e.scope === "agent-loop"), "debug phải bị loại");
  });

  it("lọc theo scope", async () => {
    const b = await doc("/api/logs?scope=agent-loop");
    assert.equal(b.entries.length, 1);
    assert.equal(b.entries[0]!.msg, "chi tiết step");
  });

  it("tìm theo chữ", async () => {
    const b = await doc("/api/logs?search=kết%20nối");
    assert.equal(b.entries.length, 1);
  });

  it("trả danh sách scope để dashboard dựng ô lọc", async () => {
    const b = await doc("/api/logs");
    for (const s of ["account-manager", "agent-loop", "message-turn"]) {
      assert.ok(b.scopes.includes(s), `thiếu scope ${s}`);
    }
    assert.deepEqual(b.scopes, [...b.scopes].sort(), "scope phải sắp xếp");
  });

  it("limit bị kẹp trần, xin 99999 không kéo sập trang", async () => {
    const b = await doc("/api/logs?limit=99999");
    assert.ok(b.entries.length <= 500);
  });
});
