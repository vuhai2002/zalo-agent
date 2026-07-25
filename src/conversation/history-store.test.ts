import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

// history-store mở SQLite ngay lúc import theo DATA_DIR trong env, nên phải
// setupTestEnv() (trỏ vào thư mục tạm) rồi mới import động.
const MAX_PER_THREAD = 25;

let dataDir: string;
let store: typeof import("./history-store.js");

before(async () => {
  dataDir = setupTestEnv({
    HISTORY_MAX_MESSAGES_PER_THREAD: String(MAX_PER_THREAD),
    HISTORY_CONTEXT_LIMIT: "20",
  });
  store = await import("./history-store.js");
});

after(() => {
  store.closeHistoryStore();
  cleanupTestEnv(dataDir);
});

/** Đọc toàn bộ tin còn lại của thread - limit lớn hơn cap để thấy cả phần thừa */
function readAll(accountId: string, threadId: string) {
  return store.getRecentMessages(accountId, threadId, MAX_PER_THREAD * 10);
}

describe("history-store", () => {
  it("trả tin theo thứ tự thời gian cũ -> mới", () => {
    store.appendMessage("acc-1", "t-thutu", { role: "user", content: "một", senderName: "Hải" });
    store.appendMessage("acc-1", "t-thutu", { role: "assistant", content: "hai" });
    store.appendMessage("acc-1", "t-thutu", { role: "user", content: "ba", senderName: "Hải" });

    const rows = readAll("acc-1", "t-thutu");
    assert.deepEqual(rows.map((r) => r.content), ["một", "hai", "ba"]);
    assert.deepEqual(rows.map((r) => r.role), ["user", "assistant", "user"]);
  });

  it("giữ senderName của user, để trống với assistant", () => {
    store.appendMessage("acc-1", "t-ten", { role: "user", content: "hỏi", senderName: "Minh Triết" });
    store.appendMessage("acc-1", "t-ten", { role: "assistant", content: "đáp" });

    const rows = readAll("acc-1", "t-ten");
    assert.equal(rows[0]!.senderName, "Minh Triết");
    assert.equal(rows[1]!.senderName, undefined);
  });

  it("limit lấy đúng N tin mới nhất chứ không phải N tin đầu", () => {
    for (let i = 1; i <= 10; i++) {
      store.appendMessage("acc-1", "t-limit", { role: "user", content: `tin-${i}` });
    }

    const rows = store.getRecentMessages("acc-1", "t-limit", 3);
    assert.deepEqual(rows.map((r) => r.content), ["tin-8", "tin-9", "tin-10"]);
  });

  it("prune giữ đúng cap tin mới nhất khi thread vượt giới hạn", () => {
    const total = MAX_PER_THREAD + 15;
    for (let i = 1; i <= total; i++) {
      store.appendMessage("acc-1", "t-prune", { role: "user", content: `tin-${i}` });
    }

    const rows = readAll("acc-1", "t-prune");
    assert.equal(rows.length, MAX_PER_THREAD);
    // Phần bị xóa phải là phần cũ nhất
    assert.equal(rows[0]!.content, `tin-${total - MAX_PER_THREAD + 1}`);
    assert.equal(rows[rows.length - 1]!.content, `tin-${total}`);
  });

  it("thread chưa đủ cap thì không bị xóa gì", () => {
    for (let i = 1; i <= 5; i++) {
      store.appendMessage("acc-1", "t-it", { role: "user", content: `tin-${i}` });
    }

    assert.equal(readAll("acc-1", "t-it").length, 5);
  });

  it("prune chỉ đụng thread vừa ghi, không đụng thread khác", () => {
    store.appendMessage("acc-1", "t-yen", { role: "user", content: "để yên" });

    for (let i = 1; i <= MAX_PER_THREAD + 10; i++) {
      store.appendMessage("acc-1", "t-on", { role: "user", content: `tin-${i}` });
    }

    assert.equal(readAll("acc-1", "t-yen").length, 1);
    assert.equal(readAll("acc-1", "t-on").length, MAX_PER_THREAD);
  });

  it("thread trùng id ở account khác được tính riêng", () => {
    store.appendMessage("acc-1", "t-chung", { role: "user", content: "của acc-1" });
    store.appendMessage("acc-2", "t-chung", { role: "user", content: "của acc-2" });

    const acc1 = readAll("acc-1", "t-chung");
    const acc2 = readAll("acc-2", "t-chung");
    assert.deepEqual(acc1.map((r) => r.content), ["của acc-1"]);
    assert.deepEqual(acc2.map((r) => r.content), ["của acc-2"]);
  });

  it("images ghi kèm tin thì đọc lại nguyên vẹn, tin không ảnh trả undefined", () => {
    store.appendMessage("acc-1", "t-anh", {
      role: "user",
      content: "xem ảnh [gửi kèm 2 ảnh]",
      images: ["media/acc-1/t-anh/m1-0.jpg", "media/acc-1/t-anh/m1-1.png"],
    });
    store.appendMessage("acc-1", "t-anh", { role: "assistant", content: "ảnh đẹp" });

    const rows = readAll("acc-1", "t-anh");
    assert.deepEqual(rows[0]!.images, [
      "media/acc-1/t-anh/m1-0.jpg",
      "media/acc-1/t-anh/m1-1.png",
    ]);
    assert.equal(rows[1]!.images, undefined);
  });

  it("setMessageImages gắn ảnh vào tin đã ghi qua id (passive listen tải ảnh xong muộn)", () => {
    const rowId = store.appendMessage("acc-1", "t-muon", {
      role: "user",
      content: "[ảnh]",
    });
    store.setMessageImages(rowId, ["media/acc-1/t-muon/m9-0.webp"]);

    const rows = readAll("acc-1", "t-muon");
    assert.deepEqual(rows[0]!.images, ["media/acc-1/t-muon/m9-0.webp"]);
  });

  it("images cũng có trong listMessagesPaged (dashboard)", () => {
    store.appendMessage("acc-1", "t-paged", {
      role: "user",
      content: "[ảnh]",
      images: ["media/acc-1/t-paged/m2-0.jpg"],
    });

    const rows = store.listMessagesPaged("acc-1", "t-paged");
    assert.deepEqual(rows[0]!.images, ["media/acc-1/t-paged/m2-0.jpg"]);
  });
});
