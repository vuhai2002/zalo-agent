import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let content: typeof import("./agent-turn-content.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  content = await import("./agent-turn-content.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

function msgWithImages(text: string, imageCount: number): ParsedMessage {
  return {
    accountId: "acc",
    threadId: "t1",
    threadType: 0,
    isGroup: false,
    senderId: "u1",
    senderName: "Hải",
    text,
    // URL không bao giờ được chạm tới ở blind mode; describe mode thì localPath
    // thiếu -> thử tải, nên test describe chỉ dùng blind-safe path (xem dưới)
    images: Array.from({ length: imageCount }, (_, i) => ({ url: `http://x/${i}.jpg` })),
    msgId: "m1",
    cliMsgId: "c1",
    isSelf: false,
    mentionsMe: false,
    rawData: {},
  };
}

function textParts(parts: unknown): string[] {
  return (parts as { type: string; text?: string }[])
    .filter((p) => p.type === "text")
    .map((p) => p.text!);
}

describe("buildCurrentTurnContent", () => {
  it("blind: không tải ảnh, chèn 1 ghi chú tổng dặn bot nói thật", async () => {
    const parts = await content.buildCurrentTurnContent([msgWithImages("dò giúp em", 2)], "blind");
    const texts = textParts(parts);

    assert.equal((parts as unknown[]).length, 2, "1 ghi chú ảnh + 1 text chính");
    assert.match(texts[0]!, /gửi kèm 2 ảnh nhưng bạn KHÔNG xem được/);
    assert.match(texts[1]!, /dò giúp em/);
  });

  it("blind: tin không có ảnh thì không chèn ghi chú", async () => {
    const parts = await content.buildCurrentTurnContent([msgWithImages("chào", 0)], "blind");
    assert.equal((parts as unknown[]).length, 1);
    assert.match(textParts(parts)[0]!, /chào/);
  });
});
