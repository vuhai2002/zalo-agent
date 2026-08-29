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
