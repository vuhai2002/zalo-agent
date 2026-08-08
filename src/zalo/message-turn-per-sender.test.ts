import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { ThreadType, type API, type SendMessageQuote } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import { thanhKetQuaStream, type KetQuaGenerate } from "../agent/streaming-model-test-helper.js";
import type { AccountConfig } from "../config/account-store.js";
import type { ParsedMessage } from "./zalo-message-parser.js";

/**
 * Nhiều người cùng nhắn trong MỘT nhóm: mỗi người một lượt, mỗi câu trả lời
 * trích đúng tin của người đó.
 *
 * Đo qua bộ gộp THẬT nối với `processBatch` THẬT (chỉ model là giả), vì chính
 * khâu nối là chỗ có thể hỏng: hàng chờ nay khóa theo `(thread, người gửi)`
 * nhưng caller vẫn truyền khóa THREAD, còn `danhThucHangCho` thì nhận khóa
 * thread trong khi Map khóa theo người.
 *
 * KHÔNG đi qua `routeIncomingMessage`: nó `import` tĩnh `processBatch`, mà
 * named export của ESM là binding `configurable:false` một khi đã có consumer
 * resolve - không thay được bằng model giả. Phần việc của router (ghi lịch sử
 * rồi xếp hàng) đã có test riêng ở `incoming-message-router.test.ts`; ở đây
 * dựng lại đúng hai bước đó bằng tay.
 */

let dataDir: string;
let batcher: typeof import("../middleware/message-batcher.js");
let accountStore: typeof import("../config/account-store.js");
let database: typeof import("../conversation/database.js");
let processor: typeof import("./message-turn-processor.js");
let ghiTin: typeof import("./record-incoming-message.js");

const ACC = "acc-nhieu-nguoi";
const NHOM = "g-nhieu-nguoi";
const THREAD_KEY = `${ACC}:${NHOM}`;

before(async () => {
  dataDir = setupTestEnv();
  batcher = await import("../middleware/message-batcher.js");
  accountStore = await import("../config/account-store.js");
  database = await import("../conversation/database.js");
  processor = await import("./message-turn-processor.js");
  ghiTin = await import("./record-incoming-message.js");
  accountStore.createAccount({ id: ACC, label: "Test" });
});

after(() => {
  batcher.clearPendingBatches();
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

let daGui: { msg: string; quote?: SendMessageQuote }[] = [];
beforeEach(() => {
  daGui = [];
  batcher.clearPendingBatches();
  database.db.prepare("DELETE FROM messages WHERE thread_id = ?").run(NHOM);
});

const api = {
  getOwnId: () => "self-1",
  sendMessage: async (payload: { msg: string; quote?: SendMessageQuote }) => {
    daGui.push(payload);
    return { msgId: `m-${daGui.length}` };
  },
  sendTypingEvent: async () => ({}),
  addReaction: async () => ({}),
  sendSeenEvent: async () => ({}),
} as unknown as API;

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

/** Dựng tin nhóm VÀ ghi vào lịch sử, y như router làm lúc nhận */
function tinNhom(msgId: string, text: string, ten: string): ParsedMessage {
  const msg: ParsedMessage = {
    accountId: ACC,
    threadId: NHOM,
    threadType: ThreadType.Group,
    isGroup: true,
    senderId: `u-${ten}`,
    senderName: ten,
    text,
    images: [],
    msgId,
    cliMsgId: `c-${msgId}`,
    isSelf: false,
    mentionsMe: true,
    sentAt: "2026-08-07T17:12:00.000Z",
    rawData: {
      content: text,
      msgType: "webchat",
      uidFrom: `u-${ten}`,
      msgId,
      cliMsgId: `c-${msgId}`,
      ts: "1786122720000",
      ttl: 0,
    },
  };
  ghiTin.ghiTinDenVaoHistory(ACC, msg, { luuAnhNgay: false });
  return msg;
}

/**
 * Model giả: trả lời gắn với người đang hỏi Ở LƯỢT NÀY.
 *
 * Đọc TIN CUỐI của prompt chứ không dò cả prompt: từ lượt thứ hai trở đi, câu
 * hỏi của người trước đã nằm trong lịch sử - dò cả prompt là bắt trúng họ và
 * mọi lượt cùng trả lời cho một người. (Đúng lỗi bản đầu của fixture này: sản
 * phẩm chạy đúng mà test báo sai.)
 */
function modelVongLai() {
  return new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      const ds = prompt as unknown as { role: string; content: unknown }[];
      const cuoi = [...ds].reverse().find((m) => m.role === "user");
      const chu =
        typeof cuoi?.content === "string"
          ? cuoi.content
          : ((cuoi?.content ?? []) as { type: string; text?: string }[])
              .filter((p) => p.type === "text")
              .map((p) => p.text)
              .join("\n");
      const ai = ["Hải", "Nam", "Lan"].find((t) => chu.includes(`${t} hỏi`)) ?? "?";
      return thanhKetQuaStream({
        content: [{ type: "text" as const, text: `trả lời cho ${ai}` }],
        finishReason: "stop" as const,
        usage: {
          inputTokens: { total: 60, noCache: 60, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 15, text: 15, reasoning: 0 },
        },
        warnings: [],
      } as unknown as KetQuaGenerate);
    },
  });
}

