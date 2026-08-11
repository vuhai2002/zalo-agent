import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import type { ZaloBotUpdate } from "./zalo-bot-api-types.js";

/**
 * Cửa vào của kênh TÀI KHOẢN BOT.
 *
 * Bất biến quan trọng nhất ở đây nặng hơn bên kênh cá nhân: `getUpdates` KHÔNG
 * có tham số `offset` để xác nhận đã đọc, nên tin đã lấy về là MẤT khỏi hàng
 * chờ của Zalo. Không ghi vào history NGAY thì tiến trình chết ở giữa là tin
 * biến mất vĩnh viễn, không lấy lại được.
 *
 * `setupTestEnv()` phải chạy TRƯỚC mọi import chạm DB (luật ở CLAUDE.md).
 */
let dataDir: string;
let router: typeof import("./bot-message-router.js");
let batcher: typeof import("../middleware/message-batcher.js");
let history: typeof import("../conversation/history-store.js");
let accounts: typeof import("../config/account-store.js");
let threads: typeof import("../conversation/thread-store.js");
let contacts: typeof import("../conversation/contact-store.js");

const ACC = "acc-bot-router";

before(async () => {
  dataDir = setupTestEnv();
  router = await import("./bot-message-router.js");
  batcher = await import("../middleware/message-batcher.js");
  history = await import("../conversation/history-store.js");
  accounts = await import("../config/account-store.js");
  threads = await import("../conversation/thread-store.js");
  contacts = await import("../conversation/contact-store.js");
  accounts.createAccount({ id: ACC, label: "Bot router test" });
  accounts.datLoaiKenh(ACC, "bot");
});

