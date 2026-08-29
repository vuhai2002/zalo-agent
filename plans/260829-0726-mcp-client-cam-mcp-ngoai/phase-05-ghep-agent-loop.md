# Phase 05: Ghép tool ngoài vào agent loop

**Plan:** [plan.md](plan.md) | **Spec:** [reports/thiet-ke-va-interface.md](reports/thiet-ke-va-interface.md)
**Deliverable:** `listAvailableTools`/`buildAgentTools` gộp tool ngoài; tool chỉ hiện cho agent ĐƯỢC gán; tôn trọng disable (agent/account) và loại khỏi lượt lịch.
**Phụ thuộc:** Phase 04 (manager `mcpToolDefinitions`).

## Bối cảnh

- **Tinh chỉnh so với spec muc 4 (có lý do):** KHÔNG cho `tool-registry.ts` import thẳng `mcp-manager.js`. Lý do: `mcp-manager -> mcp-server-store -> database.js` mở SQLite ở MODULE SCOPE; test nào import `tool-registry` TRƯỚC `setupTestEnv()` sẽ mở nhầm DB thật (đúng bẫy CLAUDE.md). Chèn một lớp mỏng `mcp-tool-provider.ts` (thuần, không chạm DB): `tool-registry` đọc qua nó; `mcp-manager` ĐĂNG KÝ nguồn vào nó lúc `startMcpManager`. Mặc định nguồn trả `[]` -> mọi test cũ vẫn xanh.
- `listAvailableTools(scope)` là chỗ DUY NHẤT quyết định tool nào vào lượt (cả `buildAgentTools` lẫn `buildSystemPrompt` đi qua). Gộp ở đây là tool ngoài thừa hưởng đủ bộ lọc.

## Task A: Lớp provider + gộp vào registry

**Files:**
- Create: `src/agent/tools/mcp-tool-provider.ts`
- Modify: `src/agent/tools/tool-registry.ts` (`listAvailableTools`, dòng ~69)
- Test: `src/agent/tools/mcp-registry-integration.test.ts`

**Interfaces:**
- Produces: `datNguonToolMcp(fn)`, `layToolMcpChoAgent(agentId): ToolDefinition[]`.
- Consumes: `mcpToolDefinitions` (Phase 04) - đăng ký ở Task B.

- [ ] **Step 1: Viết `mcp-tool-provider.ts`**

```ts
// src/agent/tools/mcp-tool-provider.ts
// Lớp mỏng để tool ngoài (src/mcp) chảy vào registry mà KHÔNG bắt tool-registry
// import chuỗi chạm DB ở module scope. Manager đăng ký nguồn lúc khởi động; test
// đăng ký một hàm thuần. Mặc định rỗng -> chưa có manager thì không tool ngoài nào.
import type { ToolDefinition } from "./tool-catalog-types.js";

let nguon: (agentId: string) => ToolDefinition[] = () => [];
export function datNguonToolMcp(fn: (agentId: string) => ToolDefinition[]): void { nguon = fn; }
export function layToolMcpChoAgent(agentId: string): ToolDefinition[] { return nguon(agentId); }
```

- [ ] **Step 2: Viết test đỏ** (`mcp-registry-integration.test.ts`) — tiêm nguồn giả, không cần manager/DB cho phần MCP; vẫn `setupTestEnv` vì registry gọi `available()` của tool nội có tool chạm DB.

