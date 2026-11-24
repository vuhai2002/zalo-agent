import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ThreadType, type API } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Test cho CỬA VÀO của mọi tin nhắn.
 *
 * Trọng tâm: tin nào cũng phải để lại dấu vết trong history NGAY LÚC NHẬN, kể
 * cả tin bot không xử lý và tin bị hàng chờ gộp BỎ vì chạm trần.
 *
 * Bản trước chỉ ghi ngay ở hai nhánh đặc biệt (passive-listen và tin bị bỏ),
 * còn tin có-trả-lời đợi tới cuối lượt mới ghi. Nay mọi tin đi chung một
 * đường - xem `record-incoming-message.ts` cho lý do (thứ tự trong DB phải là
 * thứ tự người ta gửi, không phải thứ tự lượt kết thúc).
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

/** API giả: mọi lệnh gửi ra Zalo đều nuốt êm, không chạm mạng; đếm biên nhận "đã nhận" */
let soBienNhan = 0;
let soLanHoiTenNhom = 0;
const apiGia = {
  addReaction: async () => ({}),
  sendSeenEvent: async () => ({}),
  sendDeliveredEvent: async () => {
    soBienNhan++;
    return {};
  },
  sendTypingEvent: async () => ({}),
  getGroupInfo: async () => {
    soLanHoiTenNhom++;
    await sleep(20);
    return {};
  },
} as unknown as API;

function tinRaw(threadId: string, text: string, msgId: string) {
  return {
    threadId,
    type: ThreadType.User,
    isSelf: false,
    // idTo: `toReceiptParams` đọc rawData và bỏ lặng lẽ tin thiếu trường này -
    // thiếu là mọi biên nhận "đã nhận" thành 0 và phép đếm biên nhận đo rỗng
    data: { content: text, uidFrom: "user-1", idTo: SELF, dName: "Hải", msgId, cliMsgId: `c-${msgId}` },
  };
}

/**
 * Trần lớn hơn hẳn `HISTORY_CONTEXT_LIMIT` (mặc định 20): ca chạm trần hàng chờ
 * ghi tới 35 dòng, đọc bằng trần mặc định thì mất 15 dòng đầu và khẳng định về
 * số lượng đo nhầm chính cái trần đó.
 */
function noiDungHistory(threadId: string): string[] {
  return history.getRecentMessages(ACC, threadId, 500).map((m) => m.content);
}