/** Handler thật của router, chỉ thay model */
const chayLuot = (batch: ParsedMessage[]) =>
  processor.processBatch(config, api, batch, { resolveModel: () => modelVongLai() });

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("nhiều người nhắn trong một nhóm", () => {
  it("ba người: BA lượt riêng, mỗi câu trả lời trích đúng tin của người đó", async () => {
    for (const [msgId, chu, ten] of [
      ["m-hai", "Hải hỏi giá vàng", "Hải"],
      ["m-nam", "Nam hỏi tỉ giá", "Nam"],
      ["m-lan", "Lan hỏi thời tiết", "Lan"],
    ] as const) {
      batcher.enqueueMessage(THREAD_KEY, tinNhom(msgId, chu, ten), chayLuot, 20);
    }

    await sleep(400);

    assert.equal(daGui.length, 3, `mong 3 câu trả lời riêng, nhận ${daGui.length}`);

    // Mỗi câu trả lời phải trích tin của ĐÚNG người mà nó đang trả lời
    const cap = daGui.map((g) => `${g.quote?.uidFrom} <- ${g.msg}`).sort();
    assert.deepEqual(cap, [
      "u-Hải <- trả lời cho Hải",
      "u-Lan <- trả lời cho Lan",
      "u-Nam <- trả lời cho Nam",
    ]);
  });

  it("tin ĐANG CHỜ của người khác KHÔNG lọt vào prompt của lượt này", async () => {
    // Đo trên prompt thật. Tin đang chờ đã nằm trong lịch sử (ghi ngay lúc
    // nhận) nên nếu không loại ra, nó vào prompt như một câu hỏi chưa ai trả
    // lời - model trả lời luôn cả câu đó, rồi lượt của người kia chạy và trả
    // lời lần nữa. Nhóm ba người là bot bắn ba tin với hai câu trùng nội dung,
    // cộng ba lần token và ba lần gọi API không chính thức.
    const prompts: unknown[][] = [];
    const modelGhi = new MockLanguageModelV4({
      doStream: async ({ prompt }) => {
        prompts.push(prompt as unknown[]);
        return thanhKetQuaStream({
          content: [{ type: "text" as const, text: "ok" }],
          finishReason: "stop" as const,
          usage: {
            inputTokens: { total: 60, noCache: 60, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 15, text: 15, reasoning: 0 },
          },
          warnings: [],
        } as unknown as KetQuaGenerate);
      },
    });

    // Nam đang chờ (debounce dài), Hải chạy lượt ngay
    batcher.enqueueMessage(THREAD_KEY, tinNhom("m-nam-cho", "Nam hỏi tỉ giá", "Nam"), chayLuot, 60_000);
    await processor.processBatch(config, api, [tinNhom("m-hai-chay", "Hải hỏi giá vàng", "Hải")], {
      resolveModel: () => modelGhi,
    });
    batcher.clearPendingBatches();

    const chu = (prompts[0] as { role: string; content: unknown }[])
      .filter((m) => m.role === "user")
      .map((m) =>
        typeof m.content === "string"
          ? m.content
          : (m.content as { type: string; text?: string }[])
              .filter((p) => p.type === "text")
              .map((p) => p.text)
              .join("\n"),
      );

    assert.ok(chu.some((c) => c.includes("Hải hỏi giá vàng")), "câu của chính lượt phải có");
    assert.ok(
      !chu.some((c) => c.includes("Nam hỏi tỉ giá")),
      "câu đang chờ của Nam sẽ có lượt riêng - lọt vào đây là model trả lời hai lần",
    );
  });

  it("một người nhắn hai tin vẫn là MỘT lượt - không tách theo tin", async () => {
    batcher.enqueueMessage(THREAD_KEY, tinNhom("m-1", "Hải hỏi giá vàng", "Hải"), chayLuot, 30);
    await sleep(10);
    batcher.enqueueMessage(THREAD_KEY, tinNhom("m-2", "và cả tỉ giá nữa", "Hải"), chayLuot, 30);

    await sleep(300);

    assert.equal(daGui.length, 1, `một người phải ra đúng 1 câu trả lời, nhận ${daGui.length}`);
    assert.equal(daGui[0]!.quote?.msgId, "m-1", "trích tin mở lượt của chính người đó");
  });

  it("ba người nhắn lúc bot BẬN: khi rảnh vẫn đủ ba câu trả lời, không sót ai", async (t) => {
    // `danhThucHangCho` nhận khóa THREAD còn hàng chờ khóa theo NGƯỜI - tra một
    // khóa là hai người còn lại không bao giờ được trả lời.
    let nha!: () => void;
    const biChan = new Promise<void>((resolve) => {
      nha = resolve;
    });
    void batcher.runOnThreadChain(THREAD_KEY, () => biChan);
    // Nhả khoá kể cả khi assert giữa chừng ném - không thì khoá giữ mãi và các
    // ca sau đọc ra một chuỗi lỗi che mất nguyên nhân thật
    t.after(nha);
    await sleep(20);

    for (const [msgId, chu, ten] of [
      ["m-b-hai", "Hải hỏi giá vàng", "Hải"],
      ["m-b-nam", "Nam hỏi tỉ giá", "Nam"],
      ["m-b-lan", "Lan hỏi thời tiết", "Lan"],
    ] as const) {
      batcher.enqueueMessage(THREAD_KEY, tinNhom(msgId, chu, ten), chayLuot, 20);
    }
    await sleep(80);
    assert.equal(daGui.length, 0, "thread còn bận thì chưa ai được trả lời");

    nha();
    await sleep(500);

    assert.equal(daGui.length, 3, `mong 3 câu trả lời, nhận ${daGui.length}`);
    assert.deepEqual(
      daGui.map((g) => g.quote?.uidFrom).sort(),
      ["u-Hải", "u-Lan", "u-Nam"],
    );
  });
});
