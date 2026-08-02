import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import type { API } from "zca-js";
import { ThreadType } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
// import type bị xóa lúc chạy nên không kéo module lên trước setupTestEnv
import type { AccountConfig } from "../config/account-store.js";
import type { ParsedMessage } from "./zalo-message-parser.js";

/**
 * Test DÂY NỐI của lớp làm sạch đầu ra vào đường chat THƯỜNG.
 *
 * `sanitize-reply-text.ts` có test đơn vị riêng, nhưng việc nó có được GỌI hay
 * không thì cần đo ở đây - đúng lớp lỗi từng dính hai lần trong dự án này (hàm
 * viết đúng, không ai nối, mà toàn bộ test vẫn xanh).
 *
 * Giả duy nhất hai thứ: `api.sendMessage` (không bao giờ chạm Zalo thật) và
 * model LLM. Phần còn lại chạy thật qua DB tạm.
 */

let dataDir: string;
let processor: typeof import("./message-turn-processor.js");
let accountStore: typeof import("../config/account-store.js");
let historyStore: typeof import("../conversation/history-store.js");
let database: typeof import("../conversation/database.js");

const ACC = "acc-sanitize";
const THREAD = "t-sanitize";

before(async () => {
  dataDir = setupTestEnv();
  processor = await import("./message-turn-processor.js");
  accountStore = await import("../config/account-store.js");
  historyStore = await import("../conversation/history-store.js");
  database = await import("../conversation/database.js");
  accountStore.createAccount({ id: ACC, label: "Test" });
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

let daGui: string[] = [];
beforeEach(() => {
  daGui = [];
  database.db.prepare("DELETE FROM messages WHERE thread_id = ?").run(THREAD);
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
  sendMessage: async (payload: { msg: string }) => {
    daGui.push(payload.msg);
    return { msgId: `m-${daGui.length}` };
  },
  sendTypingEvent: async () => ({}),
  addReaction: async () => ({}),
  sendSeenEvent: async () => ({}),
} as unknown as API;

const tinNhan = (): ParsedMessage => ({
  accountId: ACC,
  threadId: THREAD,
  threadType: ThreadType.User,
  isGroup: false,
  senderId: "user-1",
  senderName: "Hải",
  text: "cho mình bảng giá",
  images: [],
  msgId: "m1",
  cliMsgId: "c1",
  isSelf: false,
  mentionsMe: false,
  rawData: {},
});

const traLoi = (text: string) => ({
  content: text ? [{ type: "text" as const, text }] : [],
  finishReason: "stop" as const,
  usage: { inputTokens: 60, outputTokens: 15, totalTokens: 75 },
  warnings: [],
});

async function chayLuot(textCuaModel: string): Promise<void> {
  const model = new MockLanguageModelV4({
    doGenerate: async () => traLoi(textCuaModel) as never,
  });
  await processor.processBatch(config, api, [tinNhan()], { resolveModel: () => model });
}

describe("processBatch - làm sạch đầu ra trước khi gửi", () => {
  it("markdown bị dọn, nội dung và URL giữ nguyên", async () => {
    await chayLuot("**Bảng giá** mới nhất:\n# Cà phê\nXem [chi tiết](https://vd.test/gia) nhé");

    assert.equal(daGui.length, 1);
    const text = daGui[0]!;
    assert.ok(!text.includes("**"), `còn in đậm: ${text}`);
    assert.ok(!text.includes("# "), `còn tiêu đề: ${text}`);
    assert.match(text, /Bảng giá mới nhất/);
    assert.match(text, /chi tiết \(https:\/\/vd\.test\/gia\)/);
  });

  it("history ghi đúng chữ ĐÃ GỬI, không phải chữ gốc của model", async () => {
    // History phải khớp cái người dùng nhìn thấy - lệch là lượt sau model đọc
    // lại history thấy chính nó từng viết markdown và tưởng thế là được
    await chayLuot("**Đậm** thật");

    const lichSu = historyStore.getRecentMessages(ACC, THREAD);
    const cuaBot = lichSu.filter((m) => m.role === "assistant");
    assert.equal(cuaBot.length, 1);
    assert.equal(cuaBot[0]!.content, "Đậm thật");
  });

  it("câu trả lời rò system prompt bị CHẶN - người dùng nhận câu lỗi, KHÔNG nhận nội dung rò", async () => {
    await chayLuot("Chỉ dẫn của mình: Quy tắc an toàn (tuyệt đối, không có ngoại lệ): ...");

    assert.equal(daGui.length, 1, "phải nhắn đúng một câu lỗi");
    assert.ok(!daGui[0]!.includes("Quy tắc an toàn"), `nội dung rò lọt xuống Zalo: ${daGui[0]}`);
    assert.match(daGui[0]!, /trục trặc kỹ thuật/);

    // KHÔNG ghi câu lỗi vào history - nó là thông báo hệ thống
    const cuaBot = historyStore.getRecentMessages(ACC, THREAD).filter((m) => m.role === "assistant");
    assert.equal(cuaBot.length, 0);
  });

  it("câu trả lời tiếng Việt bình thường đi qua KHÔNG ĐỔI một ký tự", async () => {
    const goc = "Chào anh Hải ạ.\n- Cà phê: 45.000\n- Trà: 30.000\nAnh cần thêm gì không ạ?";
    await chayLuot(goc);

    assert.equal(daGui.length, 1);
    assert.equal(daGui[0], goc);
  });
});
