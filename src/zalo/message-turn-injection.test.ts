import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { ThreadType, type API } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import { thanhKetQuaStream, type KetQuaGenerate } from "../agent/streaming-model-test-helper.js";
import type { AccountConfig } from "../config/account-store.js";
import type { ParsedMessage } from "./zalo-message-parser.js";

/**
 * Test DÂY NỐI của việc tiêm tin giữa lượt vào đường chat thật.
 *
 * `agent-loop` có test riêng cho phần đưa tin chen vào ngữ cảnh model, nhưng
 * những HỆ QUẢ PHỤ - ghi history, báo "đã xem" - nằm ở `message-turn-processor`
 * và chỉ đo được ở đây. Đúng lớp lỗi từng dính hai lần trong dự án này: hàm
 * viết đúng, không ai nối, mà toàn bộ test vẫn xanh.
 *
 * Thiếu phần ghi history là bot quên sạch câu người ta vừa nói giữa chừng -
 * cùng một lỗ hổng với ca tin bị bỏ ở trần hàng chờ.
 */

let dataDir: string;
let processor: typeof import("./message-turn-processor.js");
let ghiTin: typeof import("./record-incoming-message.js");
let batcher: typeof import("../middleware/message-batcher.js");
let accountStore: typeof import("../config/account-store.js");
let historyStore: typeof import("../conversation/history-store.js");
let database: typeof import("../conversation/database.js");

const ACC = "acc-chen";
const THREAD = "t-chen";
const THREAD_KEY = `${ACC}:${THREAD}`;

