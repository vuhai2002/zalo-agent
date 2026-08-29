# Phase 06: Dashboard backend + lifecycle

**Plan:** [plan.md](plan.md) | **Spec:** [reports/thiet-ke-va-interface.md](reports/thiet-ke-va-interface.md)

**Deliverable:** `/api/mcp` quản server (CRUD, test kết nối, duyệt-lại drift) + gán agent + trạng thái; manager khởi động ở boot (server hỏng KHÔNG chặn boot) và dừng khi shutdown.

**Phụ thuộc:** Phase 02 (`mcp-server-store`, `mcp-agent-binding`), Phase 04 (`mcp-manager`).

## Bối cảnh

- Mẫu route DI: `friend-routes.ts` export CẢ factory `createFriendRoutes(deps)` (cho test tiêm giả) LẪN instance `friendRoutes` (wire thật). Validate Zod: `schema.safeParse(await c.req.json().catch(() => null))` rồi `return c.json({ error, issues }, 400)`.
- Store/binding là hàm module-level, import THẲNG (như `kb-routes` import store). Chỉ `manager` (có state runtime) mới TIÊM để test không phải nối mạng.
- Mount trong `dashboard-server.ts`: khối `app.route(...)` (`:161-176`); middleware auth `app.use("/api/*", ...)` (`:108-113`) chặn MỌI thứ mount SAU nó; catch-all `app.all("/api/*", ... 404)` (`:180`) phải nằm SAU route mới.
- `mcp-routes.ts` nhiều endpoint -> nguy cơ >200 dòng. Tách Zod ra `mcp-route-guards.ts` (như KB tách `kb-route-guards.ts`). Nếu vẫn vượt, tách nhóm gán ra `mcp-assignment-routes.ts`.

## Task 1: `mcp-route-guards.ts` + `mcp-routes.ts`

**Files:**
- Create: `src/server/routes/mcp-route-guards.ts` (Zod schemas)
- Create: `src/server/routes/mcp-routes.ts` (factory + instance)
- Test: `src/server/routes/mcp-routes.test.ts`

**Interfaces:**
- Consumes (store, import thẳng): `taoServer`, `danhSachServer`, `capNhatServer`, `xoaServer`, `xoaHeaders` (Phase 02); (binding) `serversCuaAgent`, `agentCuaServer`, `datServerChoAgent`, `datAgentChoServer`, `demAgentTheoServer` (Phase 02); (agent) `listAgents` (agent-store).
- Consumes (tiêm): `deps.manager: { ketNoiLaiServer(id): Promise<void>; ngatServer(id): Promise<void>; duyetLaiDrift(id): Promise<void>; trangThaiCacServer(): {serverId,trangThai,soTool,loi}[] }` (Phase 04).
- Produces: `export function createMcpRoutes(deps: McpRoutesDeps): Hono`; `export const mcpRoutes` (wire manager thật); `export type McpRoutesDeps`.

- [ ] **Step 1: Viết test đỏ**

