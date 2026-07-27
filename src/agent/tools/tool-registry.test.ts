import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { API } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";

// Kéo theo env + DB nên phải setupTestEnv trước, import động sau
let dataDir: string;
let registry: typeof import("./tool-registry.js");
let visionStore: typeof import("../../config/runtime-vision-settings.js");
let imageStore: typeof import("../../config/runtime-image-settings.js");

before(async () => {
  dataDir = setupTestEnv();
  registry = await import("./tool-registry.js");
  visionStore = await import("../../config/runtime-vision-settings.js");
  imageStore = await import("../../config/runtime-image-settings.js");
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
    batch: [],
  };
}

function unconfigureSidecar(): void {
  visionStore.updateVisionSettings({ sidecarBaseUrl: "", sidecarModel: "", sidecarApiKey: "" });
}

function configureSidecar(): void {
  visionStore.updateVisionSettings({
    sidecarBaseUrl: "https://gemini.test/v1beta/openai",
    sidecarModel: "gemini-3.5-flash-lite",
    sidecarApiKey: "AIza-x",
  });
}

/** Các tool chỉ vào schema khi hạ tầng riêng của chúng đã sẵn sàng */
const GATED_TOOLS = ["read_image", "create_image"];

function configureImageGen(): void {
  imageStore.updateImageSettings({
    baseUrl: "https://router.test",
    model: "cx/gpt-5.5-image",
    apiKey: "sk-x",
  });
}

describe("tool-registry", () => {
  it("mặc định (không tắt gì) build đủ catalog TRỪ các tool chưa có hạ tầng", () => {
    unconfigureSidecar();
    imageStore.clearImageSettings();
    const tools = registry.buildAgentTools(makeContext([]));
    const expected = registry.TOOL_KEYS.filter((k) => !GATED_TOOLS.includes(k));
    assert.deepEqual(Object.keys(tools).sort(), expected.sort());
    // Các tool cốt lõi phải có mặt - đổi key là model "mất trí nhớ" về tool
    for (const key of ["get_datetime", "web_search", "web_fetch", "add_reaction", "send_file"]) {
      assert.ok(tools[key], `thiếu tool ${key}`);
    }
  });

  it("read_image chỉ vào schema khi sidecar đã cấu hình (kiểm mỗi lượt, không cần restart)", () => {
    configureSidecar();
    assert.ok(registry.buildAgentTools(makeContext([])).read_image, "có sidecar phải có tool");
    unconfigureSidecar();
    assert.equal(registry.buildAgentTools(makeContext([])).read_image, undefined);
  });

  it("read_image bị tắt per account thì kể cả có sidecar cũng không vào schema", () => {
    configureSidecar();
    const tools = registry.buildAgentTools(makeContext(["read_image"]));
    assert.equal(tools.read_image, undefined);
    unconfigureSidecar();
  });

  it("tool bị tắt biến mất khỏi schema - model không biết nó tồn tại", () => {
    const tools = registry.buildAgentTools(makeContext(["web_search", "send_file"]));
    assert.equal(tools.web_search, undefined);
    assert.equal(tools.send_file, undefined);
    assert.ok(tools.get_datetime, "tool không tắt vẫn phải còn");
  });

  it("create_image chỉ vào schema khi đã cấu hình endpoint vẽ ảnh", () => {
    imageStore.clearImageSettings();
    assert.equal(registry.buildAgentTools(makeContext([])).create_image, undefined);
    configureImageGen();
    assert.ok(registry.buildAgentTools(makeContext([])).create_image, "có cấu hình phải có tool");
    imageStore.clearImageSettings();
  });

  it("create_image bị tắt per account thì kể cả đã cấu hình cũng không vào schema", () => {
    configureImageGen();
    assert.equal(registry.buildAgentTools(makeContext(["create_image"])).create_image, undefined);
    imageStore.clearImageSettings();
  });

  it("key lạ trong disabledTools không làm crash, không ảnh hưởng tool khác", () => {
    unconfigureSidecar();
    imageStore.clearImageSettings();
    const tools = registry.buildAgentTools(makeContext(["khong-ton-tai"]));
    // 2 tool có điều kiện vắng vì chưa cấu hình, phần còn lại đủ
    assert.equal(Object.keys(tools).length, registry.TOOL_KEYS.length - GATED_TOOLS.length);
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
