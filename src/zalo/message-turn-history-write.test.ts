import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { ThreadType, type API } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import { thanhKetQuaStream, type KetQuaGenerate } from "../agent/streaming-model-test-helper.js";
import type { AccountConfig } from "../config/account-store.js";
import type { ParsedMessage } from "./zalo-message-parser.js";

/**
 * Tin người dùng nay vào lịch sử NGAY LÚC NHẬN, không đợi lượt chạy xong
 * (`record-incoming-message.ts`). Đổi đó mở ra đúng một cái bẫy và đóng lại
 * hai cái khác - cả ba đều đo ở đây:
 *
 *   BẪY MỞ RA: lúc lượt đọc lịch sử thì tin của CHÍNH nó đã nằm trong đó, nên
 *   không lọc là model nhận cùng một câu hỏi HAI lần và dễ tưởng người dùng
 *   hỏi lặp. `buildTurnMessages` lọc theo `historyRowId`.
 *
 *   BẪY ĐÓNG LẠI 1: lượt chết giữa chừng không còn làm mất tin khỏi lịch sử.
 *   BẪY ĐÓNG LẠI 2: thứ tự trong DB là thứ tự người ta gửi, không phải thứ tự
 *   lượt kết thúc - điều kiện cần để lượt chạy song song sau này.
 */

let dataDir: string;
let processor: typeof import("./message-turn-processor.js");
let ghiTin: typeof import("./record-incoming-message.js");
let batcher: typeof import("../middleware/message-batcher.js");
let accountStore: typeof import("../config/account-store.js");
let historyStore: typeof import("../conversation/history-store.js");
let database: typeof import("../conversation/database.js");

const ACC = "acc-ghi";
const THREAD = "t-ghi";

/**
 * Trần nhỏ để test chạy nhanh mà vẫn đo đúng đại lượng. Mặc định thật là 20;
 * điều đang kiểm là "cửa sổ có teo theo cỡ batch không", con số cụ thể không
 * đổi bản chất.
 */
const TRAN_LICH_SU = 6;

