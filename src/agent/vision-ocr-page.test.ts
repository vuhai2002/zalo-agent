import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let ocr: typeof import("./vision-ocr-page.js");
let visionStore: typeof import("../config/runtime-vision-settings.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  ocr = await import("./vision-ocr-page.js");
  visionStore = await import("../config/runtime-vision-settings.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

const ANH = { base64: "abc", mediaType: "image/jpeg" };
const bat = () =>
  visionStore.updateVisionSettings({ sidecarBaseUrl: "https://x.test/v1", sidecarModel: "m", sidecarApiKey: "k" });

describe("chepChuTrang - OCR một trang bằng sidecar", () => {
  it("gửi đúng prompt chép nguyên văn + trần output riêng của OCR", async () => {
    bat();
    let promptNhan = "";
    let tranNhan: number | undefined;
    const kq = await ocr.chepChuTrang(ANH, { maxOutputTokens: 6000, hanMs: 60_000 }, async (_s, _a, prompt, tran, signal) => {
      assert.ok(signal instanceof AbortSignal, "phải có hạn thời gian");
      promptNhan = prompt;
      tranNhan = tran;
      return { text: "BIÊN BẢN", truncated: false };
    });
    assert.deepEqual(kq, { text: "BIÊN BẢN", truncated: false });
    assert.equal(promptNhan, ocr.PROMPT_CHEP_CHU_TRANG);
    assert.match(promptNhan, /NGUYÊN VĂN/);
    assert.match(promptNhan, /KHÔNG dịch/);
    assert.equal(tranNhan, 6000);
  });

  it("chạm trần output -> truncated true", async () => {
    bat();
    const kq = await ocr.chepChuTrang(ANH, { maxOutputTokens: 6000, hanMs: 60_000 }, async () => ({ text: "dở", truncated: true }));
    assert.equal(kq?.truncated, true);
  });

  it("sidecar ném lỗi -> null, không ném", async () => {
    bat();
    const kq = await ocr.chepChuTrang(ANH, { maxOutputTokens: 6000, hanMs: 60_000 }, async () => {
      throw new Error("429");
    });
    assert.equal(kq, null);
  });

  it("chưa cấu hình sidecar -> null, không gọi model", async () => {
    visionStore.updateVisionSettings({ sidecarBaseUrl: "", sidecarModel: "", sidecarApiKey: "" });
    let daGoi = false;
    const kq = await ocr.chepChuTrang(ANH, { maxOutputTokens: 6000, hanMs: 60_000 }, async () => {
      daGoi = true;
      return { text: "x", truncated: false };
    });
    assert.equal(kq, null);
    assert.equal(daGoi, false);
  });
});
