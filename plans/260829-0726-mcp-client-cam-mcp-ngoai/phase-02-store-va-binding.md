# Phase 02: Store server + gán per-agent

**Plan:** [plan.md](plan.md) | **Spec:** [reports/thiet-ke-va-interface.md](reports/thiet-ke-va-interface.md)
**Deliverable:** CRUD server MCP (header mã hóa AES-256-GCM) + gán/dọn server theo agent (default-deny) + dọn khi xóa agent.
**Phụ thuộc:** Phase 01 (bảng + type).

## Bối cảnh

- Store soi `src/knowledge/kb-source-store.ts`: `import { db } from "../conversation/database.js"`, `import { trongGiaoDich } from "../shared/db-transaction.js"` (callback ĐỒNG BỘ), prepared statement là const module-level, id `randomBytes(8).toString("hex")`, `mapRow` chuyển snake_case -> camelCase.
- Mã hóa: `import { encryptSecret, decryptSecret } from "../config/secret-cipher.js"`. Giải mã hỏng -> rơi về `{}` (như `getBraveApiKey` rơi về env), không chết.
- Binding SAO Y `src/knowledge/kb-agent-binding.ts` - bất biến "trống = đóng" (default-deny) nằm ở đó.
- Dọn khi xóa agent: `src/config/agent-store.ts:172`, trong `trongGiaoDich` của `deleteAgent`, cạnh `xoaGanNguonCuaAgent(id)`.

## Task A: `mcp-server-store.ts` (CRUD + mã hóa header)

**Files:**
- Create: `src/mcp/mcp-server-store.ts`
- Test: `src/mcp/mcp-server-store.test.ts`

**Interfaces:**
- Consumes: `db`, `trongGiaoDich`, `encryptSecret`/`decryptSecret`, type từ `mcp-types.ts`.
- Produces: `taoServer`, `layServerNoiBo`, `danhSachServer`, `capNhatServer`, `xoaHeaders`, `xoaServer`, `datTrangThaiServer`, `luuSnapshotFingerprint`, `layFingerprint` (chữ ký ở spec muc 3).

- [ ] **Step 1: Viết test đỏ** (`mcp-server-store.test.ts`)

```ts
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
after(() => { database.closeDatabase(); cleanupTestEnv(dataDir); });
beforeEach(() => { for (const t of ["mcp_servers", "agent_mcp_servers"]) database.db.exec(`DELETE FROM ${t}`); });

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
```

- [ ] **Step 2: Chạy thấy đỏ** — Run: `npx tsx --test src/mcp/mcp-server-store.test.ts` — Expected: FAIL ("Cannot find module ./mcp-server-store.js").

- [ ] **Step 3: Viết `mcp-server-store.ts`**

