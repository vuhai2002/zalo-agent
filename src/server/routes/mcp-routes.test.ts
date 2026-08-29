import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";

let dataDir: string;
let routes: typeof import("./mcp-routes.js");
let store: typeof import("../../mcp/mcp-server-store.js");
let binding: typeof import("../../mcp/mcp-agent-binding.js");
let database: typeof import("../../conversation/database.js");

const managerGia = {
  goi: [] as string[],
  ketNoiLaiServer: async (id: string) => {
    managerGia.goi.push(`noi:${id}`);
  },
  ngatServer: async (id: string) => {
    managerGia.goi.push(`ngat:${id}`);
  },
  duyetLaiDrift: async (id: string) => {
    managerGia.goi.push(`duyet:${id}`);
  },
  trangThaiCacServer: () => [],
};

before(async () => {
  dataDir = setupTestEnv();
  database = await import("../../conversation/database.js");
  store = await import("../../mcp/mcp-server-store.js");
  binding = await import("../../mcp/mcp-agent-binding.js");
  routes = await import("./mcp-routes.js");
});
after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});
beforeEach(() => {
  for (const t of ["mcp_servers", "agent_mcp_servers"]) database.db.exec(`DELETE FROM ${t}`);
  managerGia.goi.length = 0;
});

describe("mcp-routes", () => {
  const app = () => routes.createMcpRoutes({ manager: managerGia });

  it("POST / tạo server + gọi ketNoiLaiServer", async () => {
    const res = await app().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ten: "svr", url: "https://x/mcp" }),
    });
    assert.equal(res.status, 201);
    assert.equal(store.danhSachServer().length, 1);
    assert.ok(managerGia.goi.some((g) => g.startsWith("noi:")));
  });

  it("POST / url rỗng -> 400", async () => {
    const res = await app().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ten: "svr", url: "" }),
    });
    assert.equal(res.status, 400);
  });

  it("PATCH /:id sửa + gọi ketNoiLaiServer nối lại", async () => {
    const svr = store.taoServer({ ten: "svr", url: "https://x/mcp" });
    const res = await app().request(`/${svr.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ten: "svr moi" }),
    });
    assert.equal(res.status, 200);
    assert.equal(store.danhSachServer()[0]?.ten, "svr moi");
    assert.ok(managerGia.goi.includes(`noi:${svr.id}`));
  });

  it("POST /:id/duyet-lai gọi duyetLaiDrift", async () => {
    const svr = store.taoServer({ ten: "svr", url: "https://x/mcp" });
    const res = await app().request(`/${svr.id}/duyet-lai`, { method: "POST" });
    assert.equal(res.status, 200);
    assert.ok(managerGia.goi.includes(`duyet:${svr.id}`));
  });

  it("PUT /agents/:agentId/servers lưu gán", async () => {
    const svr = store.taoServer({ ten: "svr", url: "https://x/mcp" });
    const res = await app().request("/agents/agent-a/servers", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serverIds: [svr.id] }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(binding.serversCuaAgent("agent-a"), [svr.id]);
  });

  it("PUT /:id/agents lưu gán chiều ngược", async () => {
    const svr = store.taoServer({ ten: "svr", url: "https://x/mcp" });
    const res = await app().request(`/${svr.id}/agents`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentIds: ["agent-b"] }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(binding.agentCuaServer(svr.id), ["agent-b"]);
  });

  it("DELETE /:id ngắt rồi xóa", async () => {
    const svr = store.taoServer({ ten: "svr", url: "https://x/mcp" });
    const res = await app().request(`/${svr.id}`, { method: "DELETE" });
    assert.equal(res.status, 200);
    assert.equal(store.danhSachServer().length, 0);
    assert.ok(managerGia.goi.includes(`ngat:${svr.id}`));
  });

  it("DELETE /:id/headers xóa header", async () => {
    const svr = store.taoServer({ ten: "svr", url: "https://x/mcp", headers: { Authorization: "Bearer x" } });
    assert.equal(store.danhSachServer()[0]?.hasHeaders, true);
    const res = await app().request(`/${svr.id}/headers`, { method: "DELETE" });
    assert.equal(res.status, 200);
    assert.equal(store.danhSachServer()[0]?.hasHeaders, false);
  });
});
