# Phase 04: Kết nối server + manager

**Plan:** [plan.md](plan.md) | **Spec:** [reports/thiet-ke-va-interface.md](reports/thiet-ke-va-interface.md)
**Deliverable:** Nối được server HTTP (giả trong test), khám phá tool, dựng `ToolDefinition` qua Phase 03, kiểm drift, cache trong RAM; `mcpToolDefinitions(agentId)` trả tool của server ĐÃ NỐI + ĐÃ GÁN; boot nối mọi server enabled (1 hỏng không chặn cái khác), health tự nối lại.
**Phụ thuộc:** Phase 02 (`mcp-server-store`, `mcp-agent-binding`), Phase 03 (`taoToolDefinitionMcp`, `soDrift`, `chupFingerprint`), Phase 01 (config `MCP_*`).

## Bối cảnh

- `mcp-manager.ts` là NƠI DUY NHẤT giữ kết nối sống (Map trong RAM). `mcpToolDefinitions(agentId)` ĐỒNG BỘ (registry gọi mỗi lượt) - chỉ đọc Map + một truy vấn `serversCuaAgent` (sync).
- Chiều phụ thuộc (spec mục 4): `mcp-manager -> {mcp-client-connect, mcp-tool-definition, mcp-tool-drift, mcp-server-store, mcp-agent-binding}`. KHÔNG import `tool-registry` (tránh vòng - `tool-registry` import ngược `mcp-manager`).
- Seam test `datKetNoiServerChoTest(fn)` cho phép tiêm hàm nối giả - Phase 05 test dựa vào tên này, GIỮ ĐÚNG.
- `getTuning("MCP_CONNECT_TIMEOUT_MS"|"MCP_TOOL_TIMEOUT_MS"|"MCP_HEALTH_INTERVAL_MS"|"MCP_ENABLED")` (Phase 01).
- `createMCPClient` từ `@ai-sdk/mcp` trả client có `.tools(): Promise<Record<string,Tool>>` và `.close()`. KHÔNG dùng raw `@modelcontextprotocol/sdk`.

## Task 1: `mcp-client-connect.ts` - nối HTTP có timeout

**Files:** Create: `src/mcp/mcp-client-connect.ts`; Test: `src/mcp/mcp-client-connect.test.ts`

**Interfaces:**
- Consumes: `createMCPClient` (`@ai-sdk/mcp`), `type Tool` (`ai`).
- Produces: `type KetNoiMcp = { tools(): Promise<Record<string,Tool>>; close(): Promise<void> }`; `type LoiKetNoiMcp = Error & { loaiLoi: "ket_noi" }`; `type ConnectDeps`; `ketNoiServer(cfg, deps?): Promise<KetNoiMcp>` (chữ ký công khai theo spec 3; `deps` là seam test tùy chọn, mặc định thật).

- [ ] **Step 1: viết test đỏ**

```ts
// src/mcp/mcp-client-connect.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ketNoiServer, type ConnectDeps } from "./mcp-client-connect.js";

const depsGia = (impl: ConnectDeps["taoClient"]): ConnectDeps => ({ taoClient: impl });

describe("ketNoiServer", () => {
  it("nối ok trả handle có tools()/close()", async () => {
    const kn = await ketNoiServer(
      { url: "https://x/mcp", headers: {}, connectTimeoutMs: 1000 },
      depsGia(async () => ({ tools: async () => ({}), close: async () => {} })),
    );
    assert.equal(typeof kn.tools, "function");
    assert.equal(typeof kn.close, "function");
  });

  it("nối treo quá timeout -> ném LoiKetNoiMcp", async () => {
    await assert.rejects(
      ketNoiServer(
        { url: "https://x/mcp", headers: {}, connectTimeoutMs: 10 },
        depsGia(() => new Promise(() => {})), // không bao giờ resolve
      ),
      (e: unknown) => (e as { loaiLoi?: string }).loaiLoi === "ket_noi",
    );
  });
});
```

- [ ] **Step 2: chạy thấy đỏ**

Run: `npx tsx --test src/mcp/mcp-client-connect.test.ts`
Expected: FAIL - `Cannot find module './mcp-client-connect.js'`.

- [ ] **Step 3: code tối thiểu**

