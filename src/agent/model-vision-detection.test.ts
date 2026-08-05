import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let detection: typeof import("./model-vision-detection.js");
let visionStore: typeof import("../config/runtime-vision-settings.js");
let database: typeof import("../conversation/database.js");
let llmStore: typeof import("../config/runtime-llm-settings.js");

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
  llmStore = await import("../config/runtime-llm-settings.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(() => {
  detection.clearVisionDetectionCache();
  visionStore.updateVisionSettings({ mode: "auto" });
  // Mỗi test bắt đầu từ cấu hình env (openai-compatible). Không có dòng này thì
  // test nào đổi provider sẽ rò trạng thái sang test sau - đã dính thật.
  llmStore.clearLlmSettings();
});

/** Response /models đúng dạng đo được trên 9Router thật (2026-07-26) */
const routerPayload = {
  data: [
    { id: "cx/gpt-5.6-sol", owned_by: "cx", capabilities: { vision: true } },
    { id: "ds/deepseek-v4-pro", owned_by: "ds", capabilities: { vision: false } },
    { id: "my-combo", object: "model", owned_by: "combo" },
  ],
};

describe("parseModelsCapabilities", () => {
  it("bóc map vision + nhận diện combo qua owned_by", () => {
    const { visionByModel, comboIds } = detection.parseModelsCapabilities(routerPayload);
    assert.equal(visionByModel.get("cx/gpt-5.6-sol"), true);
    assert.equal(visionByModel.get("ds/deepseek-v4-pro"), false);
    assert.equal(visionByModel.has("my-combo"), false);
    assert.deepEqual([...comboIds], ["my-combo"]);
  });

  it("payload rác không throw, trả kết quả rỗng", () => {
    assert.equal(detection.parseModelsCapabilities(null).visionByModel.size, 0);
    assert.equal(detection.parseModelsCapabilities({ data: "x" }).comboIds.size, 0);
  });
});

describe("classifyModelVision", () => {
  it("mode on/off ép tay, không gọi /models", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return routerPayload;
    };
    visionStore.updateVisionSettings({ mode: "on" });
    assert.equal(await detection.classifyModelVision(undefined, fetcher), "vision");
    visionStore.updateVisionSettings({ mode: "off" });
    assert.equal(await detection.classifyModelVision(undefined, fetcher), "no-vision");
    assert.equal(calls, 0);
  });

  it("auto: vision=true/false theo router, combo nhận diện riêng, model lạ = unknown", async () => {
    const fetcher = async () => routerPayload;
    assert.equal(await detection.classifyModelVision(undefined, fetcher), "vision");
    assert.equal(
      await detection.classifyModelVision({ modelName: "ds/deepseek-v4-pro" }, fetcher),
      "no-vision",
    );
    assert.equal(await detection.classifyModelVision({ modelName: "my-combo" }, fetcher), "combo");
    assert.equal(
      await detection.classifyModelVision({ modelName: "model-la-hoac-moi" }, fetcher),
      "unknown",
    );
  });

  it("auto: /models lỗi thì unknown và có cache (không đập router)", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      throw new Error("router down");
    };
    assert.equal(await detection.classifyModelVision(undefined, fetcher), "unknown");
    assert.equal(await detection.classifyModelVision(undefined, fetcher), "unknown");
    assert.equal(calls, 1, "kết quả lỗi cũng phải được cache");
  });

  it("cache dùng chung theo baseUrl: nhiều model chỉ gọi /models 1 lần", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return routerPayload;
    };
    await detection.classifyModelVision(undefined, fetcher);
    await detection.classifyModelVision({ modelName: "ds/deepseek-v4-pro" }, fetcher);
    await detection.classifyModelVision({ modelName: "my-combo" }, fetcher);
    assert.equal(calls, 1);
  });

  it("provider anthropic luôn vision, không gọi /models", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return routerPayload;
    };
    // Anthropic phải là provider ĐANG HIỆU LỰC. Khai qua override trong khi cấu
    // hình chung là router thì override bị bỏ qua (chống rò khóa API), nên đây
    // đặt thẳng vào cấu hình chung.
    llmStore.updateLlmSettings({ provider: "anthropic", model: "claude-opus-5" });
    assert.equal(await detection.classifyModelVision(undefined, fetcher), "vision");
    assert.equal(calls, 0);
  });

  it("modelReadsImages: chỉ no-vision mới là false", async () => {
    const fetcher = async () => routerPayload;
    assert.equal(await detection.modelReadsImages({ modelName: "my-combo" }, fetcher), true);
    assert.equal(
      await detection.modelReadsImages({ modelName: "ds/deepseek-v4-pro" }, fetcher),
      false,
    );
  });
});

