import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let content: typeof import("./agent-turn-content.js");
let visionStore: typeof import("../config/runtime-vision-settings.js");
let descriptionStore: typeof import("../conversation/image-description-store.js");
let database: typeof import("../conversation/database.js");

// 1x1 PNG hợp lệ để loadStoredImage đọc từ đĩa thật
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAABAAAAAQCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

before(async () => {
  dataDir = setupTestEnv();
  content = await import("./agent-turn-content.js");
  visionStore = await import("../config/runtime-vision-settings.js");
  descriptionStore = await import("../conversation/image-description-store.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

/** Tạo file media thật trong data dir tạm, trả về đường dẫn tương đối */
function writeMediaFile(relPath: string): string {
  const abs = path.join(dataDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, PNG_BYTES);
  return relPath;
}

function msgWithImages(
  text: string,
  images: { url: string; localPath?: string }[],
): ParsedMessage {
  return {
    accountId: "acc",
    threadId: "t1",
    threadType: 0,
    isGroup: false,
    senderId: "u1",
    senderName: "Hải",
    text,
    images,
    msgId: "m1",
    cliMsgId: "c1",
    isSelf: false,
    mentionsMe: false,
    rawData: {},
  };
}

function partsOf(value: unknown): { type: string; text?: string; data?: unknown }[] {
  return value as { type: string; text?: string; data?: unknown }[];
}

describe("buildCurrentTurnContent", () => {
  it("blind: không tải ảnh, chèn 1 ghi chú tổng dặn bot nói thật", async () => {
    const parts = partsOf(
      await content.buildCurrentTurnContent(
        [msgWithImages("dò giúp em", [{ url: "http://x/0.jpg" }, { url: "http://x/1.jpg" }])],
        "blind",
      ),
    );

    assert.equal(parts.length, 2, "1 ghi chú ảnh + 1 text chính");
    assert.match(parts[0]!.text!, /gửi kèm 2 ảnh nhưng bạn KHÔNG xem được/);
    assert.match(parts[1]!.text!, /dò giúp em/);
  });

  it("blind: tin không có ảnh thì không chèn ghi chú", async () => {
    const parts = partsOf(await content.buildCurrentTurnContent([msgWithImages("chào", [])], "blind"));
    assert.equal(parts.length, 1);
    assert.match(parts[0]!.text!, /chào/);
  });

  it("describe: mô tả trúng cache -> text part, KHÔNG có pixel", async () => {
    const relPath = writeMediaFile("media/acc/t1/desc-0.png");
    descriptionStore.saveImageDescription(relPath, "vé số Đà Lạt 111222", "test");

    const parts = partsOf(
      await content.buildCurrentTurnContent(
        [msgWithImages("dò vé", [{ url: "http://x/a.png", localPath: relPath }])],
        "describe",
      ),
    );

    assert.equal(parts.filter((p) => p.type === "file").length, 0);
    assert.match(parts[0]!.text!, /Mô tả ảnh người dùng vừa gửi: vé số Đà Lạt 111222/);
  });

  it("describe: sidecar không mô tả được -> note lỗi trung thực, không im lặng", async () => {
    // Sidecar chưa cấu hình + không có cache -> describeImage trả null
    visionStore.updateVisionSettings({ sidecarBaseUrl: "", sidecarModel: "", sidecarApiKey: "" });
    const relPath = writeMediaFile("media/acc/t1/desc-fail-0.png");

    const parts = partsOf(
      await content.buildCurrentTurnContent(
        [msgWithImages("dò vé", [{ url: "http://x/b.png", localPath: relPath }])],
        "describe",
      ),
    );

    assert.match(parts[0]!.text!, /hệ thống đọc ảnh đang trục trặc/);
  });

  it("hybrid: CẢ pixel LẪN mô tả cùng vào content", async () => {
    const relPath = writeMediaFile("media/acc/t1/hy-0.png");
    descriptionStore.saveImageDescription(relPath, "hóa đơn 500k", "test");

    const parts = partsOf(
      await content.buildCurrentTurnContent(
        [msgWithImages("xem giúp", [{ url: "http://x/c.png", localPath: relPath }])],
        "hybrid",
      ),
    );

    assert.equal(parts.filter((p) => p.type === "file").length, 1, "pixel phải còn");
    assert.ok(
      parts.some((p) => p.type === "text" && /Mô tả ảnh người dùng vừa gửi: hóa đơn 500k/.test(p.text!)),
      "mô tả phải kèm theo",
    );
  });

  it("hybrid: không mô tả được thì vẫn còn pixel, KHÔNG chèn note lỗi", async () => {
    visionStore.updateVisionSettings({ sidecarBaseUrl: "", sidecarModel: "", sidecarApiKey: "" });
    const relPath = writeMediaFile("media/acc/t1/hy-1.png");

    const parts = partsOf(
      await content.buildCurrentTurnContent(
        [msgWithImages("xem giúp", [{ url: "http://x/d.png", localPath: relPath }])],
        "hybrid",
      ),
    );

    assert.equal(parts.filter((p) => p.type === "file").length, 1);
    assert.ok(!parts.some((p) => p.type === "text" && /trục trặc/.test(p.text ?? "")));
  });
});

describe("resolveImageContextMode + buildTurnMessages", () => {
  it("mode off: có sidecar -> describe, không sidecar -> blind (không gọi mạng)", async () => {
    visionStore.updateVisionSettings({ mode: "off" });

    visionStore.updateVisionSettings({
      sidecarBaseUrl: "https://gemini.test/v1beta/openai",
      sidecarModel: "gemini-3.5-flash-lite",
      sidecarApiKey: "AIza-x",
    });
    assert.equal(await content.resolveImageContextMode(), "describe");

    visionStore.updateVisionSettings({ sidecarBaseUrl: "", sidecarModel: "", sidecarApiKey: "" });
    assert.equal(await content.resolveImageContextMode(), "blind");

    visionStore.updateVisionSettings({ mode: "auto" });
  });

  it("forceMode ép chế độ cho reactive fallback, bỏ qua auto-detect", async () => {
    const { imageMode, messages } = await content.buildTurnMessages({
      history: [],
      batch: [msgWithImages("hỏng rồi thử lại", [{ url: "http://x/e.png" }])],
      forceMode: "blind",
      // 0 = không giới hạn, khai TƯỜNG MINH. Trường này cố ý bắt buộc để quên
      // truyền là lỗi biên dịch chứ không phải tắt ngân sách âm thầm.
      tranToken: 0,
    });
    assert.equal(imageMode, "blind");
    const last = partsOf(messages[messages.length - 1]!.content);
    assert.ok(last.some((p) => /KHÔNG xem được/.test(p.text ?? "")));
  });
});
