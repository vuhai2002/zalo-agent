# Phase 03: ToolDefinition tool ngoài + phát hiện drift

**Plan:** [plan.md](plan.md) | **Spec:** [reports/thiet-ke-va-interface.md](reports/thiet-ke-va-interface.md)
**Deliverable:** một tool MCP (dạng AI SDK `Tool`) đổi thành `ToolDefinition` có đủ cửa bảo mật; và so được "dấu vân tay" bộ tool để bắt drift.
**Phụ thuộc:** Phase 01 (type), Phase 02 (binding - chỉ dùng gián tiếp qua hàm tiêm).

## Bối cảnh

- Đây là lõi bảo mật. Hai cửa default-deny (available lúc dựng + recheck lúc execute), bọc `wrapUntrustedContent`, hỏng trả `ketQuaLoi` (không ném), timeout mỗi lần gọi.
- **Lệch spec CÓ CHỦ Ý (để test được):** `taoToolDefinitionMcp` nhận hàm tiêm `kiemGan(agentId) => boolean` thay vì gọi thẳng `serversCuaAgent`. `available` và recheck đều gọi `kiemGan`. Manager (Phase 04) truyền `kiemGan = (agentId) => serversCuaAgent(agentId).includes(serverId)`. Nhờ vậy test lõi không phải dựng DB.
- `fingerprintTools`/`detectToolDrift` import từ `"ai"` (đã có trong `ai@7.0.37`). `detectToolDrift(current, baseline)` trả `{ added, removed, changed }`.
- Kết quả `aiTool.execute` của `@ai-sdk/mcp` có thể là chuỗi hoặc `{content:[{type:'text',text}]}` - `trichVanBanKetQuaMcp` xử cả 3 dạng.

## Task A: `mcp-tool-drift.ts` (fingerprint + drift)

**Files:**
- Create: `src/mcp/mcp-tool-drift.ts`
- Test: `src/mcp/mcp-tool-drift.test.ts`

**Interfaces:**
- Produces: `chupFingerprint(tools): Promise<string>`, `soDrift(tools, mocJson): Promise<{ drift, them, doi, bo }>`.

- [ ] **Step 1: Viết test đỏ**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tool } from "ai";
import { z } from "zod";
import { chupFingerprint, soDrift } from "./mcp-tool-drift.js";

const boTool = (them = false) => ({
  tra_cuu: tool({ description: "tra cuu", inputSchema: z.object({ q: z.string() }), execute: async () => "ok" }),
  ...(them ? { xoa: tool({ description: "xoa", inputSchema: z.object({}), execute: async () => "ok" }) } : {}),
});

describe("mcp-tool-drift", () => {
  it("cùng bộ tool -> không drift", async () => {
    const moc = await chupFingerprint(boTool());
    const kq = await soDrift(boTool(), moc);
    assert.equal(kq.drift, false);
  });
  it("thêm 1 tool -> drift, 'them' có tên nó", async () => {
    const moc = await chupFingerprint(boTool(false));
    const kq = await soDrift(boTool(true), moc);
    assert.equal(kq.drift, true);
    assert.ok(kq.them.includes("xoa"));
  });
  it("mốc rỗng -> không coi là drift", async () => {
    const kq = await soDrift(boTool(), "");
    assert.equal(kq.drift, false);
  });
});
```

- [ ] **Step 2: Chạy thấy đỏ** — Run: `npx tsx --test src/mcp/mcp-tool-drift.test.ts` — Expected: FAIL (module chưa có).

- [ ] **Step 3: Viết `mcp-tool-drift.ts`**

```ts
// src/mcp/mcp-tool-drift.ts
import { detectToolDrift, fingerprintTools, type ToolSet } from "ai";

export async function chupFingerprint(tools: ToolSet): Promise<string> {
  return JSON.stringify(await fingerprintTools(tools));
}

export async function soDrift(
  tools: ToolSet,
  mocJson: string,
): Promise<{ drift: boolean; them: string[]; doi: string[]; bo: string[] }> {
  if (!mocJson) return { drift: false, them: [], doi: [], bo: [] };
  const current = await fingerprintTools(tools);
  const baseline = JSON.parse(mocJson) as Record<string, string>;
  const { added, removed, changed } = detectToolDrift(current, baseline);
  return { drift: added.length + removed.length + changed.length > 0, them: added, doi: changed, bo: removed };
}
```
(Nếu chữ ký `fingerprintTools`/`detectToolDrift` trong bản `ai` đã cài khác chút - mở `node_modules/ai/dist/index.d.ts` xác nhận rồi khớp. Hành vi cốt lõi giữ nguyên.)

- [ ] **Step 4: Chạy thấy xanh** — Run: `npx tsx --test src/mcp/mcp-tool-drift.test.ts` — Expected: PASS.

- [ ] **Step 5: Phá-kiểm** — trong `soDrift`, `return { drift: false, ... }` cứng -> ca "thêm 1 tool" ĐỎ. Khôi phục.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/mcp-tool-drift.ts src/mcp/mcp-tool-drift.test.ts
git commit -m "feat(mcp): fingerprint + phat hien drift bo tool"
```