```ts
// src/mcp/mcp-client-connect.ts
import { createMCPClient } from "@ai-sdk/mcp";
import type { Tool } from "ai";

export type KetNoiMcp = { tools(): Promise<Record<string, Tool>>; close(): Promise<void> };
export type LoiKetNoiMcp = Error & { loaiLoi: "ket_noi" };

function loiKetNoi(msg: string): LoiKetNoiMcp {
  const e = new Error(msg) as LoiKetNoiMcp;
  e.loaiLoi = "ket_noi";
  return e;
}

export type ConnectDeps = {
  taoClient: (cfg: { url: string; headers: Record<string, string> }) => Promise<KetNoiMcp>;
};

const depThat: ConnectDeps = {
  taoClient: async ({ url, headers }) => {
    // redirect mặc định 'error' của @ai-sdk/mcp chặn SSRF-qua-redirect.
    const client = await createMCPClient({ transport: { type: "http", url, headers } });
    return { tools: () => client.tools(), close: () => client.close() };
  },
};

export async function ketNoiServer(
  cfg: { url: string; headers: Record<string, string>; connectTimeoutMs: number },
  deps: ConnectDeps = depThat,
): Promise<KetNoiMcp> {
  let hen: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      deps.taoClient({ url: cfg.url, headers: cfg.headers }).catch((e) => {
        throw loiKetNoi(`Không nối được ${cfg.url}: ${e instanceof Error ? e.message : String(e)}`);
      }),
      new Promise<never>((_, reject) => {
        hen = setTimeout(() => reject(loiKetNoi(`Nối ${cfg.url} quá ${cfg.connectTimeoutMs}ms`)), cfg.connectTimeoutMs);
      }),
    ]);
  } finally {
    if (hen) clearTimeout(hen);
  }
}
```

- [ ] **Step 4: chạy thấy xanh** Run: `npx tsx --test src/mcp/mcp-client-connect.test.ts` -> PASS

- [ ] **Step 5: commit**

```bash
git add src/mcp/mcp-client-connect.ts src/mcp/mcp-client-connect.test.ts
git commit -m "feat(mcp): noi server MCP qua HTTP co timeout"
```

## Task 2: `mcp-manager.ts` - giữ kết nối, cache tool, expose cho registry

**Files:** Create: `src/mcp/mcp-manager.ts`; Test: `src/mcp/mcp-manager.test.ts`

**Interfaces:**
- Consumes: `ketNoiServer`/`KetNoiMcp`, `taoToolDefinitionMcp`, `soDrift`/`chupFingerprint`, store (`danhSachServer`/`layServerNoiBo`/`datTrangThaiServer`/`layFingerprint`/`luuSnapshotFingerprint`), `serversCuaAgent`, `getTuning`.
- Produces: `mcpToolDefinitions(agentId): ToolDefinition[]`; `trangThaiCacServer()`; `ketNoiLaiServer(id): Promise<void>`; `ngatServer(id): Promise<void>`; `duyetLaiDrift(id): Promise<void>`; `startMcpManager(): () => void`; `datKetNoiServerChoTest(fn): void` (seam test).

- [ ] **Step 1: viết test đỏ**

