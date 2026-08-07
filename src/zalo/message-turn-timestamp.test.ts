import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { ThreadType, type API } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import { thanhKetQuaStream, type KetQuaGenerate } from "../agent/streaming-model-test-helper.js";
import type { AccountConfig } from "../config/account-store.js";
import type { ParsedMessage } from "./zalo-message-parser.js";

/**
 * Bất biến ĐẮT NHẤT của mốc giờ tin nhắn, và là bất biến chỉ đo được ở đây:
 *
 *   Nhãn giờ model thấy ở LƯỢT NÀY phải y hệt nhãn nó thấy cho CHÍNH tin đó ở
 *   LƯỢT SAU (lúc tin đã thành lịch sử).
 *
 * Hai đường dựng khác nhau - `buildCurrentTurnContent` và
 * `historyToModelMessages` - nên chúng trôi khỏi nhau được, và đã trôi thật:
 * lịch sử có nhãn giờ, tin của lượt hiện tại thì không, khiến model đọc nhãn
 * của tin TRƯỚC ĐÓ như giờ của câu đang hỏi.
 *
 * Test đơn vị của từng đường không bắt được: mỗi đường tự nó đều "đúng". Chỉ
 * khi cho một tin đi trọn hai lượt mới thấy hai nhãn có khớp nhau không, và
 * `created_at` ghi xuống DB có phải giờ NGƯỜI TA GỬI hay giờ lượt kết thúc.
 */

let dataDir: string;
let processor: typeof import("./message-turn-processor.js");
let batcher: typeof import("../middleware/message-batcher.js");
let accountStore: typeof import("../config/account-store.js");
let historyStore: typeof import("../conversation/history-store.js");
let database: typeof import("../conversation/database.js");

const ACC = "acc-ts";
const THREAD = "t-ts";

/** 00:12 ngày 08/08 giờ Việt Nam - cố định để nhãn không đổi theo lúc chạy test */
const GUI_LUC = "2026-08-07T17:12:00.000Z";
const NHAN_MONG_DOI = "[08/08 00:12]";

before(async () => {
  dataDir = setupTestEnv();
  processor = await import("./message-turn-processor.js");
  batcher = await import("../middleware/message-batcher.js");
  accountStore = await import("../config/account-store.js");
  historyStore = await import("../conversation/history-store.js");
  database = await import("../conversation/database.js");
  accountStore.createAccount({ id: ACC, label: "Test" });
});

after(() => {
  batcher.clearPendingBatches();
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(() => {
  batcher.clearPendingBatches();
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
  sendMessage: async () => ({ msgId: "m-sent" }),
  sendTypingEvent: async () => ({}),
  addReaction: async () => ({}),
  sendSeenEvent: async () => ({}),
} as unknown as API;

function tinNhan(text: string, msgId: string, sentAt: string, senderName = "Hải"): ParsedMessage {
  return {
    accountId: ACC,
    threadId: THREAD,
    threadType: ThreadType.User,
    isGroup: false,
    senderId: `u-${senderName}`,
    senderName,
    text,
    images: [],
    msgId,
    cliMsgId: `c-${msgId}`,
    isSelf: false,
    mentionsMe: false,
    sentAt,
    rawData: { msgId, cliMsgId: `c-${msgId}`, uidFrom: `u-${senderName}`, idTo: "self-1" },
  };
}

const traLoi = (text: string) => ({
  content: [{ type: "text" as const, text }],
  finishReason: "stop" as const,
  usage: {
    inputTokens: { total: 60, noCache: 60, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 15, text: 15, reasoning: 0 },
  },
  warnings: [],
});

/** Model giả ghi lại nguyên prompt để soi đúng thứ model NHÌN THẤY */
function modelGhiPrompt(daNhan: unknown[][]) {
  return new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      daNhan.push(prompt as unknown[]);
      return thanhKetQuaStream(traLoi("ok") as unknown as KetQuaGenerate);
    },
  });
}

