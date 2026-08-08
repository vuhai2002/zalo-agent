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

describe("buildTurnMessages - lọc tin của chính lượt ra khỏi lịch sử", () => {
  const lichSu = (id: number, noiDung: string) => ({
    id,
    role: "user" as const,
    content: noiDung,
    senderName: "Hải",
    createdAt: "2026-08-07T17:12:00.000Z",
  });

  const chuCuaTinNhan = (messages: { content: unknown }[]) =>
    messages.map((m) =>
      typeof m.content === "string"
        ? m.content
        : (m.content as { type: string; text?: string }[])
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("\n"),
    );

  it("dòng lịch sử trùng id với tin của batch bị bỏ - model không đọc hai lần", async () => {
    const tin = { ...msgTu("Hải", "cho mình bảng giá", "2026-08-07T17:12:00.000Z", false), historyRowId: 7 };
    const { messages } = await content.buildTurnMessages({
      history: [lichSu(5, "câu cũ"), lichSu(7, "cho mình bảng giá")],
      batch: [tin],
      tranToken: 0,
    });

    const chu = chuCuaTinNhan(messages);
    assert.equal(chu.filter((c) => c.includes("cho mình bảng giá")).length, 1);
    assert.ok(chu.some((c) => c.includes("câu cũ")), "tin cũ vẫn phải còn");
  });

  it("lọc theo ID chứ không theo nội dung - câu cũ giống hệt vẫn giữ", async () => {
    const tin = { ...msgTu("Hải", "giá vàng hôm nay", "2026-08-07T17:12:00.000Z", false), historyRowId: 9 };
    const { messages } = await content.buildTurnMessages({
      history: [lichSu(5, "giá vàng hôm nay"), lichSu(9, "giá vàng hôm nay")],
      batch: [tin],
      tranToken: 0,
    });

    assert.equal(
      chuCuaTinNhan(messages).filter((c) => c.includes("giá vàng hôm nay")).length,
      2,
      "một lần là câu cũ trong lịch sử, một lần là câu đang hỏi",
    );
  });

  it("batch chưa có historyRowId thì KHÔNG lọc gì - giữ nguyên hành vi cũ", async () => {
    const tin = msgTu("Hải", "chào bot", "2026-08-07T17:12:00.000Z", false);
    const { messages } = await content.buildTurnMessages({
      history: [lichSu(5, "câu cũ")],
      batch: [tin],
      tranToken: 0,
    });

    assert.equal(chuCuaTinNhan(messages).filter((c) => c.includes("câu cũ")).length, 1);
  });

  it("`idBoQua` loại tin ĐANG CHỜ khỏi lịch sử - nó sẽ được chèn kèm nhãn tin chen", async () => {
    // Không loại thì model đọc cùng một yêu cầu hai lần: một lần lẫn trong lịch
    // sử, một lần dưới nhãn "[Vừa có tin nhắn mới ... trong lúc bạn đang làm dở]".
    const tin = { ...msgTu("Hải", "soạn giúp bài giảng", "2026-08-07T17:12:00.000Z", false), historyRowId: 7 };
    const { messages } = await content.buildTurnMessages({
      history: [lichSu(7, "soạn giúp bài giảng"), lichSu(8, "à mà xuất ra Word nhé")],
      batch: [tin],
      idBoQua: [8],
      tranToken: 0,
    });

    const chu = chuCuaTinNhan(messages);
    assert.equal(chu.filter((c) => c.includes("xuất ra Word")).length, 0, "tin đang chờ không thuộc lịch sử lượt này");
  });

  it("bước mô tả ảnh chạy trên CÙNG danh sách với phần render", async () => {
    // Hai bên chạy trên hai danh sách khác nhau là ngân sách mô tả rơi vào ảnh
    // của chính lượt này, ảnh cũ không bao giờ được mô tả, mà chế độ `describe`
    // cũng bỏ luôn pixel - dòng đó xuống model thành chữ trần, không dấu vết
    // nào của tấm ảnh. Hỏng CÂM, không log, không note.
    const daXinMoTa: string[][] = [];
    const cuaBatch = { ...lichSu(20, "ảnh của lượt này [gửi kèm 1 ảnh]"), images: ["media/a/t/moi-0.jpg"] };
    const cu = { ...lichSu(10, "ảnh cũ [gửi kèm 1 ảnh]"), images: ["media/a/t/cu-0.jpg"] };

    await content.buildTurnMessages({
      history: [cu, cuaBatch],
      batch: [{ ...msgTu("Hải", "xem giúp", "2026-08-07T17:12:00.000Z", false), historyRowId: 20 }],
      forceMode: "describe",
      tranToken: 0,
      moTaTruoc: async (paths) => {
        daXinMoTa.push(paths);
      },
    });

    assert.deepEqual(
      daXinMoTa[0],
      ["media/a/t/cu-0.jpg"],
      "ảnh của chính lượt này đã có pixel trong nội dung lượt - xin mô tả cho nó là tiêu mất ngân sách của ảnh cũ",
    );
  });

  it("CẮT LẠI sau khi lọc: batch to không được làm teo cửa sổ lịch sử", async () => {
    // Ca đắt nhất của cả bản vá. `getRecentMessages` trả N tin MỚI NHẤT, mà tin
    // của batch nằm ngay trong số đó. Lọc rồi không cắt lại là cửa sổ 20 tin
    // teo xuống 15 với batch 5 tin, và xuống 0 khi batch chạm trần 32 tin -
    // bot bước vào lượt mà không biết mình vừa trả lời gì. Hỏng CÂM.
    const TRAN = 20;
    const soTinBatch = 5;

    // Caller đọc DƯ đúng bằng cỡ batch, y như `agent-loop.ts` làm
    const cu = Array.from({ length: TRAN }, (_, i) => lichSu(100 + i, `tin cũ ${i}`));
    const cuaBatch = Array.from({ length: soTinBatch }, (_, i) => lichSu(200 + i, `câu mới ${i}`));
    const batch = Array.from({ length: soTinBatch }, (_, i) => ({
      ...msgTu("Hải", `câu mới ${i}`, "2026-08-07T17:12:00.000Z", false),
      historyRowId: 200 + i,
    }));

    const { messages } = await content.buildTurnMessages({
      history: [...cu, ...cuaBatch],
      batch,
      tranLichSu: TRAN,
      tranToken: 0,
    });

    // Trừ 1 tin cuối là nội dung của chính lượt này
    const soTinLichSu = messages.length - 1;
    assert.equal(soTinLichSu, TRAN, `mong ${TRAN} tin cũ, nhận ${soTinLichSu}`);
    assert.ok(
      chuCuaTinNhan(messages).some((c) => c.includes("tin cũ 0")),
      "tin cũ nhất trong cửa sổ vẫn phải còn",
    );
  });

  it("lọc HỤT vẫn không được vượt trần - cắt bỏ tin CŨ NHẤT, giữ tin gần nhất", async () => {
    // Caller xin dư theo cỡ batch, nhưng không phải tin nào cũng có dòng trong
    // cửa sổ vừa đọc (tin chưa kịp ghi, hoặc dòng đã trôi khỏi cửa sổ). Lúc đó
    // lọc bỏ được ÍT hơn phần xin dư và kết quả vượt trần - phải cắt lại, và
    // cắt ở đầu CŨ để giữ phần gần nhất.
    const TRAN = 3;
    const { messages } = await content.buildTurnMessages({
      history: [lichSu(1, "cũ nhất"), lichSu(2, "cũ nhì"), lichSu(3, "giữa"), lichSu(4, "gần"), lichSu(5, "của lượt")],
      // Chỉ MỘT trong hai id được xin dư là có thật trong cửa sổ
      batch: [{ ...msgTu("Hải", "câu đang hỏi", "2026-08-07T17:12:00.000Z", false), historyRowId: 5 }],
      idBoQua: [999],
      tranLichSu: TRAN,
      tranToken: 0,
    });

    const chu = chuCuaTinNhan(messages);
    assert.equal(messages.length - 1, TRAN, `mong đúng ${TRAN} tin lịch sử, nhận ${messages.length - 1}`);
    assert.ok(!chu.some((c) => c.includes("cũ nhất")), "phải cắt từ đầu CŨ");
    assert.ok(chu.some((c) => c.includes("gần")), "tin gần nhất phải giữ");
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