```ts
// src/server/routes/mcp-routes.test.ts
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
  ketNoiLaiServer: async (id: string) => { managerGia.goi.push(`noi:${id}`); },
  ngatServer: async (id: string) => { managerGia.goi.push(`ngat:${id}`); },
  duyetLaiDrift: async (id: string) => { managerGia.goi.push(`duyet:${id}`); },
  trangThaiCacServer: () => [],
};

before(async () => {
  dataDir = setupTestEnv();
  database = await import("../../conversation/database.js");
  store = await import("../../mcp/mcp-server-store.js");
  binding = await import("../../mcp/mcp-agent-binding.js");
  routes = await import("./mcp-routes.js");
});
after(() => { database.closeDatabase(); cleanupTestEnv(dataDir); });
beforeEach(() => {
  for (const t of ["mcp_servers", "agent_mcp_servers"]) database.db.exec(`DELETE FROM ${t}`);
  managerGia.goi.length = 0;
});

describe("mcp-routes", () => {
  const app = () => routes.createMcpRoutes({ manager: managerGia });

  it("POST / tao server + goi ketNoiLaiServer", async () => {
    const res = await app().request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ten: "svr", url: "https://x/mcp" }),
    });
    assert.equal(res.status, 201);
    assert.equal(store.danhSachServer().length, 1);
    assert.ok(managerGia.goi.some((g) => g.startsWith("noi:")));
  });

  it("POST / url rong -> 400", async () => {
    const res = await app().request("/", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ten: "svr", url: "" }),
    });
    assert.equal(res.status, 400);
  });

  it("PUT /agents/:agentId/servers luu gan", async () => {
    const svr = store.taoServer({ ten: "svr", url: "https://x/mcp" });
    const res = await app().request("/agents/agent-a/servers", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ serverIds: [svr.id] }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(binding.serversCuaAgent("agent-a"), [svr.id]);
  });

  it("DELETE /:id ngat roi xoa", async () => {
    const svr = store.taoServer({ ten: "svr", url: "https://x/mcp" });
    const res = await app().request(`/${svr.id}`, { method: "DELETE" });
    assert.equal(res.status, 200);
    assert.equal(store.danhSachServer().length, 0);
    assert.ok(managerGia.goi.includes(`ngat:${svr.id}`));
  });
});
```

- [ ] **Step 2: Chạy test thấy đỏ**

Run: `npx tsx --test src/server/routes/mcp-routes.test.ts`
Expected: FAIL - `./mcp-routes.js` chưa tồn tại (Cannot find module).

- [ ] **Step 3: Viết `mcp-route-guards.ts`**

```ts
// src/server/routes/mcp-route-guards.ts
import { z } from "zod";

export const taoServerSchema = z.object({
  ten: z.string().min(1),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
});
export const suaServerSchema = z.object({
  ten: z.string().min(1).optional(),
  url: z.string().url().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
});
export const ganServerSchema = z.object({ serverIds: z.array(z.string()) });
export const ganAgentSchema = z.object({ agentIds: z.array(z.string()) });
```

- [ ] **Step 4: Viết `mcp-routes.ts`**