```ts
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { tool } from "ai";
import { z } from "zod";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";
import type { ToolDefinition } from "./tool-catalog-types.js";

let dataDir: string;
let registry: typeof import("./tool-registry.js");
let provider: typeof import("./mcp-tool-provider.js");
let database: typeof import("../../conversation/database.js");

const defGia: ToolDefinition = {
  key: "mcp__notion__tra_cuu", label: "Notion: tra_cuu", description: "x", group: "action",
  runsInScheduledTurn: false, keTrongKhaNang: false, available: () => true,
  build: () => tool({ description: "x", inputSchema: z.object({}), execute: async () => "ok" }),
};
const scope = (id: string, accDisabled: string[] = []) => ({
  agent: { id, disabledTools: [] }, account: { disabledTools: accDisabled, loai: "ca_nhan" as const },
});

before(async () => {
  dataDir = setupTestEnv();
  registry = await import("./tool-registry.js");
  provider = await import("./mcp-tool-provider.js");
  database = await import("../../conversation/database.js");
});
after(() => { database.closeDatabase(); cleanupTestEnv(dataDir); });
beforeEach(() => provider.datNguonToolMcp(() => []));

const coTool = (list: ToolDefinition[]) => list.some((d) => d.key === "mcp__notion__tra_cuu");

describe("gộp tool ngoài vào registry", () => {
  it("agent ĐƯỢC gán -> có tool ngoài; agent khác -> không", () => {
    provider.datNguonToolMcp((id) => (id === "ag1" ? [defGia] : []));
    assert.ok(coTool(registry.listAvailableTools(scope("ag1"))));
    assert.ok(!coTool(registry.listAvailableTools(scope("ag2"))));
  });
  it("lượt theo lịch (isolated) -> tool ngoài biến mất (runsInScheduledTurn=false)", () => {
    provider.datNguonToolMcp(() => [defGia]);
    assert.ok(!coTool(registry.listAvailableTools(scope("ag1"), { isolated: true })));
  });
  it("account tắt tool đó -> biến mất", () => {
    provider.datNguonToolMcp(() => [defGia]);
    assert.ok(!coTool(registry.listAvailableTools(scope("ag1", ["mcp__notion__tra_cuu"]))));
  });
});
```

- [ ] **Step 3: Chạy thấy đỏ** — Run: `npx tsx --test src/agent/tools/mcp-registry-integration.test.ts` — Expected: FAIL (registry chưa gộp nguồn).

- [ ] **Step 4: Sửa `tool-registry.ts`** — import provider + gộp trong `listAvailableTools`:

```ts
// thêm import
import { layToolMcpChoAgent } from "./mcp-tool-provider.js";
// trong listAvailableTools, đổi nguồn lọc:
  const tatCa = [...TOOL_DEFINITIONS, ...layToolMcpChoAgent(scope.agent.id)];
  return tatCa.filter((def) => {
    if (disabled.has(def.key)) return false;
    if (context.isolated && def.runsInScheduledTurn === false) return false;
    return kiemTraKhaDung(def, scope).khaDung;
  });
```

- [ ] **Step 5: Chạy thấy xanh** — Run: `npx tsx --test src/agent/tools/mcp-registry-integration.test.ts` — Expected: PASS.

- [ ] **Step 6: Không hồi quy** — Run: `npx tsx --test src/agent/tools/tool-registry.test.ts` — Expected: PASS (nguồn mặc định rỗng nên hành vi cũ nguyên).

- [ ] **Step 7: Phá-kiểm** — revert dòng gộp (`const tatCa = TOOL_DEFINITIONS`) -> ca "agent được gán" ĐỎ. Khôi phục.

- [ ] **Step 8: Commit**

```bash
git add src/agent/tools/mcp-tool-provider.ts src/agent/tools/tool-registry.ts src/agent/tools/mcp-registry-integration.test.ts
git commit -m "feat(mcp): gop tool ngoai vao registry qua lop provider"
```

## Task B: Manager đăng ký nguồn lúc khởi động

**Files:**
- Modify: `src/mcp/mcp-manager.ts` (`startMcpManager`)

**Interfaces:**
- Consumes: `datNguonToolMcp` (Task A), `mcpToolDefinitions` (Phase 04).

- [ ] **Step 1: Đăng ký nguồn trong `startMcpManager`** — thêm ở đầu hàm (trước vòng nối):

```ts
import { datNguonToolMcp } from "../agent/tools/mcp-tool-provider.js";
// trong startMcpManager, ngay sau guard MCP_ENABLED:
  datNguonToolMcp(mcpToolDefinitions);
```

- [ ] **Step 2: Verify** — Run: `npx tsx --test src/mcp/mcp-manager.test.ts` — Expected: PASS (không đổi hành vi test cũ). `pnpm typecheck` sạch.

- [ ] **Step 3: Commit**

```bash
git add src/mcp/mcp-manager.ts
git commit -m "feat(mcp): manager dang ky nguon tool ngoai cho registry"
```

## Success Criteria

- [ ] Tool ngoài chỉ vào lượt của agent ĐƯỢC gán; agent khác không thấy.
- [ ] Lượt `isolated` và account tắt tool đều loại tool ngoài.
- [ ] `tool-registry.test.ts` cũ vẫn xanh (không hồi quy).
- [ ] `tool-registry.ts` KHÔNG import trực tiếp `mcp-manager`/`database` (chỉ qua provider thuần).
