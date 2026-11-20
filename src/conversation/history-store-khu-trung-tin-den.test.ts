import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Khử trùng tin ĐẾN theo mã tin Zalo.
 *
 * Vì sao cần: tin lỡ được Zalo gửi lại qua hàng chờ lấy bù (cmd 510/511), mà
 * một tin vừa nằm trong trang lấy bù vừa có thể tới trực tiếp (và zca-js 2.3.0
 * còn nhận cả cmd 551 cạnh 501). Ghi hai dòng là model đọc hai lần, trả lời hai
 * lần. Dòng ghi TRƯỚC khi có cột `msg_id` thì chỉ còn khớp được theo người gửi
 * + giờ gửi - đúng ca lần chạy đầu sau deploy, khi mọi dòng cũ chưa có mã.
 */
let dataDir: string;
let store: typeof import("./history-store.js");
let database: typeof import("./database.js");
let ghi: typeof import("../zalo/record-incoming-message.js");

const ACC = "acc-khu-trung";
const THREAD = "t-lan";
const GIO = "2026-03-10T07:00:00.000Z";

before(async () => {
  dataDir = setupTestEnv();
  store = await import("./history-store.js");
  database = await import("./database.js");
  ghi = await import("../zalo/record-incoming-message.js");
});

after(() => {
  store.closeHistoryStore();
  cleanupTestEnv(dataDir);
});

beforeEach(() => {
  database.db.exec("DELETE FROM messages");
});

function tin(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    accountId: ACC,
    threadId: THREAD,
    threadType: 0,
    isGroup: false,
    senderId: "u-lan",
    senderName: "Lan",
    text: "Hẹn họp lúc 9h nhé",
    images: [],
    msgId: "1000000000000000001",
    cliMsgId: "c1",
    isSelf: false,
    mentionsMe: false,
    sentAt: GIO,
    rawData: {},
    ...overrides,
  };
}

describe("daCoTinDen", () => {
  it("cùng msgId -> đã có; msgId khác cùng giờ, khác người -> chưa có", () => {
    store.appendMessage(ACC, THREAD, { role: "user", content: "a", senderId: "u-lan", createdAt: GIO, msgId: "m-1" });
    assert.equal(store.daCoTinDen(ACC, THREAD, { msgId: "m-1", senderId: "u-lan", sentAt: GIO }), true);
    assert.equal(store.daCoTinDen(ACC, THREAD, { msgId: "m-2", senderId: "u-minh", sentAt: GIO }), false);
  });

  it("không lẫn giữa account / thread", () => {
    store.appendMessage(ACC, THREAD, { role: "user", content: "a", senderId: "u-lan", createdAt: GIO, msgId: "m-1" });
    assert.equal(store.daCoTinDen("acc-khac", THREAD, { msgId: "m-1", senderId: "u-lan", sentAt: GIO }), false);
    assert.equal(store.daCoTinDen(ACC, "t-khac", { msgId: "m-1", senderId: "u-lan", sentAt: GIO }), false);
  });

  it("dòng cũ CHƯA có msg_id: khớp theo người gửi + giờ gửi đúng từng ms", () => {
    store.appendMessage(ACC, THREAD, { role: "user", content: "a", senderId: "u-lan", createdAt: GIO });
    assert.equal(store.daCoTinDen(ACC, THREAD, { msgId: "m-9", senderId: "u-lan", sentAt: GIO }), true);
    assert.equal(
      store.daCoTinDen(ACC, THREAD, { msgId: "m-9", senderId: "u-lan", sentAt: "2026-03-10T07:00:00.001Z" }),
      false,
    );
  });

  it("dòng cũ của BOT (assistant) không bị coi là tin đến", () => {
    store.appendMessage(ACC, THREAD, { role: "assistant", content: "a", senderId: "u-lan", createdAt: GIO });
    assert.equal(store.daCoTinDen(ACC, THREAD, { msgId: "m-9", senderId: "u-lan", sentAt: GIO }), false);
  });

  it('msgId rỗng "" không bao giờ khớp dòng khác cũng rỗng', () => {
    store.appendMessage(ACC, THREAD, { role: "user", content: "a", senderId: "u-lan", createdAt: GIO, msgId: "" });
    assert.equal(
      store.daCoTinDen(ACC, THREAD, { msgId: "", senderId: "u-minh", sentAt: "2026-03-10T08:00:00.000Z" }),
      false,
    );
  });
});

describe("ghiTinDenVaoHistory ghi mã tin", () => {
  it("cột msg_id = msg.msgId", () => {
    const rowId = ghi.ghiTinDenVaoHistory(ACC, tin(), { luuAnhNgay: false });
    const row = database.db.prepare("SELECT msg_id FROM messages WHERE id = ?").get(rowId) as { msg_id: string | null };
    assert.equal(row.msg_id, "1000000000000000001");
  });
});