```ts
// src/server/routes/mcp-routes.ts
import { Hono } from "hono";
import { listAgents } from "../../config/agent-store.js";
import {
  agentCuaServer, datAgentChoServer, datServerChoAgent, demAgentTheoServer, serversCuaAgent,
} from "../../mcp/mcp-agent-binding.js";
import {
  capNhatServer, danhSachServer, taoServer, xoaHeaders, xoaServer,
} from "../../mcp/mcp-server-store.js";
import { ketNoiLaiServer, ngatServer, duyetLaiDrift, trangThaiCacServer } from "../../mcp/mcp-manager.js";
import { ganAgentSchema, ganServerSchema, suaServerSchema, taoServerSchema } from "./mcp-route-guards.js";

export type McpRoutesDeps = {
  manager: {
    ketNoiLaiServer: (id: string) => Promise<void>;
    ngatServer: (id: string) => Promise<void>;
    duyetLaiDrift: (id: string) => Promise<void>;
    trangThaiCacServer: () => { serverId: string; trangThai: string; soTool: number; loi: string }[];
  };
};

export function createMcpRoutes(deps: McpRoutesDeps) {
  return new Hono()
    .get("/", (c) => {
      const dem = demAgentTheoServer();
      const tt = new Map(deps.manager.trangThaiCacServer().map((x) => [x.serverId, x]));
      const servers = danhSachServer().map((s) => ({
        ...s, soAgentGan: dem.get(s.id) ?? 0, runtime: tt.get(s.id) ?? null,
      }));
      return c.json({ servers });
    })
    .post("/", async (c) => {
      const p = taoServerSchema.safeParse(await c.req.json().catch(() => null));
      if (!p.success) return c.json({ error: "Dữ liệu không hợp lệ", issues: p.error.issues }, 400);
      const svr = taoServer(p.data);
      void deps.manager.ketNoiLaiServer(svr.id);          // nối nền, không chặn response
      return c.json({ server: svr }, 201);
    })
    .patch("/:id", async (c) => {
      const p = suaServerSchema.safeParse(await c.req.json().catch(() => null));
      if (!p.success) return c.json({ error: "Dữ liệu không hợp lệ", issues: p.error.issues }, 400);
      capNhatServer(c.req.param("id"), p.data);
      void deps.manager.ketNoiLaiServer(c.req.param("id"));
      return c.json({ ok: true });
    })
    .delete("/:id", async (c) => {
      await deps.manager.ngatServer(c.req.param("id"));
      xoaServer(c.req.param("id"));
      return c.json({ ok: true });
    })
    .delete("/:id/headers", (c) => { xoaHeaders(c.req.param("id")); return c.json({ ok: true }); })
    .post("/:id/duyet-lai", async (c) => { await deps.manager.duyetLaiDrift(c.req.param("id")); return c.json({ ok: true }); })
    .get("/agents", (c) => c.json({ agents: listAgents().map((a) => ({ id: a.id, name: a.name, icon: a.icon })) }))
    .get("/:id/agents", (c) => c.json({ agentIds: agentCuaServer(c.req.param("id")) }))
    .put("/:id/agents", async (c) => {
      const p = ganAgentSchema.safeParse(await c.req.json().catch(() => null));
      if (!p.success) return c.json({ error: "Dữ liệu không hợp lệ", issues: p.error.issues }, 400);
      datAgentChoServer(c.req.param("id"), p.data.agentIds);
      return c.json({ ok: true });
    })
    .get("/agents/:agentId/servers", (c) => c.json({ serverIds: serversCuaAgent(c.req.param("agentId")) }))
    .put("/agents/:agentId/servers", async (c) => {
      const p = ganServerSchema.safeParse(await c.req.json().catch(() => null));
      if (!p.success) return c.json({ error: "Dữ liệu không hợp lệ", issues: p.error.issues }, 400);
      datServerChoAgent(c.req.param("agentId"), p.data.serverIds);
      return c.json({ ok: true });
    });
}

export const mcpRoutes = createMcpRoutes({
  manager: { ketNoiLaiServer, ngatServer, duyetLaiDrift, trangThaiCacServer },
});
```

Ghi chú: endpoint `POST /:id/test` (thử nối trả ok/loi) tách thành Task phụ nếu file chạm 200 dòng; V1 có thể dùng `POST /:id/duyet-lai` + badge trạng thái là đủ. Nếu thêm, dùng `deps.manager` một hàm `thuNoi(id)`.

- [ ] **Step 5: Chạy test thấy xanh**

Run: `npx tsx --test src/server/routes/mcp-routes.test.ts`
Expected: PASS - 4 test.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/mcp-route-guards.ts src/server/routes/mcp-routes.ts src/server/routes/mcp-routes.test.ts
git commit -m "feat(mcp): route dashboard quản MCP server + gán agent"
```

## Task 2: Mount `/api/mcp` vào dashboard

**Files:**
- Modify: `src/server/dashboard-server.ts` (import ~dòng 32 + `app.route` sau dòng 176)
- Test: `src/server/dashboard-server-mcp-mount.test.ts`

- [ ] **Step 1: Viết test đỏ** - `/api/mcp` phải bị auth chặn (401), KHÔNG rơi vào catch-all (404)

```ts
// src/server/dashboard-server-mcp-mount.test.ts
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
after(() => { database.closeDatabase(); cleanupTestEnv(dataDir); });

