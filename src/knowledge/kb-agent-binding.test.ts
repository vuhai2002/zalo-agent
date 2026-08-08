import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let store: typeof import("./kb-source-store.js");
let binding: typeof import("./kb-agent-binding.js");
let database: typeof import("../conversation/database.js");
let n1: { id: string };
let n2: { id: string };

before(async () => {
  dataDir = setupTestEnv();
  store = await import("./kb-source-store.js");
  binding = await import("./kb-agent-binding.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(() => {
  for (const t of ["kb_sources", "kb_chunks", "kb_chunks_fts", "agent_kb_sources"]) {
    database.db.exec(`DELETE FROM ${t}`);
  }
  n1 = store.taoNguon({ ten: "nguồn 1", loai: "text", noiDungGoc: "a" });
  n2 = store.taoNguon({ ten: "nguồn 2", loai: "text", noiDungGoc: "b" });
});

describe("kb-agent-binding - mặc định đóng", () => {
  it("agent chưa gán nguồn nào thì đọc được RỖNG - mặc định đóng", () => {
    assert.deepEqual(binding.nguonCuaAgent("agent-moi"), []);
  });

  it("agent khác được gán không làm agent này thấy nguồn", () => {
    binding.datNguonChoAgent("agent-a", [n1.id]);
    assert.deepEqual(binding.nguonCuaAgent("agent-b"), []);
  });
});

describe("kb-agent-binding - đặt lại là THAY THẾ", () => {
  it("đặt lại danh sách là THAY THẾ, không cộng dồn", () => {
    binding.datNguonChoAgent("a1", [n1.id, n2.id]);
    binding.datNguonChoAgent("a1", [n2.id]);
    assert.deepEqual(binding.nguonCuaAgent("a1"), [n2.id]);
  });

  it("đặt lại thành mảng rỗng thì thu hồi hết quyền đọc", () => {
    binding.datNguonChoAgent("a1", [n1.id, n2.id]);
    binding.datNguonChoAgent("a1", []);
    assert.deepEqual(binding.nguonCuaAgent("a1"), []);
  });

  it("id trùng trong danh sách truyền vào không làm nổ UNIQUE", () => {
    binding.datNguonChoAgent("a1", [n1.id, n1.id]);
    assert.deepEqual(binding.nguonCuaAgent("a1"), [n1.id]);
  });
});