```ts
// src/mcp/mcp-server-store.ts
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "../config/secret-cipher.js";
import { db } from "../conversation/database.js";
import { trongGiaoDich } from "../shared/db-transaction.js";
import type { McpServer, McpServerNoiBo, McpToolInfo, TrangThaiServer } from "./mcp-types.js";

type Row = {
  id: string; ten: string; url: string; headers_ma_hoa: string; enabled: number;
  trang_thai: TrangThaiServer; loi: string; tools_snapshot: string; fingerprint: string;
  created_at: string; updated_at: string;
};

function giaiMaHeaders(maHoa: string): Record<string, string> {
  if (!maHoa) return {};
  try { return JSON.parse(decryptSecret(maHoa)) as Record<string, string>; } catch { return {}; }
}
function docSnapshot(json: string): McpToolInfo[] {
  if (!json) return [];
  try { return JSON.parse(json) as McpToolInfo[]; } catch { return []; }
}
function mapRow(r: Row): McpServer {
  return {
    id: r.id, ten: r.ten, url: r.url, enabled: r.enabled === 1,
    trangThai: r.trang_thai, loi: r.loi, toolsSnapshot: docSnapshot(r.tools_snapshot),
    hasHeaders: r.headers_ma_hoa !== "", createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

const insertStmt = db.prepare(
  `INSERT INTO mcp_servers (id, ten, url, headers_ma_hoa, enabled) VALUES (?, ?, ?, ?, ?)`,
);
const getStmt = db.prepare(`SELECT * FROM mcp_servers WHERE id = ?`);
const listStmt = db.prepare(`SELECT * FROM mcp_servers ORDER BY created_at`);
const setHeadersStmt = db.prepare(`UPDATE mcp_servers SET headers_ma_hoa = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`);
const setTrangThaiStmt = db.prepare(`UPDATE mcp_servers SET trang_thai = ?, loi = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`);
const setSnapshotStmt = db.prepare(`UPDATE mcp_servers SET tools_snapshot = ?, fingerprint = ? WHERE id = ?`);
const getFpStmt = db.prepare(`SELECT fingerprint FROM mcp_servers WHERE id = ?`);
const xoaGanServerStmt = db.prepare(`DELETE FROM agent_mcp_servers WHERE server_id = ?`);
const xoaServerStmt = db.prepare(`DELETE FROM mcp_servers WHERE id = ?`);

export function taoServer(p: { ten: string; url: string; headers?: Record<string, string>; enabled?: boolean }): McpServer {
  const id = randomBytes(8).toString("hex");
  const maHoa = p.headers && Object.keys(p.headers).length ? encryptSecret(JSON.stringify(p.headers)) : "";
  insertStmt.run(id, p.ten, p.url, maHoa, p.enabled === false ? 0 : 1);
  return mapRow(getStmt.get(id) as Row);
}
export function layServerNoiBo(id: string): McpServerNoiBo | null {
  const r = getStmt.get(id) as Row | undefined;
  return r ? { ...mapRow(r), headers: giaiMaHeaders(r.headers_ma_hoa) } : null;
}
export function danhSachServer(): McpServer[] {
  return (listStmt.all() as Row[]).map(mapRow);
}
export function capNhatServer(
  id: string,
  patch: { ten?: string; url?: string; headers?: Record<string, string>; enabled?: boolean },
): void {
  const dat: string[] = []; const val: unknown[] = [];
  if (patch.ten !== undefined) { dat.push("ten = ?"); val.push(patch.ten); }
  if (patch.url !== undefined) { dat.push("url = ?"); val.push(patch.url); }
  if (patch.enabled !== undefined) { dat.push("enabled = ?"); val.push(patch.enabled ? 1 : 0); }
  if (patch.headers !== undefined) {
    dat.push("headers_ma_hoa = ?");
    val.push(Object.keys(patch.headers).length ? encryptSecret(JSON.stringify(patch.headers)) : "");
  }
  if (!dat.length) return;
  dat.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  db.prepare(`UPDATE mcp_servers SET ${dat.join(", ")} WHERE id = ?`).run(...(val as never[]), id);
}
export function xoaHeaders(id: string): void { setHeadersStmt.run("", id); }
export function xoaServer(id: string): void {
  trongGiaoDich(db, () => { xoaGanServerStmt.run(id); xoaServerStmt.run(id); });
}
export function datTrangThaiServer(id: string, trangThai: TrangThaiServer, loi = ""): void {
  setTrangThaiStmt.run(trangThai, loi, id);
}
export function luuSnapshotFingerprint(id: string, snapshot: McpToolInfo[], fingerprintJson: string): void {
  setSnapshotStmt.run(JSON.stringify(snapshot), fingerprintJson, id);
}
export function layFingerprint(id: string): string {
  return (getFpStmt.get(id) as { fingerprint: string } | undefined)?.fingerprint ?? "";
}
```

- [ ] **Step 4: Chạy thấy xanh** — Run: `npx tsx --test src/mcp/mcp-server-store.test.ts` — Expected: PASS (6 ca).

- [ ] **Step 5: Phá-kiểm mã hóa** — trong `taoServer` đổi `encryptSecret(JSON.stringify(p.headers))` thành `JSON.stringify(p.headers)` -> ca "KHÔNG plaintext" ĐỎ. Khôi phục.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/mcp-server-store.ts src/mcp/mcp-server-store.test.ts
git commit -m "feat(mcp): store server MCP voi header ma hoa"
```

## Task B: `mcp-agent-binding.ts` (gán per-agent, default-deny)

**Files:**
- Create: `src/mcp/mcp-agent-binding.ts`
- Test: `src/mcp/mcp-agent-binding.test.ts`

**Interfaces:**
- Produces: `serversCuaAgent`, `agentCuaServer`, `datServerChoAgent`, `datAgentChoServer`, `demAgentTheoServer`, `xoaGanServerCuaAgent`.

- [ ] **Step 1: Viết test đỏ**

```ts
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
after(() => { database.closeDatabase(); cleanupTestEnv(dataDir); });
beforeEach(() => database.db.exec("DELETE FROM agent_mcp_servers"));