/** Gom hết chữ trong các tin vai `user` của một prompt */
function chuNguoiDung(prompt: unknown[]): string[] {
  return (prompt as { role: string; content: unknown }[])
    .filter((m) => m.role === "user")
    .map((m) =>
      typeof m.content === "string"
        ? m.content
        : (m.content as { type: string; text?: string }[])
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("\n"),
    );
}

describe("mốc giờ tin nhắn đi trọn hai lượt", () => {
  it("nhãn giờ của lượt này KHỚP nhãn của chính tin đó ở lượt sau", async () => {
    const prompts: unknown[][] = [];
    const model = modelGhiPrompt(prompts);

    await processor.processBatch(config, api, [tinNhan("giá vàng hôm nay", "m1", GUI_LUC)], {
      resolveModel: () => model,
    });
    await processor.processBatch(config, api, [tinNhan("còn tỉ giá USD", "m2", "2026-08-07T17:20:00.000Z")], {
      resolveModel: () => model,
    });

    const luot1 = chuNguoiDung(prompts[0]!);
    const luot2 = chuNguoiDung(prompts[1]!);

    const nhanLuot1 = luot1.find((c) => c.includes("giá vàng hôm nay"));
    const nhanLuot2 = luot2.find((c) => c.includes("giá vàng hôm nay"));

    assert.ok(nhanLuot1, "lượt 1 phải thấy chính câu vừa hỏi");
    assert.ok(nhanLuot2, "lượt 2 phải thấy lại câu đó trong lịch sử");
    assert.equal(
      nhanLuot1,
      nhanLuot2,
      "cùng một tin mà hai lượt render khác nhau - đúng chỗ hai đường dựng trôi khỏi nhau",
    );
    assert.equal(nhanLuot1, `${NHAN_MONG_DOI} Hải: giá vàng hôm nay`);
  });

  it("nhãn giờ lấy từ lúc GỬI, không phải lúc lượt kết thúc", async () => {
    const prompts: unknown[][] = [];
    await processor.processBatch(config, api, [tinNhan("câu hỏi", "m1", GUI_LUC)], {
      resolveModel: () => modelGhiPrompt(prompts),
    });

    const cauHoi = chuNguoiDung(prompts[0]!).find((c) => c.includes("câu hỏi"))!;
    assert.match(cauHoi, /^\[08\/08 00:12\] /, `nhãn phải là ${NHAN_MONG_DOI}, nhận: ${cauHoi}`);
  });

  it("created_at ghi xuống DB đúng bằng giờ gửi - lượt dài không làm lệch", async () => {
    const prompts: unknown[][] = [];
    await processor.processBatch(config, api, [tinNhan("câu hỏi", "m1", GUI_LUC)], {
      resolveModel: () => modelGhiPrompt(prompts),
    });

    const tinNguoiDung = historyStore.getRecentMessages(ACC, THREAD).find((m) => m.role === "user");
    assert.equal(tinNguoiDung?.createdAt, GUI_LUC);
  });

  it("batch NHIỀU NGƯỜI: lượt sau đọc lại đúng ai nói câu nào", async () => {
    const prompts: unknown[][] = [];
    const model = modelGhiPrompt(prompts);

    await processor.processBatch(
      config,
      api,
      [
        tinNhan("mình hỏi giá vàng", "m1", GUI_LUC, "Hải"),
        tinNhan("mình hỏi tỉ giá", "m2", "2026-08-07T17:12:30.000Z", "Nam"),
      ],
      { resolveModel: () => model },
    );
    await processor.processBatch(config, api, [tinNhan("cảm ơn nhé", "m3", "2026-08-07T17:20:00.000Z")], {
      resolveModel: () => model,
    });

    const luot2 = chuNguoiDung(prompts[1]!);
    assert.ok(
      luot2.some((c) => /Hải: mình hỏi giá vàng/.test(c)),
      "câu của Hải phải mang tên Hải",
    );
    assert.ok(
      luot2.some((c) => /Nam: mình hỏi tỉ giá/.test(c)),
      "câu của Nam phải mang tên Nam",
    );
    assert.ok(
      !luot2.some((c) => /Nam: mình hỏi giá vàng/.test(c)),
      "KHÔNG được gán lời của Hải cho Nam",
    );
  });
});
