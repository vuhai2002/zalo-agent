import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let store: typeof import("./mcp-server-store.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  store = await import("./mcp-server-store.js");
  database = await import("../conversation/database.js");
});
after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});
beforeEach(() => {
  for (const t of ["mcp_servers", "agent_mcp_servers"]) database.db.exec(`DELETE FROM ${t}`);
});

describe("mcp-server-store", () => {
  it("tạo rồi đọc lại, header giải mã khớp", () => {
    const s = store.taoServer({ ten: "Notion", url: "https://x/mcp", headers: { Authorization: "Bearer k" } });
    const noiBo = store.layServerNoiBo(s.id)!;
    assert.equal(noiBo.headers.Authorization, "Bearer k");
    assert.equal(noiBo.trangThai, "cho_ket_noi");
  });
  it("header lưu ở dạng mã hóa, KHÔNG plaintext", () => {
    const s = store.taoServer({ ten: "a", url: "https://x/mcp", headers: { Authorization: "Bearer secret123" } });
    const row = database.db.prepare("SELECT headers_ma_hoa FROM mcp_servers WHERE id = ?").get(s.id) as { headers_ma_hoa: string };
    assert.ok(!row.headers_ma_hoa.includes("secret123"), "header bị lưu plaintext");
  });
  it("danhSachServer KHÔNG lộ headers", () => {
    store.taoServer({ ten: "a", url: "https://x/mcp", headers: { Authorization: "Bearer k" } });
    assert.ok(!("headers" in store.danhSachServer()[0]!));
  });
  it("capNhatServer headers===undefined thì GIỮ nguyên", () => {
    const s = store.taoServer({ ten: "a", url: "https://x/mcp", headers: { Authorization: "Bearer k" } });
    store.capNhatServer(s.id, { ten: "b" });
    assert.equal(store.layServerNoiBo(s.id)!.headers.Authorization, "Bearer k");
  });
  it("xoaHeaders xóa hẳn header", () => {
    const s = store.taoServer({ ten: "a", url: "https://x/mcp", headers: { Authorization: "Bearer k" } });
    store.xoaHeaders(s.id);
    assert.deepEqual(store.layServerNoiBo(s.id)!.headers, {});
  });
  it("xoaServer dọn luôn dòng gán trong agent_mcp_servers", () => {
    const s = store.taoServer({ ten: "a", url: "https://x/mcp" });
    database.db.prepare("INSERT INTO agent_mcp_servers (agent_id, server_id) VALUES (?, ?)").run("ag1", s.id);
    store.xoaServer(s.id);
    const con = database.db.prepare("SELECT COUNT(*) AS n FROM agent_mcp_servers WHERE server_id = ?").get(s.id) as { n: number };
    assert.equal(con.n, 0);
  });
});