before(async () => {
  dataDir = setupTestEnv({ HISTORY_CONTEXT_LIMIT: String(TRAN_LICH_SU) });
  processor = await import("./message-turn-processor.js");
  ghiTin = await import("./record-incoming-message.js");
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

let daGui: string[] = [];
beforeEach(() => {
  daGui = [];
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
  sendMessage: async (payload: { msg: string }) => {
    daGui.push(payload.msg);
    return { msgId: `m-${daGui.length}` };
  },
  sendTypingEvent: async () => ({}),
  addReaction: async () => ({}),
  sendSeenEvent: async () => ({}),
} as unknown as API;

/** Dựng tin VÀ ghi vào lịch sử, y như router làm lúc nhận */
function tinDaNhan(text: string, msgId: string, anh: { url: string }[] = []): ParsedMessage {
  const msg: ParsedMessage = {
    accountId: ACC,
    threadId: THREAD,
    threadType: ThreadType.User,
    isGroup: false,
    senderId: "u-hai",
    senderName: "Hải",
    text,
    images: anh,
    msgId,
    cliMsgId: `c-${msgId}`,
    isSelf: false,
    mentionsMe: false,
    sentAt: "2026-08-07T17:12:00.000Z",
    rawData: { msgId, cliMsgId: `c-${msgId}`, uidFrom: "u-hai", idTo: "self-1" },
  };
  ghiTin.ghiTinDenVaoHistory(ACC, msg, { luuAnhNgay: false });
  return msg;
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

/** Model giả ghi lại prompt để soi đúng thứ model NHÌN THẤY */
function modelGhiPrompt(daNhan: unknown[][]) {
  return new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      daNhan.push(prompt as unknown[]);
      return thanhKetQuaStream(traLoi("ok") as unknown as KetQuaGenerate);
    },
  });
}

/** Số tin vai `user` trong prompt có chứa `chu` */
function demTinChua(prompt: unknown[], chu: string): number {
  return (prompt as { role: string; content: unknown }[])
    .filter((m) => m.role === "user")
    .map((m) =>
      typeof m.content === "string"
        ? m.content
        : (m.content as { type: string; text?: string }[])
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("\n"),
    )
    .filter((c) => c.includes(chu)).length;
}

const lichSu = () =>
  historyStore.getRecentMessages(ACC, THREAD, 500).map((m) => ({ role: m.role, content: m.content }));

describe("ghi lịch sử ngay lúc nhận - model không thấy tin lặp", () => {
  it("câu hỏi của lượt này xuất hiện ĐÚNG MỘT lần trong prompt", async () => {
    const prompts: unknown[][] = [];
    const cauHoi = "cho mình bảng giá tháng 8";

    await processor.processBatch(config, api, [tinDaNhan(cauHoi, "m1")], {
      resolveModel: () => modelGhiPrompt(prompts),
    });

    assert.equal(
      demTinChua(prompts[0]!, cauHoi),
      1,
      "tin đã nằm sẵn trong lịch sử lúc lượt đọc - không lọc là model đọc câu hỏi hai lần",
    );
  });

  it("câu hỏi CŨ giống hệt câu mới thì vẫn giữ nguyên trong lịch sử", async () => {
    // Lọc theo id DÒNG chứ không theo nội dung: người ta hỏi lại đúng câu cũ là
    // chuyện thường, nuốt mất câu cũ là bot quên mất họ từng hỏi rồi.
    const prompts: unknown[][] = [];
    const cauHoi = "giá vàng hôm nay";

    await processor.processBatch(config, api, [tinDaNhan(cauHoi, "m1")], {
      resolveModel: () => modelGhiPrompt(prompts),
    });
    await processor.processBatch(config, api, [tinDaNhan(cauHoi, "m2")], {
      resolveModel: () => modelGhiPrompt(prompts),
    });

    assert.equal(demTinChua(prompts[1]!, cauHoi), 2, "một lần trong lịch sử, một lần là câu đang hỏi");
  });
});

describe("cửa sổ lịch sử không teo theo cỡ batch", () => {
  /** Số tin vai `user`/`assistant` model thấy, trừ tin của chính lượt này */
  function soTinLichSu(prompt: unknown[]): number {
    const ds = prompt as { role: string }[];
    return ds.filter((m) => m.role === "user" || m.role === "assistant").length - 1;
  }

  it(`batch nhiều tin: model VẪN thấy đủ ${TRAN_LICH_SU} tin cũ`, async () => {
    // Ca đắt nhất của cả bản vá. `getRecentMessages` trả N tin MỚI NHẤT, mà tin
    // của batch nay nằm ngay trong số đó rồi bị lọc bỏ. Không xin dư thì cửa sổ
    // teo đúng bằng cỡ batch, và teo CÂM: batch 5 tin là mất 25% trí nhớ, batch
    // chạm trần 32 tin là model bước vào lượt không biết mình vừa trả lời gì.
    for (let i = 0; i < TRAN_LICH_SU; i++) {
      historyStore.appendMessage(ACC, THREAD, { role: "user", content: `tin cũ ${i}`, senderName: "Hải" });
    }

    const prompts: unknown[][] = [];
    const batch = [tinDaNhan("câu một", "b1"), tinDaNhan("câu hai", "b2"), tinDaNhan("câu ba", "b3")];
    await processor.processBatch(config, api, batch, { resolveModel: () => modelGhiPrompt(prompts) });

    assert.equal(
      soTinLichSu(prompts[0]!),
      TRAN_LICH_SU,
      `batch ${batch.length} tin không được làm mất tin cũ nào`,
    );
  });

  it("tin đang CHỜ trong hàng gộp cũng được xin dư, không ăn vào cửa sổ", async () => {
    for (let i = 0; i < TRAN_LICH_SU; i++) {
      historyStore.appendMessage(ACC, THREAD, { role: "user", content: `tin cũ ${i}`, senderName: "Hải" });
    }

    // Một tin đã ghi lịch sử và đang nằm trong hàng chờ - nó bị loại khỏi phần
    // lịch sử của lượt (sẽ được chèn kèm nhãn tin chen), nên cũng phải xin dư
    const dangCho = tinDaNhan("tin đang chờ", "b-cho");
    batcher.enqueueMessage(`${ACC}:${THREAD}`, dangCho, async () => {}, 60_000);

    const prompts: unknown[][] = [];
    await processor.processBatch(config, api, [tinDaNhan("câu đang hỏi", "b1")], {
      resolveModel: () => modelGhiPrompt(prompts),
    });
    batcher.clearPendingBatches();

    assert.equal(soTinLichSu(prompts[0]!), TRAN_LICH_SU);
  });
});

describe("ghi lịch sử ngay lúc nhận - đúng một dòng, không mất khi lượt chết", () => {
  it("lượt trọn vẹn: tin người dùng có ĐÚNG một dòng", async () => {
    const prompts: unknown[][] = [];
    await processor.processBatch(config, api, [tinDaNhan("chào bot", "m1")], {
      resolveModel: () => modelGhiPrompt(prompts),
    });

    const cuaNguoiDung = lichSu().filter((m) => m.role === "user" && m.content.includes("chào bot"));
    assert.equal(cuaNguoiDung.length, 1, "ghi ở cả router lẫn processBatch là model đọc thấy lặp");
  });

  it("lượt CHẾT vì provider lỗi: tin người dùng vẫn còn nguyên trong lịch sử", async () => {
    const modelHong = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error("provider chết");
      },
    });

    await processor.processBatch(config, api, [tinDaNhan("câu hỏi lúc bot hỏng", "m1")], {
      resolveModel: () => modelHong,
    });

    // Đếm ĐÚNG MỘT dòng chứ không chỉ "có mặt": nhánh lỗi trước đây tự gọi
    // `writeBatchToHistory` để cứu tin, ai đó khôi phục lại dòng đó là tin bị
    // ghi lần hai và model đọc thấy người dùng lặp. Khẳng định "có mặt" một
    // mình thì gần như tautology - dòng đó do helper ghi ra từ đầu.
    const cua = lichSu().filter((m) => m.role === "user" && m.content.includes("câu hỏi lúc bot hỏng"));
    assert.equal(cua.length, 1, "bỏ qua là bot quên, ghi lại lần nữa là model đọc thấy lặp");
  });

  it("thứ tự: tin người dùng -> câu chốt của agent", async () => {
    const prompts: unknown[][] = [];
    await processor.processBatch(config, api, [tinDaNhan("hỏi gì đó", "m1")], {
      resolveModel: () => modelGhiPrompt(prompts),
    });

    const vai = lichSu().map((m) => m.role);
    assert.deepEqual(vai, ["user", "assistant"]);
  });
});

describe("ganAnhVaoHistory", () => {
  it("đường dẫn ảnh tải xong được gắn vào ĐÚNG dòng đã ghi lúc nhận", async () => {
    const prompts: unknown[][] = [];
    const tin = tinDaNhan("xem ảnh này", "m-anh", [{ url: "http://x/0.jpg" }]);

    await processor.processBatch(config, api, [tin], {
      resolveModel: () => modelGhiPrompt(prompts),
      // Giả bước tải: chỉ đóng dấu localPath, không chạm mạng
      persistImages: async (_acc, msgs) => {
        for (const m of msgs) for (const a of m.images) a.localPath = `media/${ACC}/${THREAD}/da-tai.jpg`;
      },
    });

    const dong = historyStore.getRecentMessages(ACC, THREAD, 500).find((m) => m.content.includes("xem ảnh này"));
    assert.deepEqual(
      dong?.images,
      [`media/${ACC}/${THREAD}/da-tai.jpg`],
      "không gắn thì lượt sau không nạp lại được ảnh, và ảnh mất hẳn khi URL Zalo hết hạn",
    );
  });
});
