import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let sidecar: typeof import("./vision-sidecar.js");
let visionStore: typeof import("../config/runtime-vision-settings.js");
let descriptionStore: typeof import("../conversation/image-description-store.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  sidecar = await import("./vision-sidecar.js");
  visionStore = await import("../config/runtime-vision-settings.js");
  descriptionStore = await import("../conversation/image-description-store.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

const IMG = { base64: "abc", mediaType: "image/jpeg" };

function configureSidecar(): void {
  visionStore.updateVisionSettings({
    sidecarBaseUrl: "https://gemini.test/v1beta/openai",
    sidecarModel: "gemini-2.5-flash-lite",
    sidecarApiKey: "AIza-test",
  });
}

function unconfigureSidecar(): void {
  visionStore.updateVisionSettings({ sidecarBaseUrl: "", sidecarModel: "", sidecarApiKey: "" });
}

describe("vision-sidecar", () => {
  it("chưa cấu hình sidecar: trả null, KHÔNG gọi model", async () => {
    unconfigureSidecar();
    let calls = 0;
    const result = await sidecar.describeImage({ ...IMG, cacheKey: "media/a/t/x-0.jpg" }, async () => {
      calls++;
      return "mô tả";
    });
    assert.equal(result, null);
    assert.equal(calls, 0);
  });

  it("mô tả thành công thì lưu cache; lần 2 đọc cache không gọi lại", async () => {
    configureSidecar();
    let calls = 0;
    const call = async () => {
      calls++;
      return "vé số Đà Lạt 123456";
    };

    const first = await sidecar.describeImage({ ...IMG, cacheKey: "media/a/t/ve-0.jpg" }, call);
    assert.equal(first, "vé số Đà Lạt 123456");
    assert.equal(descriptionStore.getImageDescription("media/a/t/ve-0.jpg"), "vé số Đà Lạt 123456");

    const second = await sidecar.describeImage({ ...IMG, cacheKey: "media/a/t/ve-0.jpg" }, call);
    assert.equal(second, "vé số Đà Lạt 123456");
    assert.equal(calls, 1, "lần 2 phải trúng cache");
  });

  it("không có cacheKey (ảnh chưa persist) vẫn mô tả được, không ghi cache", async () => {
    configureSidecar();
    const result = await sidecar.describeImage(IMG, async () => "ảnh chụp hóa đơn");
    assert.equal(result, "ảnh chụp hóa đơn");
  });

  it("sidecar ném lỗi (hết quota, chết mạng): trả null, không throw", async () => {
    configureSidecar();
    const result = await sidecar.describeImage({ ...IMG, cacheKey: "media/a/t/err-0.jpg" }, async () => {
      throw new Error("429 quota exceeded");
    });
    assert.equal(result, null);
    assert.equal(descriptionStore.getImageDescription("media/a/t/err-0.jpg"), null);
  });

  it("ensureDescriptionsFor: bỏ qua ảnh đã có mô tả + ảnh mất file, mô tả phần còn lại", async () => {
    configureSidecar();
    descriptionStore.saveImageDescription("media/a/t/cached.jpg", "đã có sẵn", "test");
    const described: string[] = [];

    await sidecar.ensureDescriptionsFor(
      ["media/a/t/cached.jpg", "media/a/t/moi.jpg", "media/a/t/mat-file.jpg"],
      (relPath) => (relPath === "media/a/t/mat-file.jpg" ? null : IMG),
      async () => {
        described.push("call");
        return "mô tả mới";
      },
    );

    assert.equal(described.length, 1, "chỉ ảnh chưa có mô tả + còn file mới được gọi");
    assert.equal(descriptionStore.getImageDescription("media/a/t/moi.jpg"), "mô tả mới");
    assert.equal(descriptionStore.getImageDescription("media/a/t/cached.jpg"), "đã có sẵn");
  });

  it("testSidecar: chưa cấu hình thì ném lỗi có hướng dẫn", async () => {
    unconfigureSidecar();
    await assert.rejects(() => sidecar.testSidecar(async () => "ok"), /base URL \+ model \+ API key/);
  });

  it("pruneExpiredImageDescriptions xóa mô tả cũ, giữ mô tả mới", () => {
    descriptionStore.saveImageDescription("media/a/t/moi-nhat.jpg", "mới", "test");
    // retention 0 ngày = cutoff ngay bây giờ -> mọi row (tạo trước đó vài ms) bị xóa
    const removed = descriptionStore.pruneExpiredImageDescriptions(0);
    assert.ok(removed >= 1);
    assert.equal(descriptionStore.getImageDescription("media/a/t/moi-nhat.jpg"), null);
  });
});
