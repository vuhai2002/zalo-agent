import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ThreadType, type API } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Test cho CỬA VÀO của mọi tin nhắn.
 *
 * Trọng tâm: tin nào cũng phải để lại dấu vết trong history, kể cả tin bot
 * không xử lý. Nhánh dễ mất nhất là tin bị hàng chờ gộp BỎ vì chạm trần - nó
 * không bao giờ tới `processBatch`, mà đó là nơi DUY NHẤT ghi history cho
 * nhánh có-trả-lời.
 *
 * `setupTestEnv()` phải chạy TRƯỚC mọi import chạm DB (luật ở CLAUDE.md), nên
 * mọi module dưới đây đều import động.
 */

let dataDir: string;
let router: typeof import("./incoming-message-router.js");
let batcher: typeof import("../middleware/message-batcher.js");
let history: typeof import("../conversation/history-store.js");
let accounts: typeof import("../config/account-store.js");

const ACC = "acc-router-test";
const SELF = "self-999";

before(async () => {
  dataDir = setupTestEnv();
  router = await import("./incoming-message-router.js");
  batcher = await import("../middleware/message-batcher.js");
  history = await import("../conversation/history-store.js");
  accounts = await import("../config/account-store.js");
  accounts.createAccount({ id: ACC, label: "Router test" });
});

after(async () => {
  batcher.clearPendingBatches();
  (await import("../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** API giả: mọi lệnh gửi ra Zalo đều nuốt êm, không chạm mạng */
const apiGia = {
  addReaction: async () => ({}),
  sendSeenEvent: async () => ({}),
  sendDeliveredEvent: async () => ({}),
  sendTypingEvent: async () => ({}),
  getGroupInfo: async () => ({}),
} as unknown as API;

function tinRaw(threadId: string, text: string, msgId: string) {
  return {
    threadId,
    type: ThreadType.User,
    isSelf: false,
    data: { content: text, uidFrom: "user-1", dName: "Hải", msgId, cliMsgId: `c-${msgId}` },
  };
}

function noiDungHistory(threadId: string): string[] {
  return history.getRecentMessages(ACC, threadId).map((m) => m.content);
}

describe("routeIncomingMessage - tin bị bỏ vì hàng chờ chạm trần", () => {
  it("vẫn vào history, để bot còn biết người ta đã nói gì", async () => {
    const threadId = "thread-tran-history";
    const threadKey = `${ACC}:${threadId}`;

    // Chiếm thread bằng một lượt chạy dài, y như lượt tạo tài liệu 249 giây
    let nha!: () => void;
    const bịChặn = new Promise<void>((resolve) => {
      nha = resolve;
    });
    void batcher.runOnThreadChain(threadKey, () => bịChặn);
    await sleep(10);

    // Đẩy quá trần: TRAN_TIN_DON tin lọt vào batch, 3 tin sau bị bỏ
    const soThua = 3;
    const tong = batcher.TRAN_TIN_DON + soThua;
    for (let i = 0; i < tong; i++) {
      router.routeIncomingMessage(ACC, apiGia, SELF, tinRaw(threadId, `tin-${i}`, `m${i}`));
    }

    // Lượt vẫn đang chạy nên batch chưa chốt, chưa tin nào của batch vào history.
    // Nhưng tin BỊ BỎ phải đã có mặt - đó là toàn bộ điểm của bản vá.
    const daGhi = noiDungHistory(threadId);
    assert.equal(
      daGhi.length,
      soThua,
      `chỉ ${soThua} tin bị bỏ được ghi ngay, nhận ${daGhi.length}`,
    );
    for (let i = 0; i < soThua; i++) {
      const text = `tin-${batcher.TRAN_TIN_DON + i}`;
      assert.ok(
        daGhi.some((c) => c.includes(text)),
        `tin bị bỏ "${text}" phải có trong history`,
      );
    }

    // Dọn batch đang đỗ TRƯỚC khi nhả chuỗi: nhả trước thì batch chạy thật,
    // `processBatch` gọi provider thật và test đi ra mạng ngoài.
    batcher.clearPendingBatches();
    nha();
    await sleep(30);
  });

  it("tin nằm trong trần KHÔNG bị ghi hai lần", async () => {
    // Đối chứng: nếu ghi cả tin lọt batch ở router thì mọi tin sẽ vào history
    // hai lần (một lần ở đây, một lần ở `processBatch`) và model đọc thấy
    // người dùng lặp lại y hệt mọi câu.
    const threadId = "thread-khong-trung";

    router.routeIncomingMessage(ACC, apiGia, SELF, tinRaw(threadId, "chào bot", "m-don"));
    await sleep(10);

    assert.deepEqual(noiDungHistory(threadId), [], "chưa chốt lượt thì router không được ghi gì");
    batcher.clearPendingBatches();
  });
});
