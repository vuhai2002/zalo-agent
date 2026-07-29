import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "./test-env-setup.js";

/**
 * Test hồi quy cho một lỗi đã lọt ra tận lượt thật.
 *
 * `mixin` của pino KHÔNG được trả về object dùng chung: `defaultMixinMergeStrategy`
 * (`pino/lib/proto.js`) làm `Object.assign(mixinObject, mergeObject)`, tức là nó
 * ghi đè vào chính object mình trả về. Trả thẳng object trong AsyncLocalStorage
 * thì mỗi dòng log lại nhét trường của nó vào đó vĩnh viễn - đo trên lượt 66:
 * một dòng `web-fetch` phình lên 28 trường, mang theo cả `text`, `reasoning`,
 * `toolResults` của những dòng trước đó.
 *
 * Đây là file test DUY NHẤT bật ghi log ra file (`LOG_FILE_ENABLED`), vì chính
 * dòng ghi ra file là thứ cần kiểm - không có cách nào soi nó từ trong tiến trình.
 */

let dataDir: string;
let logger: typeof import("./logger.js");
let turnCtx: typeof import("./turn-log-context.js");

before(async () => {
  dataDir = setupTestEnv({ LOG_FILE_ENABLED: "true", LOG_LEVEL: "error" });
  logger = await import("./logger.js");
  turnCtx = await import("./turn-log-context.js");
});

after(async () => {
  (await import("../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

/** Chờ worker pino-roll xả xuống đĩa rồi đọc lại các dòng JSON */
async function docLog(soDongCho: number): Promise<Record<string, unknown>[]> {
  const thuMuc = path.join(dataDir, "logs");
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const files = fs.existsSync(thuMuc) ? fs.readdirSync(thuMuc) : [];
    if (files.length === 0) continue;
    const dong = fs
      .readFileSync(path.join(thuMuc, files[0]!), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    if (dong.length >= soDongCho) return dong;
  }
  throw new Error(`không thấy đủ ${soDongCho} dòng log sau 2 giây`);
}

describe("logger - trường của lượt bám vào log", () => {
  it("mỗi dòng chỉ mang trường của CHÍNH nó, không tích lũy của dòng trước", async () => {
    const log = logger.createLogger("gia-lap-tool");

    await turnCtx.runInTurnLogContext({ accountId: "acc-1", threadId: "t-1", turnId: 99 }, async () => {
      log.error({ text: "model nói dài dòng", toolResults: ["nội dung trang web"] }, "dòng một");
      await new Promise((r) => setTimeout(r, 5));
      log.error({ url: "https://vi.du" }, "dòng hai");
    });

    const dong = await docLog(2);
    const hai = dong.find((d) => d.msg === "dòng hai")!;

    assert.equal(hai.turnId, 99, "vẫn phải có trường của lượt");
    assert.equal(hai.url, "https://vi.du");
    assert.equal(hai.text, undefined, "text của dòng trước KHÔNG được dính sang");
    assert.equal(hai.toolResults, undefined, "toolResults của dòng trước KHÔNG được dính sang");
  });

  it("object ngữ cảnh trong AsyncLocalStorage không bị pino ghi đè", async () => {
    await turnCtx.runInTurnLogContext({ accountId: "acc-2", threadId: "t-2", turnId: 100 }, async () => {
      logger.createLogger("x").error({ raiRac: "abc" }, "có ghi gì đó");
      await new Promise((r) => setTimeout(r, 5));
      assert.deepEqual(
        turnCtx.currentTurnLogContext(),
        { accountId: "acc-2", threadId: "t-2", turnId: 100 },
        "ngữ cảnh phải nguyên vẹn - phình ra là mọi dòng sau đều mang rác",
      );
    });
  });
});
