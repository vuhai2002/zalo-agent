import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ThreadType } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let indicator: typeof import("./typing-indicator.js");

before(async () => {
  dataDir = setupTestEnv();
  indicator = await import("./typing-indicator.js");
});

after(async () => {
  // Đọc cấu hình chỉnh-nóng nên module này mở SQLite - không đóng thì
  // Windows chặn xóa thư mục tạm (EPERM)
  (await import("../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Ghi lại mọi lần bắn typing; resolveWith cho phép mô phỏng lỗi mạng */
function recorder(shouldFail = false) {
  const calls: { threadId: string; threadType: ThreadType }[] = [];
  return {
    calls,
    send: async (threadId: string, threadType: ThreadType) => {
      calls.push({ threadId, threadType });
      if (shouldFail) throw new Error("mạng rớt");
      return { status: 0 };
    },
  };
}

describe("typing-indicator", () => {
  it("bắn ngay lập tức, không đợi hết chu kỳ đầu", () => {
    const rec = recorder();
    const stop = indicator.startTypingIndicator({
      send: rec.send,
      threadId: "t-1",
      threadType: ThreadType.User,
      intervalMs: 1000,
    });

    assert.equal(rec.calls.length, 1, "phải bắn ngay khi bắt đầu");
    assert.deepEqual(rec.calls[0], { threadId: "t-1", threadType: ThreadType.User });
    stop();
  });

  it("lặp lại theo chu kỳ vì Zalo không có API tắt chỉ báo", async () => {
    const rec = recorder();
    const stop = indicator.startTypingIndicator({
      send: rec.send,
      threadId: "t-lap",
      threadType: ThreadType.Group,
      intervalMs: 25,
    });

    await sleep(90); // đủ cho lần bắn đầu + ~3 lần lặp
    stop();
    assert.ok(rec.calls.length >= 3, `phải lặp nhiều lần, thực tế ${rec.calls.length}`);
    assert.ok(rec.calls.every((c) => c.threadType === ThreadType.Group));
  });

  it("stop dừng hẳn, không bắn thêm lần nào", async () => {
    const rec = recorder();
    const stop = indicator.startTypingIndicator({
      send: rec.send,
      threadId: "t-stop",
      threadType: ThreadType.User,
      intervalMs: 20,
    });

    await sleep(50);
    stop();
    const afterStop = rec.calls.length;

    await sleep(80);
    assert.equal(rec.calls.length, afterStop, "sau stop không được bắn thêm");
  });

  it("gọi stop nhiều lần không lỗi", async () => {
    const rec = recorder();
    const stop = indicator.startTypingIndicator({
      send: rec.send,
      threadId: "t-stop-2",
      threadType: ThreadType.User,
      intervalMs: 20,
    });
    stop();
    assert.doesNotThrow(() => {
      stop();
      stop();
    });
    await sleep(50);
    assert.equal(rec.calls.length, 1);
  });

  it("lỗi khi bắn bị nuốt và vẫn lặp tiếp - chỉ báo hỏng không được chết lượt trả lời", async () => {
    const rec = recorder(true); // mọi lần bắn đều throw
    let unhandled: unknown = null;
    const onUnhandled = (err: unknown) => (unhandled = err);
    process.on("unhandledRejection", onUnhandled);

    const stop = indicator.startTypingIndicator({
      send: rec.send,
      threadId: "t-loi",
      threadType: ThreadType.User,
      intervalMs: 20,
    });
    await sleep(70);
    stop();
    process.off("unhandledRejection", onUnhandled);

    assert.equal(unhandled, null, "không được để promise lỗi lọt ra ngoài");
    assert.ok(rec.calls.length >= 2, "lỗi rồi vẫn phải thử lại lượt sau");
  });

  it("chốt chặn maxDuration tự tắt khi caller quên gọi stop", async () => {
    const rec = recorder();
    indicator.startTypingIndicator({
      send: rec.send,
      threadId: "t-treo",
      threadType: ThreadType.User,
      intervalMs: 20,
      maxDurationMs: 45,
    });

    await sleep(70);
    const atGuard = rec.calls.length;
    await sleep(80);
    assert.equal(rec.calls.length, atGuard, "quá maxDuration phải tự dừng");
  });
});
