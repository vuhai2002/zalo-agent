import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

// Kịch bản nâng cấp: DB đã có messages (bản cũ) nhưng threads/contacts trống.
// File test này chạy process riêng nên DB không dính dữ liệu từ test khác.
let dataDir: string;
let history: typeof import("./history-store.js");
let threads: typeof import("./thread-store.js");
let contacts: typeof import("./contact-store.js");

before(async () => {
  dataDir = setupTestEnv();
  history = await import("./history-store.js");
  threads = await import("./thread-store.js");
  contacts = await import("./contact-store.js");

  // Chat riêng: 1 người nhắn qua lại với bot
  history.appendMessage("acc-1", "111", { role: "user", content: "hi", senderName: "Hải" });
  history.appendMessage("acc-1", "111", { role: "assistant", content: "chào" });
  history.appendMessage("acc-1", "111", { role: "user", content: "khỏe không", senderName: "Hải" });
  // Group: nhiều người nhắn (2 sender khác nhau) - không được backfill thành contact
  history.appendMessage("acc-1", "999", { role: "user", content: "a", senderName: "Nam" });
  history.appendMessage("acc-1", "999", { role: "user", content: "b", senderName: "Lan" });
});

after(() => {
  history.closeHistoryStore();
  cleanupTestEnv(dataDir);
});

describe("startup-backfill", () => {
  it("dựng threads từ messages: đủ thread, đúng count và tên", () => {
    const created = threads.backfillThreadsFromMessages();
    assert.equal(created, 2);

    const direct = threads.listThreads({ accountId: "acc-1", query: "111" })[0]!;
    assert.equal(direct.messageCount, 3);
    assert.equal(direct.displayName, "Hải");
    assert.equal(direct.botEnabled, true);

    const group = threads.listThreads({ accountId: "acc-1", query: "999" })[0]!;
    assert.equal(group.messageCount, 2);
  });

  it("dựng contacts chỉ từ thread chat riêng (group cũ không có sender_id)", () => {
    const created = contacts.backfillContactsFromDirectMessages();
    assert.equal(created, 1);

    const rows = contacts.listContacts({ accountId: "acc-1" });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.userId, "111"); // chat riêng: thread_id = user_id đối phương
    assert.equal(rows[0]!.displayName, "Hải");
    assert.equal(rows[0]!.messageCount, 2); // chỉ đếm tin user, không đếm tin bot
  });

  it("chạy lại lần 2 là no-op", () => {
    assert.equal(threads.backfillThreadsFromMessages(), 0);
    assert.equal(contacts.backfillContactsFromDirectMessages(), 0);
  });
});