after(async () => {
  batcher.clearPendingBatches();
  (await import("../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Kênh giả: ghi lại mọi thứ gửi ra, không chạm mạng */
function kenhGia() {
  const daGui: string[] = [];
  return {
    daGui,
    kenh: {
      api: null,
      duongGui: () => async (doan: { text: string }) => {
        daGui.push(doan.text);
        return {};
      },
    },
  };
}

function tin(threadId: string, text: string, msgId: string, laNhom = false): ZaloBotUpdate {
  return {
    event_name: "message.text.received",
    message: {
      from: { id: "u1", display_name: "Hải", is_bot: false },
      chat: { id: threadId, chat_type: laNhom ? "GROUP" : "PRIVATE" },
      text,
      message_id: msgId,
      date: Date.now(),
    },
  };
}

const noiDung = (threadId: string) =>
  history.getRecentMessages(ACC, threadId, 500).map((m) => m.content);

describe("routeBotUpdate", () => {
  it("ghi vào history NGAY - `getUpdates` không có offset nên mất là mất hẳn", () => {
    const { kenh } = kenhGia();
    router.routeBotUpdate(ACC, kenh, tin("t-ghi-ngay", "chào bot", "m1"));
    assert.deepEqual(noiDung("t-ghi-ngay"), ["chào bot"]);
    batcher.clearPendingBatches();
  });

  it("ghi đúng MỘT dòng mỗi tin, theo đúng thứ tự tới", () => {
    const { kenh } = kenhGia();
    for (const [i, c] of ["một", "hai", "ba"].entries()) {
      router.routeBotUpdate(ACC, kenh, tin("t-thu-tu", c, `m-tt-${i}`));
    }
    assert.deepEqual(noiDung("t-thu-tu"), ["một", "hai", "ba"]);
    batcher.clearPendingBatches();
  });

  it("BỎ tin của bot khác - chống hai bot nói chuyện vô tận", () => {
    const { kenh } = kenhGia();
    const u = tin("t-bot-khac", "xin chào", "m-bot");
    u.message!.from.is_bot = true;
    router.routeBotUpdate(ACC, kenh, u);
    assert.deepEqual(noiDung("t-bot-khac"), []);
  });

  it("ghi nhận CẢ người nhắn, không chỉ thread", () => {
    const { kenh } = kenhGia();
    router.routeBotUpdate(ACC, kenh, tin("t-contact", "chào", "m-ct"));
    const ds = contacts.listContacts({ accountId: ACC });
    assert.ok(
      ds.some((c) => c.userId === "u1"),
      "người nhắn không được ghi nhận - dashboard sẽ không thấy ai",
    );
    batcher.clearPendingBatches();
  });

  it("update KHÔNG có message thì bỏ qua êm, không ném", () => {
    const { kenh } = kenhGia();
    assert.doesNotThrow(() => router.routeBotUpdate(ACC, kenh, { event_name: "gì đó lạ" }));
  });

  it("tin THIẾU threadId bị bỏ, không ghi rác vào bảng threads", () => {
    // `doiUpdateSangParsedMessage` để threadId rỗng khi payload không có
    // `chat.id` lẫn `from.id`. Không chặn thì `recordThreadActivity` ghi một
    // dòng thread id rỗng và hàng chờ dùng khóa `acc:` - rác đọng lại mà
    // không ai truy được nó từ đâu ra.
    const { kenh } = kenhGia();
    const u = tin("", "tin hong", "m-hong");
    u.message!.chat.id = "";
    u.message!.from.id = "";
    router.routeBotUpdate(ACC, kenh, u);
    assert.deepEqual(noiDung(""), [], "tin thiếu threadId vẫn được ghi");
  });

  it("account không tồn tại thì bỏ qua êm", () => {
    const { kenh } = kenhGia();
    assert.doesNotThrow(() => router.routeBotUpdate("khong-co-that", kenh, tin("t", "x", "m")));
  });

  it("ghi nhận thread và người nhắn để dashboard thấy", () => {
    const { kenh } = kenhGia();
    router.routeBotUpdate(ACC, kenh, tin("t-ghi-nhan", "chào", "m-gn"));
    assert.equal(threads.hasDisplayName(ACC, "t-ghi-nhan"), true);
    batcher.clearPendingBatches();
  });

  it("tin NHÓM: tên nhóm để TRỐNG vì Bot API không đọc được thông tin nhóm", () => {
    // `getChat`/`getChatMember` trả 404 (đo thật). Lấy tên người gửi làm tên
    // nhóm là gán nhầm - dashboard sẽ hiện tên một thành viên như thể là tên nhóm.
    const { kenh } = kenhGia();
    router.routeBotUpdate(ACC, kenh, tin("t-nhom", "@bot ơi", "m-nhom", true));
    assert.equal(threads.hasDisplayName(ACC, "t-nhom"), false);
    batcher.clearPendingBatches();
  });

  it("tin bị bỏ vì hàng chờ chạm trần VẪN vào history", async () => {
    const { kenh } = kenhGia();
    const threadId = "t-tran";
    const threadKey = `${ACC}:${threadId}`;

    let nha!: () => void;
    const biChan = new Promise<void>((r) => {
      nha = r;
    });
    void batcher.runOnThreadChain(threadKey, () => biChan);
    await sleep(10);

    const soThua = 3;
    const tong = batcher.TRAN_TIN_DON + soThua;
    for (let i = 0; i < tong; i++) {
      router.routeBotUpdate(ACC, kenh, tin(threadId, `tin-${i}`, `m${i}`));
    }

    const daGhi = noiDung(threadId);
    assert.equal(daGhi.length, tong, `mong ${tong} dòng, nhận ${daGhi.length}`);

    // Khẳng định trên là ĐIỀU KIỆN CẦN nhưng chưa đủ: `ghiTinDenVaoHistory`
    // chạy vô điều kiện TRƯỚC `enqueueMessage`, nên nó xanh kể cả khi trần
    // hàng chờ không tồn tại. Phải chỉ đích danh mấy tin BỊ BỎ.
    for (let i = 0; i < soThua; i++) {
      const text = `tin-${batcher.TRAN_TIN_DON + i}`;
      assert.ok(
        daGhi.some((c) => c.includes(text)),
        `tin bị bỏ "${text}" phải có trong history`,
      );
    }

    // Dọn batch đang đỗ TRƯỚC khi nhả: nhả trước thì batch chạy thật và
    // `processBatch` gọi provider thật, test đi ra mạng ngoài.
    batcher.clearPendingBatches();
    nha();
    await sleep(30);
  });
});
