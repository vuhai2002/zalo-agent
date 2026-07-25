import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { API } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";

// Kéo theo env + DB nên phải setupTestEnv trước, import động sau
let dataDir: string;
let registry: typeof import("./tool-registry.js");

before(async () => {
  dataDir = setupTestEnv();
  registry = await import("./tool-registry.js");
});

after(async () => {
  const { closeDatabase } = await import("../../conversation/database.js");
  closeDatabase();
  cleanupTestEnv(dataDir);
});

/** build() không gọi API lúc dựng schema nên stub rỗng là đủ */
function makeContext(disabledTools: string[]) {
  return {
    api: {} as API,
    account: {
      id: "acc-test",
      label: "Test",
      enabled: true,
      agentId: "agent-test",
      allowlist: { mode: "all" as const, userIds: [] },
      groupRequireMention: true,
      respondToGroups: true,
      groupPassiveListen: true,
      autoReactEnabled: true,
      autoReactIcon: "heart",
      typingIndicatorEnabled: true,
      disabledTools,
    },
    message: { threadId: "t-1", threadType: 0 } as never,
  };
}

describe("tool-registry", () => {
  it("mặc định (không tắt gì) build đủ mọi tool trong catalog", () => {
    const tools = registry.buildAgentTools(makeContext([]));
    assert.deepEqual(Object.keys(tools).sort(), [...registry.TOOL_KEYS].sort());
    // Các tool cốt lõi phải có mặt - đổi key là model "mất trí nhớ" về tool
    for (const key of ["get_datetime", "web_search", "web_fetch", "add_reaction", "send_file"]) {
      assert.ok(tools[key], `thiếu tool ${key}`);
    }
  });

  it("tool bị tắt biến mất khỏi schema - model không biết nó tồn tại", () => {
    const tools = registry.buildAgentTools(makeContext(["web_search", "send_file"]));
    assert.equal(tools.web_search, undefined);
    assert.equal(tools.send_file, undefined);
    assert.ok(tools.get_datetime, "tool không tắt vẫn phải còn");
  });

  it("key lạ trong disabledTools không làm crash, không ảnh hưởng tool khác", () => {
    const tools = registry.buildAgentTools(makeContext(["khong-ton-tai"]));
    assert.equal(Object.keys(tools).length, registry.TOOL_KEYS.length);
  });

  it("catalog: key duy nhất, đủ metadata cho UI, nhóm hợp lệ", () => {
    const keys = registry.TOOL_DEFINITIONS.map((t) => t.key);
    assert.equal(new Set(keys).size, keys.length, "key tool phải duy nhất");
    for (const def of registry.TOOL_DEFINITIONS) {
      assert.ok(def.label && def.description, `tool ${def.key} thiếu label/description cho UI`);
      assert.ok(["read", "action"].includes(def.group));
    }
  });
});
