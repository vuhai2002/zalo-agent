import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let store: typeof import("./runtime-vision-settings.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv({
    LLM_VISION_MODE: "auto",
    VISION_SIDECAR_BASE_URL: "",
    VISION_SIDECAR_MODEL: "",
    VISION_SIDECAR_API_KEY: "",
  });
  store = await import("./runtime-vision-settings.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

describe("runtime-vision-settings", () => {
  it("chưa có gì trong DB: mode theo env, sidecar chưa cấu hình", () => {
    const s = store.getVisionSettings();
    assert.equal(s.mode, "auto");
    assert.equal(store.isSidecarConfigured(s), false);
  });

  it("update mode lưu DB và đè lên env", () => {
    store.updateVisionSettings({ mode: "off" });
    assert.equal(store.getVisionSettings().mode, "off");
    store.updateVisionSettings({ mode: "auto" });
  });

  it("sidecar đủ 3 field mới tính là cấu hình; key round-trip qua mã hóa", () => {
    store.updateVisionSettings({ sidecarBaseUrl: "https://gemini.test/v1beta/openai" });
    assert.equal(store.isSidecarConfigured(), false, "mới có base URL - chưa đủ");

    store.updateVisionSettings({ sidecarModel: "gemini-3.5-flash-lite", sidecarApiKey: "AIza-secret" });
    const s = store.getVisionSettings();
    assert.equal(store.isSidecarConfigured(s), true);
    assert.equal(s.sidecar.apiKey, "AIza-secret", "key giải mã lại đúng nguyên văn");
  });

  it("API view mask key, không lộ plaintext", () => {
    const view = store.getVisionSettingsForApi();
    assert.notEqual(view.sidecar.apiKeyMasked, "AIza-secret");
    assert.equal(view.sidecar.configured, true);
    assert.ok(!JSON.stringify(view).includes("AIza-secret"));
  });

  it("chuỗi rỗng tường minh xóa field, quay về env (rỗng) -> sidecar tắt", () => {
    store.updateVisionSettings({ sidecarApiKey: "" });
    assert.equal(store.isSidecarConfigured(), false);
    store.updateVisionSettings({ sidecarBaseUrl: "", sidecarModel: "" });
    const s = store.getVisionSettings();
    assert.equal(s.sidecar.baseUrl, "");
    assert.equal(s.sidecar.model, "");
  });
});
