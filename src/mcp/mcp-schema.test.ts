import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  database = await import("../conversation/database.js"); // chạy migration ở module scope
});
after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

const cotCua = (bang: string): string[] =>
  (database.db.prepare(`SELECT name FROM pragma_table_info('${bang}')`).all() as { name: string }[]).map(
    (r) => r.name,
  );

describe("mcp-schema", () => {
  it("tạo bảng mcp_servers đủ cột", () => {
    const cot = cotCua("mcp_servers");
    for (const c of [
      "id",
      "ten",
      "url",
      "headers_ma_hoa",
      "enabled",
      "trang_thai",
      "loi",
      "tools_snapshot",
      "fingerprint",
    ])
      assert.ok(cot.includes(c), `thiếu cột ${c}`);
  });

  it("tạo bảng agent_mcp_servers (khóa ghép)", () => {
    assert.deepEqual(cotCua("agent_mcp_servers").sort(), ["agent_id", "server_id"]);
  });

  it("trang_thai chỉ nhận 4 giá trị hợp lệ (CHECK chặn giá trị lạ)", () => {
    assert.throws(() => {
      database.db
        .prepare(`INSERT INTO mcp_servers (id, ten, url, trang_thai) VALUES (?, ?, ?, ?)`)
        .run("test-check-invalid", "test", "http://x", "gia_tri_bay");
    });
  });

  it("agent_mcp_servers chặn chèn trùng khóa ghép (agent_id, server_id)", () => {
    database.db
      .prepare(`INSERT INTO agent_mcp_servers (agent_id, server_id) VALUES (?, ?)`)
      .run("agent-a", "server-b");
    assert.throws(() => {
      database.db
        .prepare(`INSERT INTO agent_mcp_servers (agent_id, server_id) VALUES (?, ?)`)
        .run("agent-a", "server-b");
    });
  });
});
