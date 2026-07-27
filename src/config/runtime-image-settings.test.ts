import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let store: typeof import("./runtime-image-settings.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv({
    IMAGE_GEN_BASE_URL: "",
    IMAGE_GEN_MODEL: "",
    IMAGE_GEN_API_KEY: "",
  });
  store = await import("./runtime-image-settings.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

describe("runtime-image-settings", () => {
  it("chưa có gì trong DB và env trống: chưa cấu hình", () => {
    assert.equal(store.isImageGenConfigured(), false);
  });

  it("đủ 3 field mới tính là cấu hình; key round-trip qua mã hóa", () => {
    store.updateImageSettings({ baseUrl: "https://9router.test" });
    assert.equal(store.isImageGenConfigured(), false, "mới có base URL - chưa đủ");

    store.updateImageSettings({ model: "cx/gpt-5.5-image" });
    assert.equal(store.isImageGenConfigured(), false, "thiếu key - chưa đủ");

    store.updateImageSettings({ apiKey: "sk-bi-mat" });
    const s = store.getImageSettings();
    assert.equal(store.isImageGenConfigured(s), true);
    assert.equal(s.apiKey, "sk-bi-mat", "key giải mã lại đúng nguyên văn");
  });

  it("API view mask key, không lộ plaintext", () => {
    const view = store.getImageSettingsForApi();
    assert.notEqual(view.apiKeyMasked, "sk-bi-mat");
    assert.equal(view.hasApiKey, true);
    assert.equal(view.configured, true);
    assert.ok(!JSON.stringify(view).includes("sk-bi-mat"));
  });

  it("clearImageSettings xóa sạch cả key - đường duy nhất gỡ key vì PATCH quy ước giữ key cũ", () => {
    store.clearImageSettings();
    const s = store.getImageSettings();
    assert.equal(s.apiKey, "");
    assert.equal(s.baseUrl, "");
    assert.equal(s.model, "");
    assert.equal(store.isImageGenConfigured(s), false);
  });

  it("chuỗi rỗng tường minh = xóa field, quay về env", () => {
    store.updateImageSettings({ baseUrl: "https://tam.test", model: "m", apiKey: "k" });
    store.updateImageSettings({ baseUrl: "" });
    assert.equal(store.getImageSettings().baseUrl, "", "về env (đang trống)");
    store.clearImageSettings();
  });

  it("bỏ trống apiKey trong update = GIỮ key cũ, không xóa", () => {
    store.updateImageSettings({ baseUrl: "https://9router.test", model: "cx/gpt-5.5-image", apiKey: "sk-giu-lai" });
    store.updateImageSettings({ model: "cx/gpt-5.3-image" });
    assert.equal(store.getImageSettings().apiKey, "sk-giu-lai");
    store.clearImageSettings();
  });
});
