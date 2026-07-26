import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let store: typeof import("./runtime-tool-settings.js");

before(async () => {
  dataDir = setupTestEnv();
  store = await import("./runtime-tool-settings.js");
});

after(async () => {
  const { closeDatabase } = await import("../conversation/database.js");
  closeDatabase();
  cleanupTestEnv(dataDir);
});

describe("runtime-tool-settings", () => {
  it("mặc định là duckduckgo, chưa có key - web search không bao giờ 'chưa cấu hình'", () => {
    const settings = store.getSearchSettings();
    assert.equal(settings.provider, "duckduckgo");
    assert.equal(settings.braveApiKey, "");
  });

  it("chọn brave khi chưa có key thì bị chặn ngay ở store", () => {
    assert.throws(() => store.updateSearchSettings({ provider: "brave" }), /API key Brave/);
    assert.equal(store.getSearchSettings().provider, "duckduckgo");
  });

  it("có key thì bật được brave, key lưu mã hóa nhưng đọc lại đúng", () => {
    const next = store.updateSearchSettings({
      provider: "brave",
      braveApiKey: "BSA-secret-key-123",
    });
    assert.equal(next.provider, "brave");
    assert.equal(next.braveApiKey, "BSA-secret-key-123");
  });

  it("dạng trả về API luôn masked, không bao giờ lộ key đầy đủ", () => {
    const api = store.getSearchSettingsForApi();
    assert.equal(api.hasBraveApiKey, true);
    assert.ok(!api.braveApiKeyMasked.includes("secret"), "không được lộ ruột key");
    assert.match(api.braveApiKeyMasked, /\.\.\./);
  });

  it("đổi mỗi provider (không truyền key) thì giữ nguyên key cũ", () => {
    store.updateSearchSettings({ provider: "duckduckgo" });
    assert.equal(store.getSearchSettings().braveApiKey, "BSA-secret-key-123");
    assert.equal(store.updateSearchSettings({ provider: "brave" }).provider, "brave");
  });

  it("xóa key thì tự hạ về duckduckgo, không kẹt ở brave với key rỗng", () => {
    const next = store.updateSearchSettings({ braveApiKey: "" });
    assert.equal(next.braveApiKey, "");
    assert.equal(next.provider, "duckduckgo");
  });
});
