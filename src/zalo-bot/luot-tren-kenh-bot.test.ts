import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import { thanhKetQuaStream, type KetQuaGenerate } from "../agent/streaming-model-test-helper.js";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";
import type { KenhLuot } from "../zalo/kenh-luot.js";

/**
 * Chạy MỘT LƯỢT THẬT trên kênh chỉ có 2 trong 5 năng lực.
 *
 * Đây là mối nối mà đợt "nối trọn vòng" chưa ai canh: các test khác đo từng
 * mảnh rời (parser, vòng poll, bảng chặn), còn `processBatch` thì luôn chạy
 * với kênh cá nhân đủ năng lực. Chưa ai chứng minh `kenh.baoDaXem?.()` và
 * `kenh.tuThaCamXuc?.()` bỏ qua ÊM trên đường thật thay vì ném.
 */
let dataDir: string;
let processor: typeof import("../zalo/message-turn-processor.js");
let accounts: typeof import("../config/account-store.js");
let agents: typeof import("../config/agent-store.js");
let history: typeof import("../conversation/history-store.js");

const ACC = "acc-luot-bot";
const THREAD = "t-luot";

before(async () => {
  dataDir = setupTestEnv();
  processor = await import("../zalo/message-turn-processor.js");
  accounts = await import("../config/account-store.js");
  agents = await import("../config/agent-store.js");
  history = await import("../conversation/history-store.js");
  agents.ensureDefaultAgent();
  accounts.createAccount({ id: ACC, label: "Bot" });
  accounts.datLoaiKenh(ACC, "bot");
});

after(async () => {
  (await import("../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

const traLoi = (chu: string) =>
  ({
    finishReason: "stop",
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    content: [{ type: "text", text: chu }],
    warnings: [],
  }) as unknown as KetQuaGenerate;

function tin(text: string, msgId: string): ParsedMessage {
  return {
    accountId: ACC,
    threadId: THREAD,
    threadType: 0,
    isGroup: false,
    senderId: "u1",
    senderName: "Hải",
    text,
    images: [],
    msgId,
    cliMsgId: msgId,
    isSelf: false,
    mentionsMe: true,
    sentAt: new Date().toISOString(),
    rawData: {},
  } as ParsedMessage;
}

/** Kênh bot GIẢ: đúng 2 năng lực, ba năng lực kia để trống như thật */
function kenhBotGia() {
  const daGui: string[] = [];
  let dangNhapBat = 0;
  let dangNhapTat = 0;
  const kenh: KenhLuot = {
    api: null,
    tranKyTuMotTin: 2000,
    duongGui: () => async (doan) => {
      daGui.push(doan.text);
      return {};
    },
    batDangNhap: () => {
      dangNhapBat++;
      return () => void dangNhapTat++;
    },
  };
  return { kenh, daGui, soBat: () => dangNhapBat, soTat: () => dangNhapTat };
}

describe("lượt agent chạy trên kênh bot", () => {
  it("chạy trọn lượt với kênh thiếu 3 năng lực - không ném, chữ tới nơi", async () => {
    const { kenh, daGui } = kenhBotGia();
    const config = accounts.getAccount(ACC)!;
    const model = new MockLanguageModelV4({
      doStream: async () => thanhKetQuaStream(traLoi("Chào anh Hải")),
    });

    await processor.processBatch(config, kenh, [tin("chào bot", "m1")], {
      resolveModel: () => model,
    });

    assert.deepEqual(daGui, ["Chào anh Hải"], "câu trả lời không tới được đường gửi của kênh");
  });

  it("dấu 'đang nhập' được BẬT rồi TẮT, kể cả khi kênh thiếu năng lực khác", async () => {
    const { kenh, soBat, soTat } = kenhBotGia();
    const config = accounts.getAccount(ACC)!;
    const model = new MockLanguageModelV4({
      doStream: async () => thanhKetQuaStream(traLoi("ừ")),
    });

    await processor.processBatch(config, kenh, [tin("hỏi tiếp", "m2")], {
      resolveModel: () => model,
    });

    assert.equal(soBat(), 1);
    assert.equal(soTat(), 1, "quên tắt là dấu 'đang nhập' treo mãi trước mặt người nhắn");
  });

  it("câu trả lời của bot vào history - dashboard và lượt sau đều cần", async () => {
    const { kenh } = kenhBotGia();
    const config = accounts.getAccount(ACC)!;
    const model = new MockLanguageModelV4({
      doStream: async () => thanhKetQuaStream(traLoi("Dạ em nghe")),
    });

    await processor.processBatch(config, kenh, [tin("alo", "m3")], { resolveModel: () => model });

    const chu = history.getRecentMessages(ACC, THREAD, 50).map((m) => m.content);
    assert.ok(chu.includes("Dạ em nghe"), `câu trả lời không vào history: ${chu.join(" | ")}`);
  });

  it("lượt vẫn chạy khi kênh KHÔNG có cả 'đang nhập'", async () => {
    // Kênh tối giản nhất có thể: chỉ mỗi đường gửi.
    const daGui: string[] = [];
    const kenh: KenhLuot = { api: null, duongGui: () => async (d) => void daGui.push(d.text) };
    const config = accounts.getAccount(ACC)!;
    const model = new MockLanguageModelV4({
      doStream: async () => thanhKetQuaStream(traLoi("vẫn chạy")),
    });

    await processor.processBatch(config, kenh, [tin("thử", "m4")], { resolveModel: () => model });
    assert.deepEqual(daGui, ["vẫn chạy"]);
  });
});
