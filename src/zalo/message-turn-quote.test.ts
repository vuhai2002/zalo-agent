import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { ThreadType, type API, type SendMessageQuote } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import { thanhKetQuaStream, type KetQuaGenerate } from "../agent/streaming-model-test-helper.js";
import type { AccountConfig } from "../config/account-store.js";
import type { ParsedMessage } from "./zalo-message-parser.js";

/**
 * Dây nối của trích dẫn vào đường chat THẬT.
 *
 * `reply-quote.test.ts` đã kiểm luật dựng trích dẫn, `send-reply-quote.test.ts`
 * kiểm cách nó đi qua bộ gửi. Còn KHÂU NỐI - `message-turn-processor` có đặt
 * `quote` lên `ReplyTarget` không, và có lấy đúng tin ĐẦU batch không - chỉ đo
 * được ở đây. Đúng lớp lỗi đã dính hai lần trong dự án: hàm viết đúng, không ai
 * nối, mà toàn bộ test vẫn xanh.
 */

let dataDir: string;
let processor: typeof import("./message-turn-processor.js");
let batcher: typeof import("../middleware/message-batcher.js");
let accountStore: typeof import("../config/account-store.js");
let database: typeof import("../conversation/database.js");

const ACC = "acc-quote";
const NHOM = "g-quote";
const RIENG = "t-quote";

before(async () => {
  dataDir = setupTestEnv();
  processor = await import("./message-turn-processor.js");
  batcher = await import("../middleware/message-batcher.js");
  accountStore = await import("../config/account-store.js");
  database = await import("../conversation/database.js");
  accountStore.createAccount({ id: ACC, label: "Test" });
});

after(() => {
  batcher.clearPendingBatches();
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

let daGui: { msg: string; quote?: SendMessageQuote; khoa: string[] }[] = [];
beforeEach(() => {
  daGui = [];
  batcher.clearPendingBatches();
  database.db.prepare("DELETE FROM messages WHERE thread_id IN (?, ?)").run(NHOM, RIENG);
});

const config: AccountConfig = {
  id: ACC,
  label: "Test",
  enabled: true,
  agentId: "khong-co-agent-nay",
  allowlist: { mode: "all", userIds: [] },
  groupRequireMention: true,
  respondToGroups: true,
  groupPassiveListen: true,
  autoReactEnabled: false,
  autoReactIcon: "heart",
  typingIndicatorEnabled: false,
  disabledTools: [],
};

const api = {
  getOwnId: () => "self-1",
  sendMessage: async (payload: { msg: string; quote?: SendMessageQuote }) => {
    daGui.push({ ...payload, khoa: Object.keys(payload) });
    return { msgId: `m-${daGui.length}` };
  },
  sendTypingEvent: async () => ({}),
  addReaction: async () => ({}),
  sendSeenEvent: async () => ({}),
} as unknown as API;

function tin(opts: {
  threadId: string;
  isGroup: boolean;
  msgId: string;
  text: string;
  senderName?: string;
}): ParsedMessage {
  const senderName = opts.senderName ?? "Hải";
  return {
    accountId: ACC,
    threadId: opts.threadId,
    threadType: opts.isGroup ? ThreadType.Group : ThreadType.User,
    isGroup: opts.isGroup,
    senderId: `u-${senderName}`,
    senderName,
    text: opts.text,
    images: [],
    msgId: opts.msgId,
    cliMsgId: `c-${opts.msgId}`,
    isSelf: false,
    mentionsMe: true,
    sentAt: "2026-08-07T17:12:00.000Z",
    // `trichDanTuTin` đọc từ ĐÂY chứ không đọc các trường cấp trên - để rỗng
    // thì mọi test dưới đều xanh giả vì không tin nào trích được
    rawData: {
      content: opts.text,
      msgType: "webchat",
      uidFrom: `u-${senderName}`,
      msgId: opts.msgId,
      cliMsgId: `c-${opts.msgId}`,
      ts: "1786122720000",
      ttl: 0,
    },
  };
}

const modelTraLoi = () =>
  new MockLanguageModelV4({
    doStream: async () =>
      thanhKetQuaStream({
        content: [{ type: "text" as const, text: "Giá vàng hôm nay là..." }],
        finishReason: "stop" as const,
        usage: {
          inputTokens: { total: 60, noCache: 60, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 15, text: 15, reasoning: 0 },
        },
        warnings: [],
      } as unknown as KetQuaGenerate),
  });

describe("processBatch - trích dẫn tin người dùng", () => {
  it("trong NHÓM: câu trả lời trích đúng tin của người hỏi", async () => {
    await processor.processBatch(
      config,
      api,
      [tin({ threadId: NHOM, isGroup: true, msgId: "m-hoi", text: "bot ơi giá vàng?" })],
      { resolveModel: () => modelTraLoi() },
    );

    assert.equal(daGui.length, 1);
    assert.equal(daGui[0]!.quote?.msgId, "m-hoi");
    assert.equal(daGui[0]!.quote?.uidFrom, "u-Hải");
    assert.equal(daGui[0]!.quote?.content, "bot ơi giá vàng?");
  });

  it("chat RIÊNG: KHÔNG trích - chỉ có hai người, trích là nhiễu", async () => {
    await processor.processBatch(
      config,
      api,
      [tin({ threadId: RIENG, isGroup: false, msgId: "m-rieng", text: "chào bot" })],
      { resolveModel: () => modelTraLoi() },
    );

    assert.equal(daGui.length, 1);
    assert.ok(!daGui[0]!.khoa.includes("quote"));
  });

  it("batch NHIỀU tin: trích tin ĐẦU (tin mở lượt), không phải tin cuối", async () => {
    await processor.processBatch(
      config,
      api,
      [
        tin({ threadId: NHOM, isGroup: true, msgId: "m-dau", text: "bot ơi tra giúp giá vàng", senderName: "Hải" }),
        tin({ threadId: NHOM, isGroup: true, msgId: "m-cuoi", text: "và cả tỉ giá nữa", senderName: "Nam" }),
      ],
      { resolveModel: () => modelTraLoi() },
    );

    assert.equal(daGui[0]!.quote?.msgId, "m-dau", "phải trích tin mở lượt");
    assert.notEqual(daGui[0]!.quote?.msgId, "m-cuoi");
  });
});