```ts
// src/mcp/mcp-manager.test.ts
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

const connectGia = (tenTool: string[]) => async () => ({
  tools: async () => Object.fromEntries(tenTool.map((t) => [t, tool({ description: `mô tả ${t}`, inputSchema: z.object({}), execute: async () => "ok" })])),
  close: async () => {},
});

before(async () => {
  dataDir = setupTestEnv();
  database = await import("../conversation/database.js");
  store = await import("./mcp-server-store.js");
  binding = await import("./mcp-agent-binding.js");
  mgr = await import("./mcp-manager.js");
});
after(() => { database.closeDatabase(); cleanupTestEnv(dataDir); });
beforeEach(() => { for (const t of ["mcp_servers", "agent_mcp_servers"]) database.db.exec(`DELETE FROM ${t}`); });

describe("mcp-manager", () => {
  it("nối rồi mcpToolDefinitions chỉ cho agent được gán", async () => {
    mgr.datKetNoiServerChoTest(connectGia(["tra_cuu"]) as never);
    const s = store.taoServer({ ten: "svr", url: "https://x/mcp" });
    await mgr.ketNoiLaiServer(s.id);
    binding.datServerChoAgent("a1", [s.id]);
    assert.deepEqual(mgr.mcpToolDefinitions("a1").map((d) => d.key), ["mcp__svr__tra_cuu"]);
    assert.deepEqual(mgr.mcpToolDefinitions("a2"), []);
    assert.equal(store.danhSachServer().find((x) => x.id === s.id)?.trangThai, "da_ket_noi");
  });

  it("drift so mốc -> can_duyet_lai, KHÔNG nạp tool", async () => {
    mgr.datKetNoiServerChoTest(connectGia(["tra_cuu"]) as never);
    const s = store.taoServer({ ten: "svr", url: "https://x/mcp" });
    await mgr.ketNoiLaiServer(s.id);                 // lần đầu: lưu mốc + nạp
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
    mgr.datKetNoiServerChoTest((async (cfg: { url: string }) =>
      cfg.url.includes("hong") ? Promise.reject(new Error("chết")) : connectGia(["t"])()) as never);
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
    await mgr.ketNoiLaiServer(s.id);                 // -> can_duyet_lai
    await mgr.duyetLaiDrift(s.id);                   // duyệt bộ mới
    binding.datServerChoAgent("a1", [s.id]);
    assert.equal(store.danhSachServer().find((x) => x.id === s.id)?.trangThai, "da_ket_noi");
    assert.equal(mgr.mcpToolDefinitions("a1").length, 2);
  });
});
```

- [ ] **Step 2: chạy thấy đỏ** Run: `npx tsx --test src/mcp/mcp-manager.test.ts` -> FAIL (module chưa có).

- [ ] **Step 3: code tối thiểu** (giữ < 200 dòng; nếu chật tách `mcp-manager-connect.ts` cho `ketNoiLaiServer`)

