# Phase 01: Phụ thuộc + config + lược đồ DB

**Plan:** [plan.md](plan.md) | **Spec:** [reports/thiet-ke-va-interface.md](reports/thiet-ke-va-interface.md)
**Deliverable:** `@ai-sdk/mcp` cài xong + `pnpm typecheck` sạch; 4 config `MCP_*` (env + tuning); hai bảng `mcp_servers` + `agent_mcp_servers` tạo được khi mở DB.
**Phụ thuộc:** không (phase mở đầu).

## Bối cảnh

- Client MCP đã TÁCH khỏi `ai` sang gói riêng `@ai-sdk/mcp` (`createMCPClient`, transport HTTP native). `ai@7.0.37` hiện chỉ còn `fingerprintTools`/`detectToolDrift`.
- Bẫy lệch version (spec muc 8): `@ai-sdk/mcp` mới kéo `@ai-sdk/provider-utils` mới hơn bản `ai` đang ghim; kiểu `Tool` đi qua `provider-utils` nên lệch sẽ vỡ typecheck. Cài `@ai-sdk/mcp` VÀ nâng `ai` cùng lượt để pnpm gom một `provider-utils`.
- Lược đồ soi `src/knowledge/kb-schema.ts`: `taoBang...(db)` export, gọi trong `database.ts runMigrations()`. Không FK - dọn tay.
- Config: env mới phải có `.default()` trong `env.ts`; tham số chỉnh nóng thêm vào `tuning-definitions.ts` (mỗi key tuning PHẢI trùng tên một env - kiểm lúc biên dịch).

## Task 1: Thêm phụ thuộc `@ai-sdk/mcp` + nâng `ai`

**Files:**
- Modify: `package.json` (dependencies), `pnpm-lock.yaml`

**Interfaces:**
- Produces: gói `@ai-sdk/mcp` khả dụng (`createMCPClient`, `Experimental_StdioMCPTransport` - ta chỉ dùng HTTP), và `fingerprintTools`/`detectToolDrift` từ `ai` (đã có).

- [ ] **Step 1: Cài + nâng cùng lượt**

```bash
pnpm add @ai-sdk/mcp ai@latest
```
Lưu ý: pnpm có `minimumReleaseAge: 1440` (24h) - nếu bản mới nhất bị chặn tạm, lấy bản ổn định cũ hơn 24h. `@ai-sdk/mcp` KHÔNG kéo `@modelcontextprotocol/sdk` (tự có transport) - đúng, ta không cần raw SDK.

- [ ] **Step 2: Cổng nghiệm thu = typecheck sạch**

Run: `pnpm typecheck`
Expected: PASS (không lỗi `Tool`/`ToolSet` do lệch `provider-utils`). Nếu đỏ vì lệch version: chạy lại `pnpm add ai@latest @ai-sdk/mcp@latest` để hai gói cùng một `provider-utils`, rồi `pnpm typecheck` lại.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build(mcp): them @ai-sdk/mcp va nang ai cho client MCP"
```

## Task 2: Type dùng chung `mcp-types.ts`

**Files:**
- Create: `src/mcp/mcp-types.ts`

**Interfaces:**
- Produces: `TrangThaiServer`, `McpToolInfo`, `McpServer`, `McpServerNoiBo`, `McpServerView` (spec muc 3).

- [ ] **Step 1: Viết file type** (chép nguyên khối type ở spec muc 3)

```ts
// src/mcp/mcp-types.ts
export type TrangThaiServer = "cho_ket_noi" | "da_ket_noi" | "loi" | "can_duyet_lai";
export type McpToolInfo = { ten: string; moTa: string };

export type McpServer = {
  id: string; ten: string; url: string; enabled: boolean;
  trangThai: TrangThaiServer; loi: string; toolsSnapshot: McpToolInfo[];
  hasHeaders: boolean; createdAt: string; updatedAt: string;   // hasHeaders = có header hay không (KHÔNG lộ giá trị) - UI dùng để hiện nút xóa header
};
export type McpServerNoiBo = McpServer & { headers: Record<string, string> };
export type McpServerView = {
  id: string; ten: string; url: string; enabled: boolean;
  trangThai: TrangThaiServer; loi: string; toolsSnapshot: McpToolInfo[];
  hasHeaders: boolean; soAgentGan: number;
};
```

- [ ] **Step 2: Verify** — Run: `pnpm typecheck` — Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/mcp/mcp-types.ts
git commit -m "feat(mcp): khai type dung chung cho server MCP"
```

## Task 3: Config `MCP_*` (env + tuning)

**Files:**
- Modify: `src/config/env.ts` (Zod schema), `src/config/tuning-definitions.ts` (`TUNING_BY_KEY`)

**Interfaces:**
- Produces: `env.MCP_ENABLED`, `env.MCP_CONNECT_TIMEOUT_MS`, `env.MCP_TOOL_TIMEOUT_MS`, `env.MCP_HEALTH_INTERVAL_MS`; đọc lúc chạy qua `getTuning("MCP_TOOL_TIMEOUT_MS")` v.v.

- [ ] **Step 1: Thêm field Zod trong `env.ts`** (kèm `.default()`, đúng nếp các field khác)

```ts
  MCP_ENABLED: z.coerce.boolean().default(true),
  MCP_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  MCP_TOOL_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  MCP_HEALTH_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
```

- [ ] **Step 2: Thêm dòng tương ứng vào `TUNING_BY_KEY` trong `tuning-definitions.ts`** (nhóm mới "MCP")

