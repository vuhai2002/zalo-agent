import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Hono } from "hono";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";

/**
 * /api/overview - tham số `days` của biểu đồ mức dùng.
 *
 * Chỉ nhận vài giá trị định sẵn: `getDailyUsage` quét mọi dòng `agent_turns` từ
 * mốc `since` rồi gộp trong JS, nên `?days=100000` biến một tham số URL thành
 * cách làm nghẽn cả tiến trình.
 */

const PASSWORD = "mat-khau-overview-123";

let dataDir: string;
let app: Hono;
let cookie: string;
let database: typeof import("../../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv({ DASHBOARD_PASSWORD: PASSWORD });
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

const xem = async (query = "") => {
  const r = await app.request(`/api/overview${query}`, { headers: { cookie } });
  return { status: r.status, body: (await r.json()) as { days: number } };
};

describe("GET /api/overview - cửa sổ ngày của biểu đồ", () => {
  it("không truyền days thì mặc định 7", async () => {
    const r = await xem();
    assert.equal(r.status, 200);
    assert.equal(r.body.days, 7);
  });

  it("nhận đúng các mốc được phép", async () => {
    for (const d of [7, 14, 30]) {
      assert.equal((await xem(`?days=${d}`)).body.days, d, `days=${d} phải được giữ nguyên`);
    }
  });

  it("số ngoài danh sách bị kẹp về 7 - chặn quét toàn bảng agent_turns", async () => {
    for (const d of [999, 100000, 0, -5, 1.5]) {
      assert.equal((await xem(`?days=${d}`)).body.days, 7, `days=${d} phải bị kẹp về mặc định`);
    }
  });

  it("giá trị không phải số cũng về 7, không làm vỡ route", async () => {
    for (const d of ["abc", "", "7;DROP TABLE"]) {
      const r = await xem(`?days=${encodeURIComponent(d)}`);
      assert.equal(r.status, 200);
      assert.equal(r.body.days, 7);
    }
  });

  it("trả về số ngày ĐANG hiệu lực, không phải số client gửi lên", async () => {
    // Client gửi 999 mà response ghi 999 thì UI sẽ hiện "999 ngày gần nhất"
    // trong khi dữ liệu chỉ có 7 ngày - nói dối người đọc.
    assert.equal((await xem("?days=999")).body.days, 7);
  });

  it("chưa đăng nhập thì không xem được", async () => {
    assert.equal((await app.request("/api/overview")).status, 401);
  });
});
