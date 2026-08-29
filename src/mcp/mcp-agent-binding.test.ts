import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let bind: typeof import("./mcp-agent-binding.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  bind = await import("./mcp-agent-binding.js");
  database = await import("../conversation/database.js");
});
after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});
beforeEach(() => {
  for (const t of ["agent_mcp_servers", "mcp_servers"]) database.db.exec(`DELETE FROM ${t}`);
});

describe("mcp-agent-binding", () => {
  it("agent chưa gán -> RỖNG (default-deny)", () => {
    assert.deepEqual(bind.serversCuaAgent("ag1"), []);
  });
  it("default-deny giữ kể cả khi CÓ server tồn tại", () => {
    database.db.prepare("INSERT INTO mcp_servers (id, ten, url) VALUES (?, ?, ?)").run("s1", "a", "https://x/mcp");
    database.db.prepare("INSERT INTO mcp_servers (id, ten, url) VALUES (?, ?, ?)").run("s2", "b", "https://y/mcp");
    bind.datServerChoAgent("agent-khac", ["s1"]);
    assert.deepEqual(bind.serversCuaAgent("agent-chua-gan"), []);
  });
  it("datServerChoAgent THAY THẾ, không cộng dồn", () => {
    bind.datServerChoAgent("ag1", ["s1", "s2"]);
    bind.datServerChoAgent("ag1", ["s3"]);
    assert.deepEqual(bind.serversCuaAgent("ag1"), ["s3"]);
  });
  it("xoaGanServerCuaAgent dọn sạch một agent", () => {
    bind.datServerChoAgent("ag1", ["s1"]);
    bind.xoaGanServerCuaAgent("ag1");
    assert.deepEqual(bind.serversCuaAgent("ag1"), []);
  });
});