```ts
  MCP_ENABLED: { group: "MCP", kind: "boolean", label: "Bật MCP client", hint: "Cho agent dùng tool từ MCP server ngoai" },
  MCP_CONNECT_TIMEOUT_MS: { group: "MCP", kind: "number", label: "Tran thoi gian noi (ms)", hint: "Tran khi noi toi 1 server" },
  MCP_TOOL_TIMEOUT_MS: { group: "MCP", kind: "number", label: "Tran goi tool (ms)", hint: "Tran 1 lan goi tool ngoai" },
  MCP_HEALTH_INTERVAL_MS: { group: "MCP", kind: "number", label: "Chu ky health (ms)", hint: "Chu ky kiem/noi lai server" },
```
(Chuỗi label/hint giữ dấu tiếng Việt khi viết thật - ở đây rút gọn.) KHÔNG thêm vào `.env.example`/`.env.production.example` (không đọc trước lúc mở DB).

- [ ] **Step 3: Verify** — Run: `pnpm typecheck` — Expected: PASS (nếu tuning key không trùng env name sẽ đỏ lúc biên dịch - đó là cổng canh).

- [ ] **Step 4: Commit**

```bash
git add src/config/env.ts src/config/tuning-definitions.ts
git commit -m "feat(mcp): them config MCP_* (env + tuning chinh nong)"
```

## Task 4: Lược đồ DB `taoBangMcp` + đăng ký migration

**Files:**
- Create: `src/mcp/mcp-schema.ts`
- Modify: `src/conversation/database.ts` (sau dòng 251, sau `taoBangFriendRequests(db)`)
- Test: `src/mcp/mcp-schema.test.ts`

**Interfaces:**
- Produces: `taoBangMcp(db: DatabaseSync): void`.
- Consumes: `db` singleton (`conversation/database.ts:10`).

- [ ] **Step 1: Viết test đỏ** (`mcp-schema.test.ts`)

```ts
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  database = await import("../conversation/database.js"); // chạy migration ở module scope
});
after(() => { database.closeDatabase(); cleanupTestEnv(dataDir); });

const cotCua = (bang: string): string[] =>
  (database.db.prepare(`SELECT name FROM pragma_table_info('${bang}')`).all() as { name: string }[]).map((r) => r.name);

describe("mcp-schema", () => {
  it("tạo bảng mcp_servers đủ cột", () => {
    const cot = cotCua("mcp_servers");
    for (const c of ["id", "ten", "url", "headers_ma_hoa", "enabled", "trang_thai", "loi", "tools_snapshot", "fingerprint"])
      assert.ok(cot.includes(c), `thiếu cột ${c}`);
  });
  it("tạo bảng agent_mcp_servers (khóa ghép)", () => {
    assert.deepEqual(cotCua("agent_mcp_servers").sort(), ["agent_id", "server_id"]);
  });
});
```

- [ ] **Step 2: Chạy thấy đỏ** — Run: `npx tsx --test src/mcp/mcp-schema.test.ts` — Expected: FAIL ("no such table: mcp_servers").

- [ ] **Step 3: Viết `mcp-schema.ts`** (2 bảng theo spec muc 2)

```ts
// src/mcp/mcp-schema.ts
import type { DatabaseSync } from "node:sqlite";

/** Lược đồ MCP client: server ngoài + gán server cho agent (default-deny).
 *  Gọi từ database.ts runMigrations(). KHÔNG FK - mọi nơi xóa phải dọn tay. */
export function taoBangMcp(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id             TEXT PRIMARY KEY,
      ten            TEXT NOT NULL,
      url            TEXT NOT NULL,
      headers_ma_hoa TEXT NOT NULL DEFAULT '',
      enabled        INTEGER NOT NULL DEFAULT 1,
      trang_thai     TEXT NOT NULL DEFAULT 'cho_ket_noi'
                     CHECK (trang_thai IN ('cho_ket_noi','da_ket_noi','loi','can_duyet_lai')),
      loi            TEXT NOT NULL DEFAULT '',
      tools_snapshot TEXT NOT NULL DEFAULT '',
      fingerprint    TEXT NOT NULL DEFAULT '',
      created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS agent_mcp_servers (
      agent_id  TEXT NOT NULL,
      server_id TEXT NOT NULL,
      PRIMARY KEY (agent_id, server_id)
    );
  `);
}
```

- [ ] **Step 4: Đăng ký trong `database.ts`** — thêm import + gọi sau dòng 251:

```ts
// đầu file, cạnh import taoBangFriendRequests
import { taoBangMcp } from "../mcp/mcp-schema.js";
// trong runMigrations(), ngay sau taoBangFriendRequests(db);
  taoBangMcp(db);
```

- [ ] **Step 5: Chạy thấy xanh** — Run: `npx tsx --test src/mcp/mcp-schema.test.ts` — Expected: PASS.

- [ ] **Step 6: Phá-kiểm** — tạm xóa dòng `CREATE TABLE ... agent_mcp_servers` -> chạy lại -> ca thứ hai ĐỎ. Khôi phục.

- [ ] **Step 7: Commit**

```bash
git add src/mcp/mcp-schema.ts src/conversation/database.ts src/mcp/mcp-schema.test.ts
git commit -m "feat(mcp): luoc do mcp_servers + agent_mcp_servers"
```

## Success Criteria

- [ ] `pnpm typecheck` sạch với `@ai-sdk/mcp` đã cài.
- [ ] `npx tsx --test src/mcp/mcp-schema.test.ts` xanh; phá 1 bảng thì đỏ.
- [ ] 4 key `MCP_*` hiện ở trang Cấu hình (kiểm ở Phase 07 khi có UI) và đọc được qua `getTuning`.
- [ ] Không sửa `.env*.example`.
