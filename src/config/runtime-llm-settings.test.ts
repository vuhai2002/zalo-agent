import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let settings: typeof import("./runtime-llm-settings.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv({
    LLM_PROVIDER: "anthropic",
    LLM_MODEL: "env-model",
    LLM_BASE_URL: "https://env.test/v1",
    LLM_API_KEY: "sk-env-key-123456",
  });
  settings = await import("./runtime-llm-settings.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

describe("runtime-llm-settings", () => {
  it("chưa có override thì trả nguyên cấu hình env", () => {
    const s = settings.getEffectiveLlmSettings();
    assert.equal(s.provider, "anthropic");
    assert.equal(s.model, "env-model");
    assert.equal(s.apiKey, "sk-env-key-123456");
    assert.equal(s.hasOverride, false);
  });

  it("override model + provider đè lên env, field không set giữ nguyên env", () => {
    settings.updateLlmSettings({ model: "db-model", provider: "openai-compatible", baseUrl: "https://r.test/v1" });

    const s = settings.getEffectiveLlmSettings();
    assert.equal(s.model, "db-model");
    assert.equal(s.provider, "openai-compatible");
    assert.equal(s.baseUrl, "https://r.test/v1");
    assert.equal(s.apiKey, "sk-env-key-123456", "key chưa override phải giữ từ env");
    assert.equal(s.hasOverride, true);
  });

  it("API key lưu DB được mã hóa, đọc lại giải mã đúng", () => {
    settings.updateLlmSettings({ apiKey: "sk-db-secret-789" });

    // Trong DB phải là ciphertext, không phải plaintext
    const raw = database.db
      .prepare("SELECT value FROM runtime_settings WHERE key = 'llm_api_key'")
      .get() as { value: string };
    assert.ok(!raw.value.includes("sk-db-secret"), "key trong DB không được là plaintext");

    assert.equal(settings.getEffectiveLlmSettings().apiKey, "sk-db-secret-789");
  });

  it("apiKey rỗng trong update = giữ key hiện tại", () => {
    settings.updateLlmSettings({ apiKey: "", model: "db-model-2" });
    const s = settings.getEffectiveLlmSettings();
    assert.equal(s.apiKey, "sk-db-secret-789");
    assert.equal(s.model, "db-model-2");
  });

  it("clearLlmSettings xóa hết override, quay về env", () => {
    settings.clearLlmSettings();
    const s = settings.getEffectiveLlmSettings();
    assert.equal(s.model, "env-model");
    assert.equal(s.apiKey, "sk-env-key-123456");
    assert.equal(s.hasOverride, false);
  });

  it("maskApiKey đủ nhận diện nhưng không dùng lại được", () => {
    assert.equal(settings.maskApiKey("sk-abcdefghijklmnop"), "sk-ab...mnop");
    assert.equal(settings.maskApiKey("ngan"), "***");
  });
});

/**
 * Base URL chỉ có nghĩa với `openai-compatible`. Không phân biệt được "giữ
 * nguyên" với "xóa" thì URL của nhà cũ nằm lại trong DB vĩnh viễn: đổi sang
 * Anthropic/Google rồi quay lại là thấy endpoint của hãng đã bỏ hiện lại trong
 * ô, đọc ra như dashboard hỏng. Người dùng đã báo đúng ca này 06/08/2026.
 */
describe("updateLlmSettings - phân biệt giữ nguyên với xóa base URL", () => {
  it("undefined = GIỮ NGUYÊN base URL đang lưu", () => {
    settings.updateLlmSettings({ baseUrl: "https://router.test/v1" });
    settings.updateLlmSettings({ model: "doi-model-thoi" });
    assert.equal(settings.getEffectiveLlmSettings().baseUrl, "https://router.test/v1");
  });

  it("null = XÓA hẳn, rơi về env", () => {
    settings.updateLlmSettings({ baseUrl: "https://router.test/v1" });
    assert.equal(settings.getEffectiveLlmSettings().baseUrl, "https://router.test/v1");

    settings.updateLlmSettings({ baseUrl: null });
    // Xóa OVERRIDE chứ không nuốt luôn cấu hình máy chủ: phải rơi về env
    assert.equal(settings.getEffectiveLlmSettings().baseUrl, "https://env.test/v1");
  });

  it("xóa rồi lưu lại được - không phải đường một chiều", () => {
    settings.updateLlmSettings({ baseUrl: null });
    settings.updateLlmSettings({ baseUrl: "https://khac.test/v1" });
    assert.equal(settings.getEffectiveLlmSettings().baseUrl, "https://khac.test/v1");
    settings.updateLlmSettings({ baseUrl: null });
  });

  it("xóa base URL KHÔNG đụng tới model hay API key", () => {
    settings.updateLlmSettings({ baseUrl: "https://router.test/v1", model: "m-1", apiKey: "sk-giu-lai" });
    settings.updateLlmSettings({ baseUrl: null });
    const s = settings.getEffectiveLlmSettings();
    assert.equal(s.model, "m-1");
    assert.equal(s.apiKey, "sk-giu-lai");
  });
});
