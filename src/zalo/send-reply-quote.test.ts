import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { TextStyle, type API, type SendMessageQuote, type Style } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Trích dẫn đi qua đường gửi thật: đính vào đâu, và bỏ lúc nào.
 *
 * Hai bất biến quan trọng hơn cả việc "có trích dẫn":
 *
 *   1. CHỈ ĐOẠN ĐẦU mang trích dẫn. Câu trả lời dài bị cắt làm nhiều tin; trích
 *      lại ở mỗi tin thì khối trích dẫn lặp đầy màn hình. goclaw gỡ
 *      `reply_to_message_id` khỏi mọi tin trung gian vì đúng lý do này.
 *   2. Trích dẫn KHÔNG được làm mất chữ. Zalo từ chối thì gửi lại trơn - cùng
 *      luật đã dựng cho tổ hợp style ngày 05/08.
 *
 * `send-reply-in-parts.ts` đọc cấu hình qua `getTuning` (chạm SQLite) nên phải
 * `setupTestEnv()` trước rồi mới import động.
 */

let dataDir: string;
let sender: typeof import("./send-reply-in-parts.js");

before(async () => {
  dataDir = setupTestEnv();
  sender = await import("./send-reply-in-parts.js");
});

after(async () => {
  (await import("../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

type LanGui = { msg: string; styles?: Style[]; quote?: SendMessageQuote; khoa: string[] };
let daGui: LanGui[] = [];
beforeEach(() => {
  daGui = [];
});

const TRICH_DAN = {
  content: "bot ơi tra giúp giá vàng",
  msgType: "webchat",
  propertyExt: undefined,
  uidFrom: "u-hai",
  msgId: "m-1",
  cliMsgId: "c-1",
  ts: "1786122720000",
  ttl: 0,
} as unknown as SendMessageQuote;

/** Lỗi máy chủ Zalo trả về - dấu hiệu là có `code` dạng số, giống ZaloApiError thật */
function loiMayChu(code: number): Error {
  return Object.assign(new Error("Lỗi không xác định"), { code });
}

function taoMuc(quote: SendMessageQuote | undefined, tuChoi: (lan: number, co: LanGui) => void = () => {}) {
  const api = {
    sendMessage: async (payload: { msg: string; styles?: Style[]; quote?: SendMessageQuote }) => {
      // Ghi lại cả DANH SÁCH KHÓA của payload thật: `quote: undefined` và
      // "không có khóa quote" là hai chuyện khác nhau với zca-js (có khóa là
      // nó đổi sang endpoint `.../quote`), mà object mình tự dựng lại thì luôn
      // có đủ khóa - đo trên đó là đo nhầm chính mình.
      const ghi: LanGui = { ...payload, khoa: Object.keys(payload) };
      daGui.push(ghi);
      tuChoi(daGui.length, ghi);
      return { msgId: `m-${daGui.length}` };
    },
  } as unknown as API;
  return { api, threadKey: "acc:thread", threadId: "thread", threadType: 1, quote } as never;
}

const STYLE_MAU: Style[] = [{ start: 0, len: 3, st: TextStyle.Bold }];

describe("sendReplyInParts - đính trích dẫn", () => {
  it("câu trả lời một đoạn: trích dẫn đi kèm", async () => {
    await sender.sendReplyInParts(taoMuc(TRICH_DAN), "Giá vàng hôm nay là...");

    assert.equal(daGui.length, 1);
    assert.deepEqual(daGui[0]!.quote, TRICH_DAN);
  });

  it("không có trích dẫn (chat riêng) thì KHÔNG đính trường quote", async () => {
    await sender.sendReplyInParts(taoMuc(undefined), "Chào anh");

    assert.equal(daGui.length, 1);
    assert.deepEqual(daGui[0]!.khoa, ["msg"], "đính quote rỗng là đổi hẳn endpoint zca-js gọi tới");
  });

  it("câu trả lời bị cắt nhiều đoạn: CHỈ đoạn đầu có trích dẫn", async () => {
    // Trần mặc định ZALO_MAX_MESSAGE_CHARS = 2000 nên 5000 ký tự chắc chắn cắt
    const dai = "Câu trả lời rất dài. ".repeat(250);
    await sender.sendReplyInParts(taoMuc(TRICH_DAN), dai);

    assert.ok(daGui.length >= 2, `phải cắt nhiều đoạn, đang có ${daGui.length}`);
    assert.deepEqual(daGui[0]!.quote, TRICH_DAN, "đoạn đầu phải trích");
    for (let i = 1; i < daGui.length; i++) {
      assert.ok(!daGui[i]!.khoa.includes("quote"), `đoạn ${i + 1} không được trích lại`);
    }
  });

  it("tin được trích QUÁ DÀI: gửi không kèm trích dẫn thay vì để Zalo chối", async () => {
    const quaDai = { ...TRICH_DAN, content: "x".repeat(2000) } as SendMessageQuote;
    const ket = await sender.sendReplyInParts(taoMuc(quaDai), "Trả lời ngắn");

    assert.equal(ket.error, undefined);
    assert.deepEqual(daGui[0]!.khoa, ["msg"], "không được đính khóa quote nào cả");
    assert.equal(daGui[0]!.msg, "Trả lời ngắn", "chữ phải y nguyên");
  });
});

describe("sendReplyInParts - đường lui khi Zalo từ chối tin có trích dẫn", () => {
  it("gửi lại KHÔNG kèm trích dẫn, nội dung vẫn tới nơi", async () => {
    const muc = taoMuc(TRICH_DAN, (lan, co) => {
      if (lan === 1 && co.quote) throw loiMayChu(118);
    });

    const ket = await sender.sendReplyInParts(muc, "Giá vàng hôm nay là...");

    assert.equal(ket.error, undefined, "không được coi là lượt hỏng");
    assert.equal(ket.sentParts, 1);
    assert.equal(daGui.length, 2, "đúng 2 lần gọi: lần đầu có trích dẫn, lần sau trơn");
    assert.deepEqual(daGui[1]!.khoa, ["msg"], "lần thử lại phải BỎ HẲN trích dẫn");
    assert.equal(daGui[1]!.msg, "Giá vàng hôm nay là...", "chữ phải y nguyên");
  });

  it("lần thử lại bỏ CẢ style LẪN trích dẫn - không đoán bên nào là thủ phạm", async () => {
    const muc = taoMuc(TRICH_DAN, (lan) => {
      if (lan === 1) throw loiMayChu(112);
    });

    await sender.sendReplyInParts(muc, "Giá vàng", STYLE_MAU);

    assert.equal(daGui.length, 2);
    assert.deepEqual(daGui[1]!.khoa, ["msg"], "lần thử lại chỉ còn đúng chữ trơn");
  });

  it("KHÔNG gửi lại khi lỗi là đứt mạng - tin có thể đã tới, gửi lại là nhân đôi", async () => {
    const muc = taoMuc(TRICH_DAN, (lan) => {
      if (lan === 1) throw new Error("socket hang up");
    });

    const ket = await sender.sendReplyInParts(muc, "Giá vàng hôm nay là...");

    assert.ok(ket.error, "phải báo hỏng lên trên");
    assert.equal(daGui.length, 1, "tuyệt đối không được gọi lần hai");
  });

  it("không style, không trích dẫn thì KHÔNG thử lại - lần hai y hệt lần đầu", async () => {
    const muc = taoMuc(undefined, () => {
      throw loiMayChu(112);
    });

    const ket = await sender.sendReplyInParts(muc, "Chữ trơn thôi");

    assert.ok(ket.error);
    assert.equal(daGui.length, 1, "thử lại y nguyên chỉ tổ tốn một lời gọi API");
  });
});
