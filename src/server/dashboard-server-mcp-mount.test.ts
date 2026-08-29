import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let mod: typeof import("./dashboard-server.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv({ DASHBOARD_PASSWORD: "matkhau-test" }); // bật auth
  database = await import("../conversation/database.js");
  mod = await import("./dashboard-server.js");
});
after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

describe("mount /api/mcp", () => {
  it("không session -> 401 (đã mount sau auth), không phải 404", async () => {
    const app = mod.buildDashboardApp();
    const res = await app.request("/api/mcp", { headers: { host: "127.0.0.1" } });
    assert.equal(res.status, 401);
  });
});
