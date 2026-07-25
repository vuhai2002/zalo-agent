import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

// Store mở SQLite lúc import theo DATA_DIR -> setupTestEnv trước, import động sau
let dataDir: string;
let threads: typeof import("./thread-store.js");
let history: typeof import("./history-store.js");

before(async () => {
  dataDir = setupTestEnv();
  threads = await import("./thread-store.js");
  history = await import("./history-store.js");
});

after(() => {
  history.closeHistoryStore();
  cleanupTestEnv(dataDir);
});

const activity = (threadId: string, overrides: Record<string, string> = {}) => ({
  accountId: "acc-1",
  threadId,
  threadType: 0,
  displayName: overrides.displayName ?? "Hải",
  lastSenderName: overrides.lastSenderName ?? "Hải",
});

describe("thread-store", () => {
  it("upsert tạo thread mới rồi tăng message_count các lần sau", () => {
    threads.recordThreadActivity(activity("t-dem"));
    threads.recordThreadActivity(activity("t-dem"));
    threads.recordThreadActivity(activity("t-dem"));

    const rows = threads.listThreads({ accountId: "acc-1", query: "t-dem" });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.messageCount, 3);
    assert.equal(rows[0]!.displayName, "Hải");
  });

  it("displayName rỗng không ghi đè tên đã có", () => {
    threads.recordThreadActivity(activity("t-ten", { displayName: "Nhóm Gia Đình" }));
    threads.recordThreadActivity(activity("t-ten", { displayName: "" }));

    const rows = threads.listThreads({ accountId: "acc-1", query: "t-ten" });
    assert.equal(rows[0]!.displayName, "Nhóm Gia Đình");
  });

  it("thread chưa từng thấy mặc định bot bật", () => {
    assert.equal(threads.isBotEnabled("acc-1", "t-chua-co"), true);
  });

  it("tắt rồi bật lại bot cho thread", () => {
    threads.recordThreadActivity(activity("t-toggle"));

    assert.equal(threads.setBotEnabled("acc-1", "t-toggle", false), true);
    assert.equal(threads.isBotEnabled("acc-1", "t-toggle"), false);

    assert.equal(threads.setBotEnabled("acc-1", "t-toggle", true), true);
    assert.equal(threads.isBotEnabled("acc-1", "t-toggle"), true);
  });

  it("setBotEnabled trả false với thread không tồn tại", () => {
    assert.equal(threads.setBotEnabled("acc-1", "t-khong-ton-tai", false), false);
  });

  it("hasDisplayName + setThreadDisplayName cho group lấy tên async", () => {
    threads.recordThreadActivity({ ...activity("t-group"), displayName: "" });
    assert.equal(threads.hasDisplayName("acc-1", "t-group"), false);

    threads.setThreadDisplayName("acc-1", "t-group", "Nhóm Dev");
    assert.equal(threads.hasDisplayName("acc-1", "t-group"), true);
  });

  it("backfill dựng threads từ messages cũ, không chạy lại khi đã có dữ liệu", () => {
    // threads đã có dữ liệu từ các test trên -> backfill phải no-op
    assert.equal(threads.backfillThreadsFromMessages(), 0);
  });
});
