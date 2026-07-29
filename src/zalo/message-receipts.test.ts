import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ThreadType, type API } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import type { ParsedMessage } from "./zalo-message-parser.js";

/**
 * Import ĐỘNG sau setupTestEnv: module này tạo logger, mà logger đọc
 * `DATA_DIR` lúc nạp module. Import tĩnh thì logger dựng trước khi env test kịp
 * có hiệu lực, và pino-roll ghi thẳng vào `data/logs/` của bot đang chạy thật -
 * đã đo được 946 byte log test lọt vào file production.
 */
let receipts: typeof import("./message-receipts.js");
let dataDir: string;

before(async () => {
  dataDir = setupTestEnv();
  receipts = await import("./message-receipts.js");
});

after(async () => {
  // Module chạm cấu hình chỉnh-nóng nên mở SQLite; không đóng thì Windows
  // chặn xóa thư mục tạm (EPERM)
  (await import("../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

/** Chờ microtask - hai hàm receipt là fire-and-forget, không await được */
const flush = () => new Promise<void>((r) => setImmediate(r));

type DeliveredCall = { isSeen: boolean; messages: unknown[]; type: ThreadType };
type SeenCall = { messages: unknown[]; type: ThreadType };

function stubApi(shouldFail = false) {
  const delivered: DeliveredCall[] = [];
  const seen: SeenCall[] = [];
  const api = {
    sendDeliveredEvent: async (isSeen: boolean, messages: unknown, type: ThreadType) => {
      if (shouldFail) throw new Error("mạng rớt");
      delivered.push({ isSeen, messages: messages as unknown[], type });
      return { status: 0 };
    },
    sendSeenEvent: async (messages: unknown, type: ThreadType) => {
      if (shouldFail) throw new Error("mạng rớt");
      seen.push({ messages: messages as unknown[], type });
      return { status: 0 };
    },
  } as unknown as API;
  return { api, delivered, seen };
}

function message(overrides: Partial<ParsedMessage> = {}, raw: Record<string, unknown> = {}): ParsedMessage {
  return {
    accountId: "acc-chinh",
    threadId: "thread-1",
    threadType: ThreadType.User,
    isGroup: false,
    senderId: "user-9",
    senderName: "Hải",
    text: "chào bot",
    images: [],
    msgId: "msg-1",
    cliMsgId: "cli-1",
    isSelf: false,
    mentionsMe: false,
    rawData: {
      msgId: "msg-1",
      cliMsgId: "cli-1",
      uidFrom: "user-9",
      idTo: "self-1",
      msgType: "webchat",
      st: 1,
      at: 2,
      cmd: 3,
      ts: "1700000000000",
      ...raw,
    },
    ...overrides,
  };
}

describe("sendDeliveredReceipt", () => {
  it("dựng đủ 9 field từ payload gốc, isSeen=false", async () => {
    const { api, delivered } = stubApi();
    receipts.sendDeliveredReceipt(api, message());
    await flush();

    assert.equal(delivered.length, 1);
    assert.equal(delivered[0]!.isSeen, false, "đây mới là 'đã nhận', 'đã xem' đi đường riêng");
    assert.equal(delivered[0]!.type, ThreadType.User);
    assert.deepEqual(delivered[0]!.messages, [
      {
        msgId: "msg-1",
        cliMsgId: "cli-1",
        uidFrom: "user-9",
        idTo: "self-1",
        msgType: "webchat",
        st: 1,
        at: 2,
        cmd: 3,
        ts: "1700000000000",
      },
    ]);
  });

  it("thiếu field bắt buộc thì bỏ qua, không gọi API", async () => {
    const { api, delivered } = stubApi();
    receipts.sendDeliveredReceipt(api, message({}, { msgId: "" }));
    receipts.sendDeliveredReceipt(api, message({}, { uidFrom: "" }));
    receipts.sendDeliveredReceipt(api, message({}, { idTo: "" }));
    await flush();
    assert.equal(delivered.length, 0);
  });

  it("API lỗi không làm vỡ luồng trả lời", async () => {
    const { api } = stubApi(true);
    receipts.sendDeliveredReceipt(api, message());
    await flush();
    // Không có unhandled rejection là đạt
  });
});

describe("sendSeenReceipt", () => {
  it("gửi cả batch trong 1 lần gọi, đúng thread type của nhóm", async () => {
    const { api, seen } = stubApi();
    const groupMsg = (msgId: string) =>
      message(
        { threadId: "group-7", threadType: ThreadType.Group, isGroup: true },
        { msgId, idTo: "group-7" },
      );

    receipts.sendSeenReceipt(api, [groupMsg("m1"), groupMsg("m2")]);
    await flush();

    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.type, ThreadType.Group);
    assert.equal(seen[0]!.messages.length, 2);
  });

  it("loại tin khác thread - zca-js bắt buộc cùng 1 thread mỗi lần gọi", async () => {
    const { api, seen } = stubApi();
    receipts.sendSeenReceipt(api, [message(), message({ threadId: "thread-khac" })]);
    await flush();

    assert.equal(seen[0]!.messages.length, 1);
  });

  it("batch rỗng thì không gọi API", async () => {
    const { api, seen } = stubApi();
    receipts.sendSeenReceipt(api, []);
    await flush();
    assert.equal(seen.length, 0);
  });
});