## Task B: `mcp-tool-definition.ts` (đổi tool MCP -> ToolDefinition có canh)

**Files:**
- Create: `src/mcp/mcp-tool-definition.ts`
- Test: `src/mcp/mcp-tool-definition.test.ts`

**Interfaces:**
- Consumes: `wrapUntrustedContent` (`agent/tools/wrap-untrusted-content.js`), `ketQuaLoi` (`agent/tools/tool-failure-result.js`), `ToolDefinition`/`ToolContext` (`agent/tools/tool-catalog-types.js`), `tool` từ `ai`.
- Produces: `tenToolMcp(serverTen, toolTen): string`, `trichVanBanKetQuaMcp(raw): string`, `taoToolDefinitionMcp(p): ToolDefinition` với `p.kiemGan: (agentId: string) => boolean` (khác spec - tiêm để test).

- [ ] **Step 1: Viết test đỏ**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "../agent/tools/tool-catalog-types.js";
import { fakeAgentProfile } from "../shared/fake-agent-profile.js";
import { ketQuaThanhCong, loiCuaTool } from "../agent/tools/tool-failure-result-test-helper.js";
import { taoToolDefinitionMcp, tenToolMcp, trichVanBanKetQuaMcp } from "./mcp-tool-definition.js";

const ctx = (id: string) => ({ agent: fakeAgentProfile({ id }) } as unknown as ToolContext);
const aiToolThat = tool({ description: "tra cuu", inputSchema: z.object({ q: z.string() }), execute: async () => "ket qua tho" });

const dungDef = (over: Partial<Parameters<typeof taoToolDefinitionMcp>[0]> = {}) =>
  taoToolDefinitionMcp({
    serverId: "s1", serverTen: "Notion", toolTen: "tra_cuu", moTa: "tra cuu",
    aiTool: aiToolThat, toolCallTimeoutMs: 1000, kiemGan: () => true, ...over,
  });

describe("mcp-tool-definition", () => {
  it("tenToolMcp có tiền tố chống trùng", () => {
    assert.equal(tenToolMcp("Notion", "tra_cuu"), "mcp__notion__tra_cuu");
  });
  it("trichVanBanKetQuaMcp xử 3 dạng", () => {
    assert.equal(trichVanBanKetQuaMcp("x"), "x");
    assert.equal(trichVanBanKetQuaMcp({ content: [{ type: "text", text: "a" }] }), "a");
    assert.equal(trichVanBanKetQuaMcp({ code: 1 }), JSON.stringify({ code: 1 }));
  });
  it("gán + execute ok -> kết quả BỌC trong <noi_dung_ngoai>", async () => {
    const def = dungDef();
    const ra = await def.build(ctx("ag1")).execute!({ q: "abc" }, {} as never);
    assert.match(ketQuaThanhCong(ra), /<noi_dung_ngoai_/);
  });
  it("aiTool ném -> ketQuaLoi (không ném ra loop)", async () => {
    const nem = tool({ description: "x", inputSchema: z.object({}), execute: async () => { throw new Error("sap"); } });
    const ra = await dungDef({ aiTool: nem }).build(ctx("ag1")).execute!({}, {} as never);
    assert.match(loiCuaTool(ra), /lỗi/);
  });
  it("KHÔNG gán -> recheck chặn (cửa 2)", async () => {
    const ra = await dungDef({ kiemGan: () => false }).build(ctx("ag1")).execute!({ q: "x" }, {} as never);
    assert.match(loiCuaTool(ra), /không còn được cấp/);
  });
  it("execute treo quá timeout -> ketQuaLoi", async () => {
    const treo = tool({ description: "x", inputSchema: z.object({}), execute: () => new Promise(() => {}) });
    const ra = await dungDef({ aiTool: treo, toolCallTimeoutMs: 20 }).build(ctx("ag1")).execute!({}, {} as never);
    assert.ok(loiCuaTool(ra).length > 0);
  });
  it("available theo kiemGan", () => {
    assert.equal(dungDef({ kiemGan: () => false }).available!({ agent: { id: "ag1", disabledTools: [] }, account: { disabledTools: [], loai: "ca_nhan" } }), false);
  });
  it("group action + không vào lượt lịch", () => {
    const def = dungDef();
    assert.equal(def.group, "action");
    assert.equal(def.runsInScheduledTurn, false);
  });
});
```

- [ ] **Step 2: Chạy thấy đỏ** — Run: `npx tsx --test src/mcp/mcp-tool-definition.test.ts` — Expected: FAIL (module chưa có).

- [ ] **Step 3: Viết `mcp-tool-definition.ts`**

```ts
// src/mcp/mcp-tool-definition.ts
import { tool, type Tool } from "ai";
import { ketQuaLoi } from "../agent/tools/tool-failure-result.js";
import type { ToolDefinition } from "../agent/tools/tool-catalog-types.js";
import { wrapUntrustedContent } from "../agent/tools/wrap-untrusted-content.js";

