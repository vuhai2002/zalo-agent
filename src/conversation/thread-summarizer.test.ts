import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

// window = 5, trigger = 6 để test không phải bơm hàng chục tin
const WINDOW = 5;
const TRIGGER = 6;

let dataDir: string;
let history: typeof import("./history-store.js");
let threads: typeof import("./thread-store.js");
let summarizer: typeof import("./thread-summarizer.js");

before(async () => {
  dataDir = setupTestEnv({
    HISTORY_CONTEXT_LIMIT: String(WINDOW),
    SUMMARY_TRIGGER_MESSAGES: String(TRIGGER),
    HISTORY_MAX_MESSAGES_PER_THREAD: "500",
  });
  history = await import("./history-store.js");
  threads = await import("./thread-store.js");
  summarizer = await import("./thread-summarizer.js");
});

after(() => {
  history.closeHistoryStore();
  cleanupTestEnv(dataDir);
});

function seedThread(threadId: string, count: number): void {
  threads.recordThreadActivity({
    accountId: "acc-1",
    threadId,
    threadType: 0,
    displayName: "Hải",
    lastSenderName: "Hải",
  });
  for (let i = 1; i <= count; i++) {
    history.appendMessage("acc-1", threadId, { role: "user", content: `tin-${i}`, senderName: "Hải" });
  }
}

describe("thread-summarizer", () => {
  it("backlog = tin ngoài cửa sổ replay chưa được summary phủ", () => {
    seedThread("t-backlog", 12); // 12 tin, window 5 -> 7 tin ngoài window
    const { backlog } = summarizer.collectSummaryBacklog("acc-1", "t-backlog");
    assert.equal(backlog.length, 7);
    assert.equal(backlog[0]!.content, "tin-1");
    assert.equal(backlog[6]!.content, "tin-7");
  });

  it("chưa đủ trigger thì không gọi LLM", async () => {
    seedThread("t-it", WINDOW + 2); // backlog 2 < trigger 6
    let called = 0;
    const ran = await summarizer.maybeSummarizeThread("acc-1", "t-it", async () => {
      called++;
      return "summary";
    });
    assert.equal(ran, false);
    assert.equal(called, 0);
  });

  it("đủ trigger: gộp backlog vào summary, prompt chứa summary cũ + tin mới", async () => {
    seedThread("t-gop", 12);
    threads.setThreadSummary("acc-1", "t-gop", "Summary cũ: đã bàn về X", 0);

    let receivedPrompt = "";
    const ran = await summarizer.maybeSummarizeThread("acc-1", "t-gop", async (prompt) => {
      receivedPrompt = prompt;
      return "Summary mới sau khi gộp";
    });

    assert.equal(ran, true);
    assert.ok(receivedPrompt.includes("Summary cũ: đã bàn về X"));
    assert.ok(receivedPrompt.includes("tin-1"));
    assert.ok(receivedPrompt.includes("tin-7"));
    assert.ok(!receivedPrompt.includes("tin-8"), "tin trong window không được đem đi tóm tắt");

    const { summary, coversTo } = threads.getThreadSummary("acc-1", "t-gop");
    assert.equal(summary, "Summary mới sau khi gộp");
    assert.ok(coversTo > 0);
  });

  it("lần sau chỉ gộp phần mới, không tóm tắt lại từ đầu", async () => {
    // t-gop đã covers tới tin-7; thêm 8 tin nữa -> backlog mới bắt đầu từ tin-8
    for (let i = 13; i <= 20; i++) {
      history.appendMessage("acc-1", "t-gop", { role: "user", content: `tin-${i}`, senderName: "Hải" });
    }
    let receivedPrompt = "";
    const ran = await summarizer.maybeSummarizeThread("acc-1", "t-gop", async (prompt) => {
      receivedPrompt = prompt;
      return "Summary lần 2";
    });

    assert.equal(ran, true);
    assert.ok(!receivedPrompt.includes("tin-7\n"), "phần đã phủ không được gộp lại");
    assert.ok(receivedPrompt.includes("tin-8"));
    assert.ok(receivedPrompt.includes("Summary mới sau khi gộp"), "summary cũ phải là đầu vào");
  });

  it("LLM lỗi thì nuốt, không throw, summary giữ nguyên", async () => {
    const before = threads.getThreadSummary("acc-1", "t-gop").summary;
    const ran = await summarizer.maybeSummarizeThread("acc-1", "t-gop", async () => {
      throw new Error("router chết");
    });
    assert.equal(ran, false);
    assert.equal(threads.getThreadSummary("acc-1", "t-gop").summary, before);
  });
});