describe("routeIncomingMessage - ghi lịch sử ngay lúc nhận", () => {
  it("ghi NGAY, không đợi lượt chạy xong", async () => {
    const threadId = "thread-ghi-ngay";

    router.routeIncomingMessage(ACC, apiGia, SELF, tinRaw(threadId, "chào bot", "m-don"));

    // Chưa có sleep, chưa lượt nào chạy - tin phải đã nằm trong lịch sử.
    // Đây là bất biến cho phép lượt chạy song song mà thứ tự vẫn đúng.
    assert.deepEqual(noiDungHistory(threadId), ["chào bot"]);
    batcher.clearPendingBatches();
  });

  it("cùng một tin tới HAI lần (cùng msgId): một dòng lịch sử, bộ gộp nhận một tin", async () => {
    // Zalo có thể đẩy một tin qua cả cmd 501 lẫn 551, hoặc vừa trực tiếp vừa
    // trong trang lấy bù - ghi hai dòng là model đọc hai lần, trả lời hai lần
    const threadId = "thread-trung-ma";
    const truoc = soBienNhan;
    router.routeIncomingMessage(ACC, apiGia, SELF, tinRaw(threadId, "hẹn họp lúc 9h nhé", "m-trung"));
    router.routeIncomingMessage(ACC, apiGia, SELF, tinRaw(threadId, "hẹn họp lúc 9h nhé", "m-trung"));
    assert.deepEqual(noiDungHistory(threadId), ["hẹn họp lúc 9h nhé"]);
    assert.equal(batcher.idTinDangCho(`${ACC}:${threadId}`).length, 1);
    await sleep(10);
    assert.equal(soBienNhan - truoc, 1, "tin trùng vẫn gửi biên nhận 'đã nhận' lần hai");
    batcher.clearPendingBatches();
  });

  it("nhiều tin của một nhóm chưa có tên tới dồn: chỉ hỏi tên nhóm MỘT lần cùng lúc", async () => {
    const truoc = soLanHoiTenNhom;
    for (let i = 0; i < 5; i++) {
      router.routeIncomingMessage(ACC, apiGia, SELF, {
        threadId: "g-chua-ten",
        type: ThreadType.Group,
        isSelf: false,
        data: { content: `tin ${i}`, uidFrom: "user-1", idTo: "g-chua-ten", dName: "Hải", msgId: `m-nhom-${i}`, cliMsgId: "c" },
      });
    }
    await sleep(60);
    assert.equal(soLanHoiTenNhom - truoc, 1);
    batcher.clearPendingBatches();
  });

  it("cùng msgId nhưng KHÁC thread: giữ cả hai", async () => {
    router.routeIncomingMessage(ACC, apiGia, SELF, tinRaw("thread-ma-a", "một", "m-chung"));
    router.routeIncomingMessage(ACC, apiGia, SELF, tinRaw("thread-ma-b", "hai", "m-chung"));
    assert.deepEqual(noiDungHistory("thread-ma-a"), ["một"]);
    assert.deepEqual(noiDungHistory("thread-ma-b"), ["hai"]);
    batcher.clearPendingBatches();
  });

  it("msgId rỗng: không khử trùng theo mã (mọi tin rỗng mã không bị coi là một)", async () => {
    const threadId = "thread-ma-rong";
    router.routeIncomingMessage(ACC, apiGia, SELF, tinRaw(threadId, "câu một", ""));
    await sleep(2);
    router.routeIncomingMessage(ACC, apiGia, SELF, tinRaw(threadId, "câu hai", ""));
    assert.deepEqual(noiDungHistory(threadId), ["câu một", "câu hai"]);
    batcher.clearPendingBatches();
  });

  it("ghi đúng MỘT dòng cho mỗi tin, theo đúng thứ tự người ta gửi", async () => {
    const threadId = "thread-thu-tu";

    for (const [i, chu] of ["câu một", "câu hai", "câu ba"].entries()) {
      router.routeIncomingMessage(ACC, apiGia, SELF, tinRaw(threadId, chu, `m-tt-${i}`));
    }

    assert.deepEqual(noiDungHistory(threadId), ["câu một", "câu hai", "câu ba"]);
    batcher.clearPendingBatches();
  });

  it("tin bị bỏ vì hàng chờ chạm trần VẪN vào history - không im lặng nuốt", async () => {
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

    // MỌI tin đều đã vào lịch sử, cả tin lọt batch lẫn tin bị bỏ. Người nhắn đã
    // nhận dấu "đã nhận" nên im lặng nuốt bất kỳ tin nào cũng là kết cục tệ.
    const daGhi = noiDungHistory(threadId);
    assert.equal(daGhi.length, tong, `mong ${tong} dòng, nhận ${daGhi.length}`);
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
});

describe("routeIncomingMessage - tệp đính kèm", () => {
  const tinTep = (threadId: string, msgId: string, type = ThreadType.User) => ({
    threadId,
    type,
    isSelf: false,
    data: {
      msgType: "share.file",
      content: { title: "Biên bản.pdf", href: "https://file-stal-1.dlfl.vn/gr/a/b", params: '{"fileSize":"10","fileExt":"pdf"}' },
      uidFrom: "user-1",
      dName: "Hải",
      msgId,
      cliMsgId: `c-${msgId}`,
    },
  });

  it("tin 1-1 có tệp: ghi dòng tệp + thẻ trong lịch sử, và tải sớm chạy nền", async () => {
    const { napSan } = await import("../attachments/phu-thuoc-lay-tep.js");
    const goc = napSan.chay;
    const daGoi: [number, string][] = [];
    napSan.chay = (id, key) => void daGoi.push([id, key]);
    try {
      router.routeIncomingMessage(ACC, apiGia, SELF, tinTep("thread-tep-1", "m-tep-1"));
      assert.deepEqual(noiDungHistory("thread-tep-1"), ['[tệp đính kèm "Biên bản.pdf"]']);
      assert.equal(daGoi.length, 1);
      assert.equal(daGoi[0]![1], `${ACC}:user-1`);
    } finally {
      napSan.chay = goc;
      batcher.clearPendingBatches();
    }
  });

  it("tin nhóm KHÔNG gọi bot có tệp: không tải sớm (chỉ tải khi có người hỏi tới)", async () => {
    const { napSan } = await import("../attachments/phu-thuoc-lay-tep.js");
    const goc = napSan.chay;
    let soLan = 0;
    napSan.chay = () => void soLan++;
    try {
      router.routeIncomingMessage(ACC, apiGia, SELF, tinTep("thread-tep-nhom", "m-tep-2", ThreadType.Group));
      assert.equal(soLan, 0);
    } finally {
      napSan.chay = goc;
      batcher.clearPendingBatches();
    }
  });
});