```ts
// src/mcp/mcp-manager.ts
import type { ToolDefinition } from "../agent/tools/tool-catalog-types.js";
import { getTuning } from "../config/runtime-tuning-settings.js";
import { serversCuaAgent } from "./mcp-agent-binding.js";
import { ketNoiServer } from "./mcp-client-connect.js";
import {
  danhSachServer, datTrangThaiServer, layFingerprint, layServerNoiBo, luuSnapshotFingerprint,
} from "./mcp-server-store.js";
import { taoToolDefinitionMcp } from "./mcp-tool-definition.js";
import { chupFingerprint, soDrift } from "./mcp-tool-drift.js";
import type { KetNoiMcp } from "./mcp-client-connect.js";
import type { McpToolInfo, TrangThaiServer } from "./mcp-types.js";

type ServerDangNoi = { ketNoi: KetNoiMcp; defs: ToolDefinition[] };
const dangNoi = new Map<string, ServerDangNoi>();

let ketNoiFn: typeof ketNoiServer = ketNoiServer;
/** Seam test: tiêm hàm nối giả (Phase 05 test cũng dùng). */
export function datKetNoiServerChoTest(fn: typeof ketNoiServer): void { ketNoiFn = fn; }

export function mcpToolDefinitions(agentId: string): ToolDefinition[] {
  const daGan = new Set(serversCuaAgent(agentId));
  const ra: ToolDefinition[] = [];
  for (const [id, s] of dangNoi) if (daGan.has(id)) ra.push(...s.defs);
  return ra;
}

export function trangThaiCacServer(): { serverId: string; trangThai: TrangThaiServer; soTool: number; loi: string }[] {
  return danhSachServer().map((s) => ({
    serverId: s.id, trangThai: s.trangThai, soTool: dangNoi.get(s.id)?.defs.length ?? 0, loi: s.loi,
  }));
}

async function nap(id: string, luuMoc: boolean): Promise<void> {
  const cfg = layServerNoiBo(id);
  if (!cfg) return;
  const ketNoi = await ketNoiFn({
    url: cfg.url, headers: cfg.headers, connectTimeoutMs: getTuning("MCP_CONNECT_TIMEOUT_MS"),
  });
  const tools = await ketNoi.tools();
  const snapshot: McpToolInfo[] = Object.entries(tools).map(([ten, t]) => ({ ten, moTa: t.description ?? "" }));
  if (!luuMoc) {
    const kq = await soDrift(tools, layFingerprint(id));
    if (kq.drift) {
      await ketNoi.close();
      datTrangThaiServer(id, "can_duyet_lai", `Bộ tool đổi (thêm ${kq.them.length}, đổi ${kq.doi.length}, bỏ ${kq.bo.length})`);
      return;
    }
  }
  const defs = Object.entries(tools).map(([ten, aiTool]) =>
    taoToolDefinitionMcp({
      serverId: id, serverTen: cfg.ten, toolTen: ten, moTa: aiTool.description ?? "",
      aiTool, toolCallTimeoutMs: getTuning("MCP_TOOL_TIMEOUT_MS"),
      kiemGan: (agentId) => serversCuaAgent(agentId).includes(id), // cửa gán cho def (Phase 03 nhận tiêm)
    }),
  );
  if (luuMoc || layFingerprint(id) === "") luuSnapshotFingerprint(id, snapshot, await chupFingerprint(tools));
  dangNoi.set(id, { ketNoi, defs });
  datTrangThaiServer(id, "da_ket_noi");
}

export async function ketNoiLaiServer(id: string): Promise<void> {
  await ngatServer(id);
  try { await nap(id, false); } catch (e) { datTrangThaiServer(id, "loi", e instanceof Error ? e.message : String(e)); }
}

export async function ngatServer(id: string): Promise<void> {
  const s = dangNoi.get(id);
  if (!s) return;
  dangNoi.delete(id);
  try { await s.ketNoi.close(); } catch { /* đóng lỗi bỏ qua */ }
}

/** Duyệt lại: lấy bộ tool hiện tại LÀM MỐC mới rồi nạp (giờ không còn drift). */
export async function duyetLaiDrift(id: string): Promise<void> {
  await ngatServer(id);
  try { await nap(id, true); } catch (e) { datTrangThaiServer(id, "loi", e instanceof Error ? e.message : String(e)); }
}

export function startMcpManager(): () => void {
  if (!getTuning("MCP_ENABLED")) return () => {};
  for (const s of danhSachServer()) if (s.enabled) void ketNoiLaiServer(s.id);
  const timer = setInterval(() => {
    for (const s of danhSachServer()) if (s.enabled && s.trangThai === "loi") void ketNoiLaiServer(s.id);
  }, getTuning("MCP_HEALTH_INTERVAL_MS"));
  timer.unref();
  return () => { clearInterval(timer); for (const id of [...dangNoi.keys()]) void ngatServer(id); };
}
```

- [ ] **Step 4: chạy thấy xanh** Run: `npx tsx --test src/mcp/mcp-manager.test.ts` -> PASS (4/4)

- [ ] **Step 5: PHÁ-KIỂM**

1. Bỏ nhánh `if (kq.drift)` trong `nap` -> test "drift -> can_duyet_lai" PHẢI đỏ. Khôi phục.
2. Trong `mcpToolDefinitions`, bỏ điều kiện `if (daGan.has(id))` -> test "chỉ cho agent được gán" (agent a2 rỗng) PHẢI đỏ. Khôi phục.

- [ ] **Step 6: commit**

```bash
git add src/mcp/mcp-manager.ts src/mcp/mcp-manager.test.ts
git commit -m "feat(mcp): manager giu ket noi + cache tool + drift + health"
```

## Success Criteria

- [ ] `ketNoiServer` timeout ném `LoiKetNoiMcp`; nối ok trả handle.
- [ ] `ketNoiLaiServer` nạp def, đặt `da_ket_noi`, lưu mốc lần đầu.
- [ ] Drift so mốc -> `can_duyet_lai` + không nạp tool.
- [ ] `mcpToolDefinitions(agentId)` chỉ trả tool server ĐÃ NỐI + ĐÃ GÁN cho agent.
- [ ] Một server hỏng -> `loi`, không chặn server khác.
- [ ] `duyetLaiDrift` đặt mốc mới + `da_ket_noi` + nạp bộ mới.
- [ ] `startMcpManager` gate bằng `MCP_ENABLED`, health chỉ nối lại server `loi`, `timer.unref()`, trả stop fn đóng mọi client.
- [ ] `datKetNoiServerChoTest` giữ đúng tên (Phase 05 dựa vào).
