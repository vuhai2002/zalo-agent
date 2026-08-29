import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { tool } from "ai";
import { z } from "zod";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let mgr: typeof import("./mcp-manager.js");
let store: typeof import("./mcp-server-store.js");
let binding: typeof import("./mcp-agent-binding.js");
let database: typeof import("../conversation/database.js");
let tuning: typeof import("../config/runtime-tuning-settings.js");

const connectGia = (tenTool: string[]) => async () => ({
  tools: async () =>
    Object.fromEntries(
      tenTool.map((t) => [t, tool({ description: `mô tả ${t}`, inputSchema: z.object({}), execute: async () => "ok" })]),
    ),
  close: async () => {},
});

before(async () => {
  dataDir = setupTestEnv();
  database = await import("../conversation/database.js");
  store = await import("./mcp-server-store.js");
  binding = await import("./mcp-agent-binding.js");
  mgr = await import("./mcp-manager.js");
  tuning = await import("../config/runtime-tuning-settings.js");
});
after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});
beforeEach(() => {
  for (const t of ["mcp_servers", "agent_mcp_servers"]) database.db.exec(`DELETE FROM ${t}`);
  // `dangNoi`/`dangNap` là Map/Set cấp MODULE - xóa bảng DB ở trên không đụng
  // tới chúng, nên phải dọn riêng để mỗi test bắt đầu từ cache RAM sạch.
  mgr.resetChoTest();
});

describe("mcp-manager", () => {
  it("nối rồi mcpToolDefinitions chỉ cho agent được gán", async () => {
    mgr.datKetNoiServerChoTest(connectGia(["tra_cuu"]) as never);
    const s = store.taoServer({ ten: "svr", url: "https://x/mcp" });
    await mgr.ketNoiLaiServer(s.id);
    binding.datServerChoAgent("a1", [s.id]);
    assert.deepEqual(
      mgr.mcpToolDefinitions("a1").map((d) => d.key),
      ["mcp__svr__tra_cuu"],
    );
    assert.deepEqual(mgr.mcpToolDefinitions("a2"), []);
    assert.equal(store.danhSachServer().find((x) => x.id === s.id)?.trangThai, "da_ket_noi");
  });

  it("drift so mốc -> can_duyet_lai, KHÔNG nạp tool", async () => {
    mgr.datKetNoiServerChoTest(connectGia(["tra_cuu"]) as never);
    const s = store.taoServer({ ten: "svr", url: "https://x/mcp" });
    await mgr.ketNoiLaiServer(s.id); // lần đầu: lưu mốc + nạp
    binding.datServerChoAgent("a1", [s.id]);
    mgr.datKetNoiServerChoTest(connectGia(["tra_cuu", "ghi_file"]) as never); // server đổi
    await mgr.ketNoiLaiServer(s.id);
    assert.equal(store.danhSachServer().find((x) => x.id === s.id)?.trangThai, "can_duyet_lai");
    assert.deepEqual(mgr.mcpToolDefinitions("a1"), []); // không nạp khi drift
  });

  it("một server hỏng không chặn server khác", async () => {
    const s1 = store.taoServer({ ten: "ok", url: "https://ok/mcp" });
    const s2 = store.taoServer({ ten: "hong", url: "https://hong/mcp" });
    binding.datServerChoAgent("a1", [s1.id, s2.id]);
    mgr.datKetNoiServerChoTest(
      (async (cfg: { url: string }) => (cfg.url.includes("hong") ? Promise.reject(new Error("chết")) : connectGia(["t"])())) as never,
    );
    await mgr.ketNoiLaiServer(s1.id);
    await mgr.ketNoiLaiServer(s2.id);
    assert.equal(mgr.mcpToolDefinitions("a1").length, 1); // chỉ s1 nạp
    assert.equal(store.danhSachServer().find((x) => x.id === s2.id)?.trangThai, "loi");
  });

  it("duyetLaiDrift đặt mốc mới + da_ket_noi", async () => {
    mgr.datKetNoiServerChoTest(connectGia(["tra_cuu"]) as never);
    const s = store.taoServer({ ten: "svr", url: "https://x/mcp" });
    await mgr.ketNoiLaiServer(s.id);
    mgr.datKetNoiServerChoTest(connectGia(["tra_cuu", "ghi_file"]) as never);
    await mgr.ketNoiLaiServer(s.id); // -> can_duyet_lai
    await mgr.duyetLaiDrift(s.id); // duyệt bộ mới
    binding.datServerChoAgent("a1", [s.id]);
    assert.equal(store.danhSachServer().find((x) => x.id === s.id)?.trangThai, "da_ket_noi");
    assert.equal(mgr.mcpToolDefinitions("a1").length, 2);
  });

  it("tools() treo quá timeout -> đóng handle, đặt loi, KHÔNG nạp, không treo test", async () => {
    // MCP_CONNECT_TIMEOUT_MS min hợp lệ là 1000 (schema `tuning-definitions.ts`)
    // - đủ nhanh cho 1 ca test, và là số THẤP NHẤT `getTuning` còn chấp nhận
    // (thấp hơn bị kẹp về mặc định 15000, làm ca này treo cả file test).
    tuning.setTuning("MCP_CONNECT_TIMEOUT_MS", 1000);
    let daDong = false;
    try {
      mgr.datKetNoiServerChoTest(
        (async () => ({ tools: () => new Promise<never>(() => {}), close: async () => void (daDong = true) })) as never,
      );
      const s = store.taoServer({ ten: "treo", url: "https://treo/mcp" });
      await mgr.ketNoiLaiServer(s.id);
      assert.equal(store.danhSachServer().find((x) => x.id === s.id)?.trangThai, "loi");
      assert.equal(mgr.trangThaiCacServer().find((x) => x.serverId === s.id)?.soTool, 0);
      assert.equal(daDong, true, "handle rò rỉ - tools() timeout phải đóng client trước khi báo loi");
    } finally {
      tuning.setTuning("MCP_CONNECT_TIMEOUT_MS", null);
    }
  });

  it("startMcpManager() với MCP_ENABLED=false -> noop, không nối server nào", () => {
    tuning.setTuning("MCP_ENABLED", false);
    try {
      const s = store.taoServer({ ten: "khong-duoc-noi", url: "https://x/mcp" });
      const stop = mgr.startMcpManager();
      assert.equal(typeof stop, "function");
      assert.doesNotThrow(() => stop());
      assert.equal(store.danhSachServer().find((x) => x.id === s.id)?.trangThai, "cho_ket_noi");
    } finally {
      tuning.setTuning("MCP_ENABLED", null);
    }
  });

  it("startMcpManager() (bật) trả hàm stop gọi được", () => {
    const stop = mgr.startMcpManager();
    assert.equal(typeof stop, "function");
    assert.doesNotThrow(() => stop());
  });
});
