import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ThreadType } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";

// message-batcher import src/config/env.ts (module đó process.exit khi env thiếu),
// nên phải setupTestEnv() rồi mới import động.
let dataDir: string;
let batcher: typeof import("./message-batcher.js");

before(async () => {
  dataDir = setupTestEnv();
  batcher = await import("./message-batcher.js");
});

after(() => {
  batcher.clearPendingBatches();
  cleanupTestEnv(dataDir);
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function makeMessage(text: string): ParsedMessage {
  return {
    accountId: "acc-test",
    threadId: "thread-1",
    threadType: ThreadType.User,
    isGroup: false,
    senderId: "user-1",
    senderName: "Người dùng",
    text,
    images: [],
    msgId: `m-${text}`,
    cliMsgId: `c-${text}`,
    isSelf: false,
    mentionsMe: false,
    rawData: {},
  };
}

describe("message-batcher", () => {
  it("gộp các tin gần nhau cùng thread thành 1 lượt", async () => {
    const batches: ParsedMessage[][] = [];
    const handler = async (batch: ParsedMessage[]) => {
      batches.push(batch);
    };

    batcher.enqueueMessage("k-gop", makeMessage("a"), handler, 30);
    batcher.enqueueMessage("k-gop", makeMessage("b"), handler, 30);
    batcher.enqueueMessage("k-gop", makeMessage("c"), handler, 30);
    await sleep(90);

    assert.equal(batches.length, 1);
    assert.deepEqual(batches[0]!.map((m) => m.text), ["a", "b", "c"]);
  });

  it("thread khác nhau không bị gộp lẫn vào nhau", async () => {
    const batches: ParsedMessage[][] = [];
    const handler = async (batch: ParsedMessage[]) => {
      batches.push(batch);
    };

    batcher.enqueueMessage("k-t1", makeMessage("x"), handler, 30);
    batcher.enqueueMessage("k-t2", makeMessage("y"), handler, 30);
    await sleep(90);

    assert.equal(batches.length, 2);
    assert.deepEqual(batches.map((b) => b.length), [1, 1]);
  });

  it("tin mới đến trong lúc chờ sẽ reset đồng hồ debounce", async () => {
    const batches: ParsedMessage[][] = [];
    const handler = async (batch: ParsedMessage[]) => {
      batches.push(batch);
    };

    batcher.enqueueMessage("k-reset", makeMessage("a"), handler, 60);
    await sleep(40);
    batcher.enqueueMessage("k-reset", makeMessage("b"), handler, 60);

    // Mốc 70ms: nếu không reset thì lượt đầu đã chạy ở mốc 60ms
    await sleep(30);
    assert.equal(batches.length, 0);

    await sleep(60);
    assert.equal(batches.length, 1);
    assert.equal(batches[0]!.length, 2);
  });

  it("các lượt cùng thread chạy tuần tự, không chồng lấn", async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const handler = async (batch: ParsedMessage[]) => {
      const tag = batch[0]!.text;
      events.push(`start:${tag}`);
      if (tag === "A") await firstBlocked;
      events.push(`end:${tag}`);
    };

    batcher.enqueueMessage("k-tuantu", makeMessage("A"), handler, 20);
    await sleep(60);
    assert.deepEqual(events, ["start:A"], "lượt A phải đã chạy và đang bị chặn");

    batcher.enqueueMessage("k-tuantu", makeMessage("B"), handler, 20);
    await sleep(60);
    assert.deepEqual(events, ["start:A"], "lượt B phải xếp hàng, không chạy chồng lên A");

    releaseFirst();
    await sleep(60);
    assert.deepEqual(events, ["start:A", "end:A", "start:B", "end:B"]);
  });

  it("clearPendingBatches hủy tin đang chờ, handler không chạy", async () => {
    let called = false;
    batcher.enqueueMessage(
      "k-huy",
      makeMessage("z"),
      async () => {
        called = true;
      },
      30,
    );

    batcher.clearPendingBatches();
    await sleep(90);

    assert.equal(called, false);
  });
});