describe("mount /api/mcp", () => {
  it("khong session -> 401 (da mount sau auth), khong phai 404", async () => {
    const app = mod.buildDashboardApp();
    const res = await app.request("/api/mcp", { headers: { host: "127.0.0.1" } });
    assert.equal(res.status, 401);
  });
});
```

- [ ] **Step 2: Chạy thấy đỏ**

Run: `npx tsx --test src/server/dashboard-server-mcp-mount.test.ts`
Expected: FAIL - trả 404 (chưa mount, rơi catch-all).

- [ ] **Step 3: Sửa `dashboard-server.ts`**

Thêm import cạnh các route khác (~dòng 32):
```ts
import { mcpRoutes } from "./routes/mcp-routes.js";
```
Thêm mount trong `buildDashboardApp()` sau dòng 176 (sau `app.route("/api/kb", kbRoutes);`, TRƯỚC catch-all dòng 180):
```ts
  app.route("/api/mcp", mcpRoutes);
```

- [ ] **Step 4: Chạy thấy xanh**

Run: `npx tsx --test src/server/dashboard-server-mcp-mount.test.ts`
Expected: PASS - 401 (bị middleware auth chặn = đã mount đúng phía sau auth).

- [ ] **Step 5: Commit**

```bash
git add src/server/dashboard-server.ts src/server/dashboard-server-mcp-mount.test.ts
git commit -m "feat(mcp): mount /api/mcp sau middleware auth dashboard"
```

## Task 3: Lifecycle manager ở boot + shutdown

**Files:**
- Modify: `src/index.ts` (noop idiom ~dòng 39, start sau dòng 84, stop trong `shutdown()` :34-52)

**Interfaces:**
- Consumes: `startMcpManager(): () => void` (Phase 04).

- [ ] **Step 1: Sửa `index.ts`**

Thêm import: `import { startMcpManager } from "./mcp/mcp-manager.js";`
Thêm biến noop cạnh dòng 39: `let stopMcpManager: () => void = () => {};`
Đặt start NGAY SAU `startDashboardServer();` (dòng 84 - management plane, để server MCP hỏng không chặn boot):
```ts
  startDashboardServer();
  stopMcpManager = startMcpManager();   // management plane: nối server ngoài, server hỏng không chặn boot
```
Thêm stop trong `shutdown()` (trước `stopDashboardServer()` để nhất quán quản-lý-tắt-sau-dữ-liệu KHÔNG áp ở đây - manager là quản lý, đặt cạnh dashboard):
```ts
  stopScheduler();
  stopFriendSweep();
  stopKbIngestWorker();
  stopMcpManager();
  stopDashboardServer();
```

- [ ] **Step 2: Verification**

Run: `pnpm typecheck`
Expected: sạch. Kiểm mắt: `startMcpManager()` đứng ngay sau `startDashboardServer()`; `stopMcpManager()` có trong `shutdown()`. (Idempotency của `startMcpManager` đã được test ở Phase 04.)

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(mcp): khởi động/tắt MCP manager theo vòng đời process"
```

## Success Criteria

- [ ] `POST /api/mcp` tạo server + kích hoạt nối nền; `url` rỗng/sai -> 400.
- [ ] `PUT /api/mcp/agents/:agentId/servers` lưu gán; `DELETE /:id` ngắt rồi xóa (kèm dọn `agent_mcp_servers` từ `xoaServer`).
- [ ] `GET /api/mcp` không session -> 401 (mount sau auth), không 404.
- [ ] `startMcpManager()` chạy sau `startDashboardServer()`; `stopMcpManager()` trong `shutdown()`.
- [ ] `mcp-routes.ts` < 200 dòng (Zod đã tách sang `mcp-route-guards.ts`; nếu vẫn vượt, tách nhóm gán sang `mcp-assignment-routes.ts`).
- [ ] `pnpm typecheck` sạch.

## Rủi ro

- Thứ tự mount: phải dưới `app.use("/api/*")` auth (dòng 113) và trên catch-all (dòng 180). Sai chỗ = lộ API không auth hoặc bị 404 nuốt.
- `void deps.manager.ketNoiLaiServer(...)` chạy nền: nếu ném thì phải nuốt trong manager (đã bọc), route KHÔNG await để không treo response chờ nối mạng.