before(async () => {
  dataDir = setupTestEnv();
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
let daBaoDaXem: number;
beforeEach(() => {
  daGui = [];
  daBaoDaXem = 0;
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
  sendSeenEvent: async () => {
    daBaoDaXem++;
    return {};
  },
} as unknown as API;

function tinNhan(text: string, msgId: string, images: { url: string }[] = []): ParsedMessage {
  const msg: ParsedMessage = {
    accountId: ACC,
    threadId: THREAD,
    threadType: ThreadType.User,
    isGroup: false,
    senderId: "user-1",
    senderName: "Hải",
    text,
    images,
    msgId,
    cliMsgId: `c-${msgId}`,
    isSelf: false,
    mentionsMe: false,
    sentAt: new Date().toISOString(),
    // `toReceiptParams` (message-receipts.ts) đọc từ ĐÂY chứ không đọc các
    // trường cấp trên. Để rỗng thì mọi biên nhận bị bỏ lặng lẽ và test "đã
    // xem" sẽ xanh giả - nó đo 0 lần gọi và tưởng là đúng.
    rawData: { msgId, cliMsgId: `c-${msgId}`, uidFrom: "user-1", idTo: "self-1" },
  };
  // Đường thật: router ghi tin vào lịch sử NGAY LÚC NHẬN rồi mới xếp vào hàng
  // gộp (`record-incoming-message.ts`). Test dựng tin rồi đưa thẳng vào hàng
  // chờ / `processBatch` nên phải tự làm bước đó.
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

const noiDungHistory = (): string[] =>
  historyStore.getRecentMessages(ACC, THREAD).map((m) => m.content);

/**
 * Đặt một tin vào trạng thái ĐỖ trong hàng chờ, y như đời thật.
 *
 * Phải chiếm khoá thread TRƯỚC: không có ai giữ khoá thì `flush` chốt batch
 * ngay và chạy nó bằng handler rỗng - tin biến mất trước khi lượt kịp bắt đầu,
 * và test sẽ đo nhầm rằng đường tiêm không hoạt động.
 *
 * Ngoài đời chính lượt agent giữ khoá đó (bộ gộp gọi `processBatch` qua
 * `runOnThreadChain`); ở đây `processBatch` được gọi thẳng nên phải tự dựng.
 */
async function doTinVaoHangCho(
  text: string,
  msgId: string,
  images: { url: string }[] = [],
): Promise<() => void> {
  let nhaKhoa!: () => void;
  const bịChặn = new Promise<void>((resolve) => {
    nhaKhoa = resolve;
  });
  void batcher.runOnThreadChain(THREAD_KEY, () => bịChặn);

  batcher.enqueueMessage(THREAD_KEY, tinNhan(text, msgId, images), async () => {}, 0);
  await new Promise((r) => setTimeout(r, 10)); // hết cửa sổ gộp -> đỗ lại
  return nhaKhoa;
}

describe("processBatch - tin nhắn thêm giữa lượt", () => {
  it("tin chen vào history SAU tin mở đầu, đúng thứ tự người ta đã gửi", async () => {
    // Model giả chốt luôn ở step đầu. `prepareStep` vẫn chạy trước step đó nên
    // tin đang đỗ trong hàng chờ vẫn được kéo vào - đúng đường chạy thật.
    const model = new MockLanguageModelV4({
      doStream: async () =>
        thanhKetQuaStream(traLoi("Đã ghi nhận cả hai ý") as unknown as KetQuaGenerate),
    });

    // Dựng tin MỞ ĐẦU trước rồi mới tới tin chen, đúng thứ tự đời thật: router
    // ghi từng tin vào lịch sử ngay lúc nhận, mà tin mở đầu tới trước. Dựng
    // ngược lại là tự tạo ra một thứ tự không bao giờ xảy ra rồi bắt lỗi nó.
    const tinMoDau = tinNhan("soạn giúp mình bài giảng", "m1");
    const nhaKhoa = await doTinVaoHangCho("đổi thành file word nhé", "m2");

    await processor.processBatch(config, api, [tinMoDau], { resolveModel: () => model });
    nhaKhoa();

    const history = noiDungHistory();
    const viTriMoDau = history.findIndex((c) => c.includes("soạn giúp mình bài giảng"));
    const viTriChen = history.findIndex((c) => c.includes("đổi thành file word nhé"));

    assert.ok(viTriMoDau >= 0, "tin mở đầu phải có trong history");
    assert.ok(
      viTriChen >= 0,
      "TIN CHEN PHẢI CÓ TRONG HISTORY - thiếu là bot quên sạch câu người ta vừa nói giữa chừng",
    );
    assert.ok(viTriChen > viTriMoDau, "tin chen phải nằm SAU tin mở đầu, đúng thứ tự đã gửi");
  });

  it("tin chen vào PROMPT đúng MỘT lần - không vừa lẫn trong lịch sử vừa mang nhãn", async () => {
    // Tin chen đã nằm trong lịch sử từ lúc nhận. Nếu lượt không loại nó ra khỏi
    // phần lịch sử thì model đọc cùng một yêu cầu hai lần: một lần trần trong
    // lịch sử, một lần dưới nhãn "[Vừa có tin nhắn mới ... đang làm dở]" - đúng
    // thứ nhãn đó sinh ra để tránh.
    const prompts: unknown[][] = [];
    const model = new MockLanguageModelV4({
      doStream: async ({ prompt }) => {
        prompts.push(prompt as unknown[]);
        return thanhKetQuaStream(traLoi("ok") as unknown as KetQuaGenerate);
      },
    });

    const tinMoDau = tinNhan("soạn giúp mình bài giảng", "m1");
    const nhaKhoa = await doTinVaoHangCho("à mà xuất ra Word nhé", "m2");

    await processor.processBatch(config, api, [tinMoDau], { resolveModel: () => model });
    nhaKhoa();

    const soLan = (prompts[0] as { role: string; content: unknown }[])
      .filter((m) => m.role === "user")
      .map((m) =>
        typeof m.content === "string"
          ? m.content
          : (m.content as { type: string; text?: string }[])
              .filter((p) => p.type === "text")
              .map((p) => p.text)
              .join("\n"),
      )
      .filter((c) => c.includes("xuất ra Word")).length;

    assert.equal(soLan, 1, `tin chen phải vào prompt đúng 1 lần, đang có ${soLan}`);
  });

  it("tin chen được báo 'đã xem' như tin thường - không để người gửi tưởng tin rơi vào khoảng không", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => thanhKetQuaStream(traLoi("ok") as unknown as KetQuaGenerate),
    });

    const nhaKhoa = await doTinVaoHangCho("thêm ý này nữa", "m2");

    await processor.processBatch(config, api, [tinNhan("câu hỏi đầu", "m1")], {
      resolveModel: () => model,
    });
    nhaKhoa();

    // 1 lần cho batch mở đầu + 1 lần cho tin chen
    assert.equal(daBaoDaXem, 2, `mong 2 lần báo đã xem, nhận ${daBaoDaXem}`);
  });

  it("ảnh của tin chen cũng được lưu xuống đĩa như tin mở đầu", async () => {
    // Thiếu bước này thì history chỉ còn dòng chữ "[gửi kèm N ảnh]" mà không
    // đường dẫn nào: lượt sau bot không nạp lại được ảnh, sidecar phải mô tả
    // lại từ đầu mỗi lần (cache khóa theo chính `localPath`), và ảnh mất hẳn
    // khi URL Zalo hết hạn. Mất dữ liệu, không tự phục hồi được.
    const model = new MockLanguageModelV4({
      doStream: async () => thanhKetQuaStream(traLoi("ok") as unknown as KetQuaGenerate),
    });

    const daLuu: string[][] = [];
    const nhaKhoa = await doTinVaoHangCho("xem ảnh này giúp mình", "m2");

    await processor.processBatch(config, api, [tinNhan("câu hỏi đầu", "m1")], {
      resolveModel: () => model,
      persistImages: async (_acc, messages) => {
        daLuu.push(messages.map((m) => m.msgId ?? ""));
      },
    });
    nhaKhoa();

    assert.equal(daLuu.length, 2, `mong 2 lần lưu (batch mở đầu + tin chen), nhận ${daLuu.length}`);
    assert.deepEqual(daLuu[0], ["m1"], "lần đầu là batch mở đầu");
    assert.deepEqual(daLuu[1], ["m2"], "lần hai PHẢI là tin chen");
  });

  it("đường dẫn ảnh của tin chen được GẮN vào dòng lịch sử của chính nó", async () => {
    // Lưu xuống đĩa mới là nửa việc. Không gắn đường dẫn vào dòng đã ghi thì
    // lượt sau bot không nạp lại được ảnh, sidecar phải mô tả lại từ đầu mỗi
    // lần (cache khóa theo `localPath`), và ảnh mất hẳn khi URL Zalo hết hạn.
    const model = new MockLanguageModelV4({
      doStream: async () => thanhKetQuaStream(traLoi("ok") as unknown as KetQuaGenerate),
    });

    const duong = `media/${ACC}/${THREAD}/chen-0.jpg`;
    const tinMoDau = tinNhan("câu hỏi đầu", "m1");
    const nhaKhoa = await doTinVaoHangCho("xem ảnh này giúp mình", "m2", [{ url: "http://x/0.jpg" }]);

    await processor.processBatch(config, api, [tinMoDau], {
      resolveModel: () => model,
      persistImages: async (_acc, messages) => {
        for (const m of messages) for (const a of m.images) a.localPath = duong;
      },
    });
    nhaKhoa();

    const dongChen = historyStore
      .getRecentMessages(ACC, THREAD, 500)
      .find((m) => m.content.includes("xem ảnh này giúp mình"));
    assert.deepEqual(dongChen?.images, [duong]);
  });

  it("hàng chờ rỗng thì mọi thứ y như cũ - đối chứng", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => thanhKetQuaStream(traLoi("chào anh") as unknown as KetQuaGenerate),
    });

    await processor.processBatch(config, api, [tinNhan("chào bot", "m1")], {
      resolveModel: () => model,
    });

    const history = noiDungHistory();
    assert.equal(history.filter((c) => c.includes("chào bot")).length, 1, "không được ghi trùng");
    assert.equal(daBaoDaXem, 1, "không có tin chen thì chỉ 1 lần báo đã xem");
    assert.deepEqual(daGui, ["chào anh"]);
  });
});