export function tenToolMcp(serverTen: string, toolTen: string): string {
  const slug = serverTen.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "server";
  return `mcp__${slug}__${toolTen}`;
}

export function trichVanBanKetQuaMcp(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && Array.isArray((raw as { content?: unknown }).content)) {
    const parts = ((raw as { content: unknown[] }).content)
      .filter((c): c is { type: string; text: string } =>
        !!c && typeof c === "object" && (c as { type?: unknown }).type === "text" && typeof (c as { text?: unknown }).text === "string")
      .map((c) => c.text);
    if (parts.length) return parts.join("\n");
  }
  return JSON.stringify(raw);
}

async function goiCoTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(`quá ${ms}ms`)), ms); }),
    ]);
  } finally { if (t) clearTimeout(t); }
}

export function taoToolDefinitionMcp(p: {
  serverId: string; serverTen: string; toolTen: string; moTa: string;
  aiTool: Tool; toolCallTimeoutMs: number; kiemGan: (agentId: string) => boolean;
}): ToolDefinition {
  const { serverId, serverTen, toolTen, moTa, aiTool, toolCallTimeoutMs, kiemGan } = p;
  return {
    key: tenToolMcp(serverTen, toolTen),
    label: `${serverTen}: ${toolTen}`,
    description: moTa,
    group: "action",
    runsInScheduledTurn: false,
    keTrongKhaNang: false,
    available: (scope) => kiemGan(scope.agent.id),
    build: (ctx) =>
      tool({
        description: moTa,
        inputSchema: aiTool.inputSchema,
        execute: async (args, opts) => {
          if (!kiemGan(ctx.agent.id)) return ketQuaLoi("Tool ngoài không còn được cấp cho agent này");
          try {
            const raw = await goiCoTimeout(() => aiTool.execute!(args, opts), toolCallTimeoutMs);
            return wrapUntrustedContent(trichVanBanKetQuaMcp(raw), `MCP ${serverTen}/${toolTen}`);
          } catch (e) {
            return ketQuaLoi(`Tool ngoài "${toolTen}" lỗi: ${e instanceof Error ? e.message : String(e)}`);
          }
        },
      }),
  };
}
```

- [ ] **Step 4: Chạy thấy xanh** — Run: `npx tsx --test src/mcp/mcp-tool-definition.test.ts` — Expected: PASS.

- [ ] **Step 5: Phá-kiểm (2 cửa)**
  - Bỏ `wrapUntrustedContent(...)`, trả thẳng `trichVanBanKetQuaMcp(raw)` -> ca "kết quả BỌC" ĐỎ.
  - Bỏ dòng recheck `if (!kiemGan(ctx.agent.id))` -> ca "KHÔNG gán -> recheck chặn" ĐỎ.
  Khôi phục cả hai.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/mcp-tool-definition.ts src/mcp/mcp-tool-definition.test.ts
git commit -m "feat(mcp): boc tool ngoai thanh ToolDefinition co hai cua bao mat"
```

## Success Criteria

- [ ] Tool ngoài thành công -> kết quả luôn bọc `<noi_dung_ngoai_...>`.
- [ ] Mọi nhánh hỏng (ném / timeout / mất quyền) -> `ketQuaLoi` (shape `{ok:false}`), KHÔNG ném ra loop.
- [ ] `group==="action"`, `runsInScheduledTurn===false`, `keTrongKhaNang===false`.
- [ ] Hai phá-kiểm (bỏ bọc / bỏ recheck) đều làm đúng một ca ĐỎ.