describe("markModelNoVision - cache âm của reactive fallback", () => {
  it("model bị đánh dấu thì classify ra no-vision, THẮNG cả kết quả /models lạc quan", async () => {
    const fetcher = async () => routerPayload;
    // Router bảo unknown (model lạ) -> bình thường là unknown
    assert.equal(
      await detection.classifyModelVision({ modelName: "model-cau-am" }, fetcher),
      "unknown",
    );
    // Provider từ chối ảnh thật -> đánh dấu
    detection.markModelNoVision({ modelName: "model-cau-am" });
    assert.equal(
      await detection.classifyModelVision({ modelName: "model-cau-am" }, fetcher),
      "no-vision",
    );
    // Model khác không bị vạ lây
    assert.equal(await detection.classifyModelVision(undefined, fetcher), "vision");
  });

  it("đường anthropic không bao giờ bị đánh dấu (mọi model Claude đều có vision)", async () => {
    // Anthropic phải là provider ĐANG HIỆU LỰC, không chỉ là thứ agent khai:
    // agent khai provider lệch cấu hình chung thì override bị bỏ qua lúc dựng
    // client (chống rò khóa API), nên lượt thật vẫn chạy trên provider chung.
    llmStore.updateLlmSettings({ provider: "anthropic", model: "claude-opus-5" });
    detection.markModelNoVision({ modelName: "claude-opus-5" });
    assert.equal(
      await detection.classifyModelVision({ modelName: "claude-opus-5" }, async () => routerPayload),
      "vision",
    );
  });

  it("agent KHAI anthropic nhưng cấu hình chung là router: phân loại theo model THẬT, không theo lời khai", async () => {
    // Bất biến đi kèm chốt chặn rò khóa API (`doiProviderAnToan`). Đọc override
    // thô thì đường tắt `provider === "anthropic"` trả "vision" ngay, bot đính
    // pixel vì tưởng đang chạy Claude, trong khi lượt thật đi tới model router
    // có thể mù ảnh.
    //
    // Đặt model chung thành model router KHÔNG có vision để tách bạch hai khả
    // năng: honour lời khai -> "vision"; phân loại theo model thật -> "no-vision".
    llmStore.updateLlmSettings({ provider: "openai-compatible", model: "ds/deepseek-v4-pro" });
    const kq = await detection.classifyModelVision(
      { modelProvider: "anthropic", modelName: "claude-opus-5" },
      async () => routerPayload,
    );
    assert.equal(kq, "no-vision", "override provider lệch không được cấp đường tắt vision");
  });

  it("clearVisionDetectionCache xóa cả cache âm", async () => {
    detection.markModelNoVision({ modelName: "model-tam-mu" });
    detection.clearVisionDetectionCache();
    assert.equal(
      await detection.classifyModelVision({ modelName: "model-tam-mu" }, async () => routerPayload),
      "unknown",
    );
  });
});

/**
 * Gemini đọc ảnh được, và `/models` là API riêng của 9Router - gọi thẳng Google
 * thì không có endpoint đó. Đã dính thật 06/08/2026: lượt Gemini chết vì thiếu
 * `thought_signature` (chẳng liên quan gì tới ảnh) nhưng `isImageRejectionError`
 * khớp MỌI 4xx và lịch sử thread có ảnh cũ, nên bot ghi nhớ "model mù" rồi bỏ
 * pixel suốt 10 phút sau đó.
 */
describe("classifyModelVision - provider google", () => {
  it("luôn vision và KHÔNG gọi /models - endpoint đó là của router, không phải của Google", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return routerPayload;
    };
    llmStore.updateLlmSettings({ provider: "google", model: "gemini-3.5-flash-lite" });
    assert.equal(await detection.classifyModelVision(undefined, fetcher), "vision");
    assert.equal(calls, 0);
  });

  it("một lỗi 4xx KHÔNG làm Gemini bị ghi là mù", async () => {
    llmStore.updateLlmSettings({ provider: "google", model: "gemini-3.5-flash-lite" });
    detection.markModelNoVision({ modelName: "gemini-3.5-flash-lite" });
    assert.equal(
      await detection.classifyModelVision(undefined, async () => routerPayload),
      "vision",
      "ghi nhầm là bot bỏ pixel suốt 10 phút dù model đọc ảnh được",
    );
  });
});
