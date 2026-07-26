import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let detection: typeof import("./model-vision-detection.js");
let visionStore: typeof import("../config/runtime-vision-settings.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv({
    // openai-compatible + base URL để đi vào nhánh tra /models
    LLM_PROVIDER: "openai-compatible",
    LLM_BASE_URL: "http://router.test/v1",
    LLM_MODEL: "cx/gpt-5.6-sol",
    LLM_VISION_MODE: "auto",
  });
  detection = await import("./model-vision-detection.js");
  visionStore = await import("../config/runtime-vision-settings.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(() => {
  detection.clearVisionDetectionCache();
  visionStore.updateVisionSettings({ mode: "auto" });
});

/** Response /models kiểu 9Router: entry kèm capabilities.vision */
const routerPayload = {
  data: [
    { id: "cx/gpt-5.6-sol", capabilities: { vision: true } },
    { id: "ds/deepseek-v4-pro", capabilities: { vision: false } },
    { id: "my-combo" }, // combo không có capabilities
  ],
};

describe("parseModelsCapabilities", () => {
  it("bóc đúng map vision, bỏ qua entry thiếu capabilities", () => {
    const map = detection.parseModelsCapabilities(routerPayload);
    assert.equal(map.get("cx/gpt-5.6-sol"), true);
    assert.equal(map.get("ds/deepseek-v4-pro"), false);
    assert.equal(map.has("my-combo"), false);
  });

  it("payload rác không throw, trả map rỗng", () => {
    assert.equal(detection.parseModelsCapabilities(null).size, 0);
    assert.equal(detection.parseModelsCapabilities({ data: "x" }).size, 0);
  });
});

describe("modelReadsImages", () => {
  it("mode on/off ép tay, không gọi /models", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return routerPayload;
    };
    visionStore.updateVisionSettings({ mode: "on" });
    assert.equal(await detection.modelReadsImages(undefined, fetcher), true);
    visionStore.updateVisionSettings({ mode: "off" });
    assert.equal(await detection.modelReadsImages(undefined, fetcher), false);
    assert.equal(calls, 0);
  });

  it("auto: router báo vision=false thì tắt ảnh; model không có trong list thì coi như có", async () => {
    const fetcher = async () => routerPayload;
    // Model mặc định cx/gpt-5.6-sol có vision
    assert.equal(await detection.modelReadsImages(undefined, fetcher), true);
    // Override sang model router báo không vision
    assert.equal(
      await detection.modelReadsImages({ modelName: "ds/deepseek-v4-pro" }, fetcher),
      false,
    );
    // Combo không có capabilities -> không biết -> giữ hành vi cũ (true)
    assert.equal(await detection.modelReadsImages({ modelName: "my-combo" }, fetcher), true);
  });

  it("auto: /models lỗi thì coi như có vision và có cache (không đập router)", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      throw new Error("router down");
    };
    assert.equal(await detection.modelReadsImages(undefined, fetcher), true);
    assert.equal(await detection.modelReadsImages(undefined, fetcher), true);
    assert.equal(calls, 1, "kết quả lỗi cũng phải được cache");
  });

  it("cache dùng chung theo baseUrl: 2 model khác nhau chỉ gọi /models 1 lần", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return routerPayload;
    };
    await detection.modelReadsImages(undefined, fetcher);
    await detection.modelReadsImages({ modelName: "ds/deepseek-v4-pro" }, fetcher);
    assert.equal(calls, 1);
  });

  it("provider anthropic luôn true, không gọi /models", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return routerPayload;
    };
    assert.equal(
      await detection.modelReadsImages({ modelProvider: "anthropic", modelName: "claude-opus-5" }, fetcher),
      true,
    );
    assert.equal(calls, 0);
  });
});
