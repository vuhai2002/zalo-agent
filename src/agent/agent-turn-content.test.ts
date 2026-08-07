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
let tuning: typeof import("../config/runtime-tuning-settings.js");
let history: typeof import("./history-to-model-messages.js");

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
  tuning = await import("../config/runtime-tuning-settings.js");
  history = await import("./history-to-model-messages.js");
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
    sentAt: new Date().toISOString(),
    rawData: {},
  };
}

function partsOf(value: unknown): { type: string; text?: string; data?: unknown }[] {
  return value as { type: string; text?: string; data?: unknown }[];
}

/** Tin không ảnh, đặt được tên người gửi và mốc giờ - dùng cho các test dựng dòng */
function msgTu(senderName: string, text: string, sentAt: string, isGroup = true): ParsedMessage {
  return { ...msgWithImages(text, []), senderName, sentAt, isGroup, senderId: `u-${senderName}` };
}

/** Phần text CUỐI của content - phần chữ mà `dongTinCuaLuot` dựng */
function chuCuaLuot(parts: { type: string; text?: string }[]): string {
  const text = parts.filter((p) => p.type === "text");
  return text[text.length - 1]!.text!;
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

/**
 * Tin của lượt ĐANG CHẠY phải render y hệt lịch sử: cùng nhãn giờ, cùng cách
 * dán tên. Lệch nhau đã gây lỗi thật - xem `user-message-line.ts`.
 */
describe("buildCurrentTurnContent - nhãn giờ và tên người gửi", () => {
  it("mỗi tin một dòng, có nhãn giờ lấy từ sentAt của CHÍNH tin đó", async () => {
    const parts = partsOf(
      await content.buildCurrentTurnContent(
        [msgTu("Hải", "chào bot", "2026-08-07T17:12:00.000Z", false)],
        "native",
      ),
    );
    assert.equal(chuCuaLuot(parts), "[08/08 00:12] Hải: chào bot");
  });

  it("BATCH NHIỀU NGƯỜI: mỗi dòng mang đúng tên người viết dòng đó", async () => {
    const parts = partsOf(
      await content.buildCurrentTurnContent(
        [
          msgTu("Hải", "bot ơi tra giúp giá vàng", "2026-08-07T17:12:00.000Z"),
          msgTu("Nam", "cho mình hỏi thêm tỉ giá USD", "2026-08-07T17:12:30.000Z"),
        ],
        "native",
      ),
    );

    assert.equal(
      chuCuaLuot(parts),
      "[08/08 00:12] Hải: bot ơi tra giúp giá vàng\n[08/08 00:12] Nam: cho mình hỏi thêm tỉ giá USD",
    );
  });

  it("lời của người trước KHÔNG bị gán cho người sau", async () => {
    // Bản cũ nối phẳng rồi dán tên tin CUỐI, cho ra "Nam: bot ơi tra giúp giá
    // vàng\ncho mình hỏi thêm tỉ giá USD" - đúng câu của Hải mang tên Nam.
    const chu = chuCuaLuot(
      partsOf(
        await content.buildCurrentTurnContent(
          [
            msgTu("Hải", "bot ơi tra giúp giá vàng", "2026-08-07T17:12:00.000Z"),
            msgTu("Nam", "cho mình hỏi thêm tỉ giá USD", "2026-08-07T17:12:30.000Z"),
          ],
          "native",
        ),
      ),
    );
    assert.doesNotMatch(chu, /Nam: bot ơi tra giúp giá vàng/);
    assert.match(chu, /Hải: bot ơi tra giúp giá vàng/);
  });

  it("chat riêng cũng có nhãn giờ và tên - khớp đúng cách lịch sử dựng", async () => {
    const sentAt = "2026-08-07T17:12:00.000Z";
    const luot = chuCuaLuot(
      partsOf(await content.buildCurrentTurnContent([msgTu("Hải", "chào bot", sentAt, false)], "native")),
    );
    // Chính tin đó ở lượt SAU, khi đã nằm trong lịch sử
    const trongLichSu = history.historyToModelMessages(
      [{ role: "user", content: "chào bot", senderName: "Hải", createdAt: sentAt }],
      0,
      () => null,
      tuning.botTimeZone(),
    )[0]!.content;

    assert.equal(luot, trongLichSu, "cùng một tin phải render y hệt ở hai đường");
  });

  it("tin chỉ có ảnh vẫn có nhãn giờ và một câu mô tả, không phải dòng trống", async () => {
    const parts = partsOf(
      await content.buildCurrentTurnContent(
        [{ ...msgTu("Hải", "", "2026-08-07T17:12:00.000Z"), images: [{ url: "http://x/0.jpg" }] }],
        "blind",
      ),
    );
    assert.equal(chuCuaLuot(parts), "[08/08 00:12] Hải: (gửi ảnh, không kèm chữ)");
  });

  it("nhãn giờ theo BOT_TIMEZONE trên dashboard, không phải giờ máy chạy bot", async () => {
    const goc = process.env.TZ;
    try {
      process.env.TZ = "UTC"; // đúng cấu hình container node:24-alpine
      tuning.setTuning("BOT_TIMEZONE", "Asia/Tokyo");
      const nhat = chuCuaLuot(
        partsOf(
          await content.buildCurrentTurnContent([msgTu("Hải", "x", "2026-08-07T17:12:00.000Z", false)], "native"),
        ),
      );
      assert.equal(nhat, "[08/08 02:12] Hải: x", "phải theo Tokyo (UTC+9), không theo TZ tiến trình");

      tuning.setTuning("BOT_TIMEZONE", "Asia/Ho_Chi_Minh");
      const viet = chuCuaLuot(
        partsOf(
          await content.buildCurrentTurnContent([msgTu("Hải", "x", "2026-08-07T17:12:00.000Z", false)], "native"),
        ),
      );
      assert.equal(viet, "[08/08 00:12] Hải: x");
    } finally {
      tuning.setTuning("BOT_TIMEZONE", null);
      if (goc === undefined) delete process.env.TZ;
      else process.env.TZ = goc;
    }
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
