import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let agents: typeof import("../config/agent-store.js");
let bind: typeof import("./mcp-agent-binding.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  agents = await import("../config/agent-store.js");
  bind = await import("./mcp-agent-binding.js");
  database = await import("../conversation/database.js");
});
after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});
beforeEach(() => database.db.exec("DELETE FROM agent_mcp_servers"));

describe("dọn gán MCP khi xóa agent", () => {
  it("deleteAgent xóa luôn agent_mcp_servers của nó", () => {
    const ag = agents.createAgent({ id: "ban-hang", name: "Ban hang", persona: "x", icon: "🤖" });
    bind.datServerChoAgent(ag.id, ["s1"]);
    const kq = agents.deleteAgent(ag.id);
    assert.equal(kq.ok, true);
    assert.deepEqual(bind.serversCuaAgent(ag.id), []);
  });
});
