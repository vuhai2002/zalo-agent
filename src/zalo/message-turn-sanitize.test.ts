import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import type { API } from "zca-js";
import { ThreadType } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import { thanhKetQuaStream, type KetQuaGenerate } from "../agent/streaming-model-test-helper.js";
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
let tuning: typeof import("../config/runtime-tuning-settings.js");

const ACC = "acc-sanitize";
const THREAD = "t-sanitize";

before(async () => {
  dataDir = setupTestEnv();
  processor = await import("./message-turn-processor.js");
  accountStore = await import("../config/account-store.js");
  historyStore = await import("../conversation/history-store.js");
  database = await import("../conversation/database.js");
  tuning = await import("../config/runtime-tuning-settings.js");
  accountStore.createAccount({ id: ACC, label: "Test" });
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

let daGui: string[] = [];
/** Style đi kèm từng tin - bắt luôn để chứng minh nó THẬT SỰ tới `sendMessage` */
let daGuiStyle: (unknown[] | undefined)[] = [];
beforeEach(() => {
  daGui = [];
  daGuiStyle = [];
  tuning.setTuning("ZALO_RICH_TEXT_ENABLED", null);
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
  sendMessage: async (payload: { msg: string; styles?: unknown[] }) => {
    daGui.push(payload.msg);
    daGuiStyle.push(payload.styles);
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
  // `doStream`: vòng lặp agent đi đường `streamText` (xem stream-text-result.ts)
  const model = new MockLanguageModelV4({
    doStream: async () => thanhKetQuaStream(traLoi(textCuaModel) as unknown as KetQuaGenerate),
  });
  await processor.processBatch(config, api, [tinNhan()], { resolveModel: () => model });
}

describe("processBatch - làm sạch đầu ra trước khi gửi", () => {
  it("dấu markdown biến khỏi chữ, nội dung và URL giữ nguyên", async () => {
    await chayLuot("**Bảng giá** mới nhất:\n# Cà phê\nXem [chi tiết](https://vd.test/gia) nhé");

    assert.equal(daGui.length, 1);
    const text = daGui[0]!;
    assert.ok(!text.includes("**"), `còn in đậm: ${text}`);
    assert.ok(!text.includes("# "), `còn tiêu đề: ${text}`);
    assert.match(text, /Bảng giá mới nhất/);
    assert.match(text, /chi tiết \(https:\/\/vd\.test\/gia\)/);
  });

  it("ĐẦU-CUỐI: định dạng tới được `sendMessage` chứ không chỉ nằm trong bộ dịch", async () => {
    // Test đơn vị chứng minh bộ dịch đúng, nhưng đường dây từ agent-loop xuống
    // zca-js đi qua 4 module - đứt ở bất cứ khớp nào là tin vẫn phẳng như cũ.
    await chayLuot("## Bảng giá\nCà phê **45.000đ** nhé");

    const styles = daGuiStyle[0] as { start: number; len: number; st: string }[] | undefined;
    assert.ok(styles && styles.length > 0, "không có style nào tới sendMessage");

    const text = daGui[0]!;
    const doanTo = styles.map((s) => text.slice(s.start, s.start + s.len));
    assert.ok(doanTo.includes("Bảng giá"), `tiêu đề không được tô: ${JSON.stringify(doanTo)}`);
    assert.ok(doanTo.includes("45.000đ"), `số tiền không được tô đậm: ${JSON.stringify(doanTo)}`);
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

  it("văn xuôi tiếng Việt KHÔNG có dấu markdown đi qua không đổi một ký tự", async () => {
    const goc = "Chào anh Hải ạ.\nCà phê 45.000, trà 30.000.\nAnh cần thêm gì không ạ?";
    await chayLuot(goc);

    assert.equal(daGui.length, 1);
    assert.equal(daGui[0], goc);
    assert.equal(daGuiStyle[0], undefined, "chữ trơn thì không đính styles");
  });

  it("TẮT cấu hình: quay về chữ phẳng, dấu markdown bị XÓA và không gửi styles", async () => {
    // Đường lui phải còn sống thật. Nếu nút tắt chỉ là trang trí thì lúc định
    // dạng gây phiền, người dùng gạt công tắc mà không có gì đổi.
    tuning.setTuning("ZALO_RICH_TEXT_ENABLED", false);
    await chayLuot("## Bảng giá\n- Cà phê **45.000đ**");

    const text = daGui[0]!;
    assert.ok(!text.includes("**"), `còn dấu sao: ${text}`);
    assert.ok(text.includes("- Cà phê"), "chữ '- ' phải giữ nguyên vì Zalo không tự vẽ nữa");
    assert.equal(daGuiStyle[0], undefined, "tắt rồi thì tuyệt đối không đính styles");
  });

  it("gạch đầu dòng đi xuống Zalo dưới dạng CHỮ, không phải style", async () => {
    // `lst_1` của Zalo render khác nhau giữa Web và điện thoại (điện thoại chỉ
    // vẽ MỘT dấu cho cả span), nên danh sách đi bằng chữ "- " thường - hiện y
    // hệt nhau ở mọi client và tốn 0 span.
    await chayLuot("Chào anh Hải ạ.\n- Cà phê: **45.000**\n- Trà: 30.000");

    const text = daGui[0]!;
    assert.ok(text.includes("- Cà phê: 45.000"), `mất ký tự gạch đầu dòng: ${text}`);
    assert.ok(text.includes("- Trà: 30.000"), "dòng thứ hai cũng phải giữ dấu gạch");

    // Vẫn phải còn in đậm bên TRONG dòng danh sách
    const styles = daGuiStyle[0] as { start: number; len: number; st: string }[] | undefined;
    assert.ok(styles, "in đậm trong dòng danh sách phải tới nơi");
    assert.deepEqual(
      styles.map((s) => text.slice(s.start, s.start + s.len)),
      ["45.000"],
    );
  });
});

describe("processBatch - thẻ màu", () => {
  it("BẬT định dạng: thẻ màu thành style thật của Zalo", async () => {
    await chayLuot("<cam>**Thời gian:**</cam> 7h00 thứ 7");

    const text = daGui[0]!;
    assert.equal(text, "Thời gian: 7h00 thứ 7", "thẻ và dấu đậm phải biến khỏi chữ");
    const styles = daGuiStyle[0] as { start: number; len: number; st: string }[] | undefined;
    assert.ok(styles, "phải có style tới sendMessage");
    // Hai span cùng phủ "Thời gian:" - một cam, một đậm
    assert.deepEqual(
      styles.map((s) => text.slice(s.start, s.start + s.len)),
      ["Thời gian:", "Thời gian:"],
    );
    assert.deepEqual(new Set(styles.map((s) => s.st)), new Set(["c_f27806", "b"]));
  });

  it("TẮT định dạng: thẻ màu bị BÓC, tuyệt đối không lọt ra chữ", async () => {
    // Persona vẫn dạy model cú pháp thẻ nên thẻ vẫn xuất hiện khi cấu hình tắt.
    // Người dùng nhận nguyên chuỗi "<cam>Thời gian:</cam>" thì tệ hơn mất màu.
    tuning.setTuning("ZALO_RICH_TEXT_ENABLED", false);
    await chayLuot("<cam>**Thời gian:**</cam> 7h00 thứ 7");

    const text = daGui[0]!;
    assert.ok(!text.includes("<"), `còn sót thẻ: ${text}`);
    assert.equal(text, "Thời gian: 7h00 thứ 7");
    assert.equal(daGuiStyle[0], undefined, "tắt rồi thì không đính styles");
  });
});