describe("mcp-agent-binding", () => {
  it("agent chưa gán -> RỖNG (default-deny)", () => {
    assert.deepEqual(bind.serversCuaAgent("ag1"), []);
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
```

- [ ] **Step 2: Chạy thấy đỏ** — Run: `npx tsx --test src/mcp/mcp-agent-binding.test.ts` — Expected: FAIL (module chưa có).

- [ ] **Step 3: Viết `mcp-agent-binding.ts`** (SAO Y `kb-agent-binding.ts`, đổi bảng/tên)

```ts
// src/mcp/mcp-agent-binding.ts
// Gán server MCP cho từng agent. Agent CHƯA gán server nào -> RỖNG (mặc định ĐÓNG).
// Đảo ngược điều này là để một agent mới vô tình dùng được server của agent khác.
import { db } from "../conversation/database.js";
import { trongGiaoDich } from "../shared/db-transaction.js";

const layStmt = db.prepare(`SELECT server_id FROM agent_mcp_servers WHERE agent_id = ? ORDER BY server_id`);
const layTheoServerStmt = db.prepare(`SELECT agent_id FROM agent_mcp_servers WHERE server_id = ? ORDER BY agent_id`);
const xoaCuaAgentStmt = db.prepare(`DELETE FROM agent_mcp_servers WHERE agent_id = ?`);
const xoaCuaServerStmt = db.prepare(`DELETE FROM agent_mcp_servers WHERE server_id = ?`);
const chenStmt = db.prepare(`INSERT INTO agent_mcp_servers (agent_id, server_id) VALUES (?, ?)`);
const demStmt = db.prepare(`SELECT server_id, COUNT(*) AS so FROM agent_mcp_servers GROUP BY server_id`);

export function serversCuaAgent(agentId: string): string[] {
  return (layStmt.all(agentId) as { server_id: string }[]).map((r) => r.server_id);
}
export function agentCuaServer(serverId: string): string[] {
  return (layTheoServerStmt.all(serverId) as { agent_id: string }[]).map((r) => r.agent_id);
}
export function datServerChoAgent(agentId: string, serverIds: string[]): void {
  const uniq = [...new Set(serverIds)];
  trongGiaoDich(db, () => { xoaCuaAgentStmt.run(agentId); for (const s of uniq) chenStmt.run(agentId, s); });
}
export function datAgentChoServer(serverId: string, agentIds: string[]): void {
  const uniq = [...new Set(agentIds)];
  trongGiaoDich(db, () => { xoaCuaServerStmt.run(serverId); for (const a of uniq) chenStmt.run(a, serverId); });
}
export function demAgentTheoServer(): Map<string, number> {
  return new Map((demStmt.all() as { server_id: string; so: number }[]).map((r) => [r.server_id, r.so]));
}
export function xoaGanServerCuaAgent(agentId: string): void { xoaCuaAgentStmt.run(agentId); }
```

- [ ] **Step 4: Chạy thấy xanh** — Run: `npx tsx --test src/mcp/mcp-agent-binding.test.ts` — Expected: PASS.

- [ ] **Step 5: Phá-kiểm default-deny** — trong `serversCuaAgent`, thử `if (rỗng) return danhSáchTấtCả` -> ca "chưa gán RỖNG" ĐỎ. Khôi phục.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/mcp-agent-binding.ts src/mcp/mcp-agent-binding.test.ts
git commit -m "feat(mcp): gan server cho agent (default-deny)"
```

## Task C: Dọn gán khi xóa agent

**Files:**
- Modify: `src/config/agent-store.ts:172` (trong `deleteAgent`'s `trongGiaoDich`)
- Test: `src/mcp/mcp-agent-binding-cleanup.test.ts`

**Interfaces:**
- Consumes: `xoaGanServerCuaAgent` (Task B), `deleteAgent`/`createAgent` (agent-store).

- [ ] **Step 1: Viết test đỏ** (dùng agent-store thật + binding thật)

```ts
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
after(() => { database.closeDatabase(); cleanupTestEnv(dataDir); });
beforeEach(() => database.db.exec("DELETE FROM agent_mcp_servers"));

describe("dọn gán MCP khi xóa agent", () => {
  it("deleteAgent xóa luôn agent_mcp_servers của nó", () => {
    const ag = agents.createAgent({ name: "Ban hang", persona: "x", icon: "🤖" });
    bind.datServerChoAgent(ag.id, ["s1"]);
    const kq = agents.deleteAgent(ag.id);
    assert.equal(kq.ok, true);
    assert.deepEqual(bind.serversCuaAgent(ag.id), []);
  });
});
```
(Chữ ký `createAgent` xem `agent-store.ts:103` - chỉnh field cho khớp lúc viết test.)

- [ ] **Step 2: Chạy thấy đỏ** — Run: `npx tsx --test src/mcp/mcp-agent-binding-cleanup.test.ts` — Expected: FAIL (dòng gán còn lại).

- [ ] **Step 3: Sửa `agent-store.ts`** — thêm import + gọi trong giao dịch của `deleteAgent`:

```ts
// đầu file, cạnh import xoaGanNguonCuaAgent
import { xoaGanServerCuaAgent } from "../mcp/mcp-agent-binding.js";
// trong deleteAgent, trong trongGiaoDich, cạnh xoaGanNguonCuaAgent(id):
    xoaGanServerCuaAgent(id);
```

- [ ] **Step 4: Chạy thấy xanh** — Run: `npx tsx --test src/mcp/mcp-agent-binding-cleanup.test.ts` — Expected: PASS.

- [ ] **Step 5: Phá-kiểm** — bỏ dòng `xoaGanServerCuaAgent(id)` -> test ĐỎ (dòng ma hồi sinh nếu tạo lại agent cùng id). Khôi phục.

- [ ] **Step 6: Commit**

```bash
git add src/config/agent-store.ts src/mcp/mcp-agent-binding-cleanup.test.ts
git commit -m "fix(mcp): don agent_mcp_servers khi xoa agent (chong hoi sinh)"
```

## Success Criteria

- [ ] 3 file test xanh; mỗi phá-kiểm làm đúng test ĐỎ.
- [ ] Header không bao giờ nằm plaintext trong DB; `danhSachServer` không lộ header.
- [ ] `serversCuaAgent` của agent chưa cấu hình luôn RỖNG.
- [ ] Xóa agent không để lại dòng gán mồ côi.
