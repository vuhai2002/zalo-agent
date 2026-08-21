import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Style } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import type { DoanCanGui, ReplyTarget } from "./send-reply-in-parts.js";

/**
 * Kênh KHÔNG mang định dạng thì `styles` không được tính vào ngân sách byte.
 *
 * Bối cảnh: `soByteTin` (`split-styled-message.ts`) cộng cả
 * `JSON.stringify({styles})` vào ngân sách, còn `kenhBot.duongGui` thì VỨT
 * `styles` đi vì Bot API không hiểu chúng. Nên trên kênh bot, bộ cắt đang tính
 * tiền cho thứ không bao giờ đi trên dây - và chẻ thừa tin.
 *
 * Đây là lỗi CÓ SẴN của đường chat, không phải do đợt nối lịch hẹn sinh ra.
 * Sửa ở đây vì scheduler vừa thừa hưởng đúng đường ống đó.
 */
let dataDir: string;
let send: typeof import("./send-reply-in-parts.js");
let split: typeof import("./split-styled-message.js");
let tuning: typeof import("../config/runtime-tuning-settings.js");
let database: typeof import("../conversation/database.js");
let replyTarget: typeof import("./reply-target-tu-kenh.js");
let kenhBotFactory: typeof import("../zalo-bot/kenh-bot.js")["kenhBot"];

before(async () => {
  dataDir = setupTestEnv({ SEND_DELAY_MIN_MS: "0", SEND_DELAY_MAX_MS: "0" });
  send = await import("./send-reply-in-parts.js");
  split = await import("./split-styled-message.js");
  tuning = await import("../config/runtime-tuning-settings.js");
  database = await import("../conversation/database.js");
  replyTarget = await import("./reply-target-tu-kenh.js");
  kenhBotFactory = (await import("../zalo-bot/kenh-bot.js")).kenhBot;
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

let daGui: DoanCanGui[] = [];
beforeEach(() => {
  daGui = [];
});

/** Target giả; `mangDinhDang` để `undefined` nghĩa là kênh CÓ mang định dạng */
function target(p: { mangDinhDang?: boolean; nem?: () => never } = {}): ReplyTarget {
  return {
    guiMotDoan: async (doan) => {
      daGui.push(doan);
      p.nem?.();
      return {};
    },
    tranKyTuMotTin: 2000,
    mangDinhDang: p.mangDinhDang,
    threadKey: "acc:thread",
    threadId: "thread",
    threadType: 0,
  };
}

/**
 * Chuỗi + `styles` dày đặc span, chọn sao cho:
 *   byte chữ                     <= ngân sách  (kênh không định dạng: 1 tin)
 *   byte chữ + byte styles        > ngân sách  (kênh có định dạng: chẻ nhỏ)
 *
 * Hằng số KHÔNG đoán: `kiemChuanChuoiThu` bên dưới khẳng định đúng hai bất
 * đẳng thức đó trước khi bất kỳ ca nào dùng tới. Thiếu bước này thì ca so số
 * tin chỉ đang đo bộ cắt KÝ TỰ, không đo ngân sách BYTE.
 */
const NGAN_SACH_BYTE = 1200;
function chuoiThu(): { text: string; styles: Style[] } {
  // ~1000 ký tự. PHẢI dài hơn `KY_TU_TOI_THIEU` (400) một quãng rộng: bộ cắt
  // co trần ký tự dần từng 10% và dừng ở 400, nên chuỗi ngắn hơn mốc đó không
  // bao giờ chẻ được thêm tin - nó rơi vào nhánh BỎ ĐỊNH DẠNG thay vì nhánh
  // CHẺ NHỎ, và ca so số tin thành vô nghĩa. Bản đầu của fixture này dùng 360
  // ký tự và dính đúng bẫy đó; `kiemChuanChuoiThu` bắt được vì nó khẳng định
  // kênh có định dạng phải chẻ > 1 tin.
  const tu = Array.from({ length: 100 }, (_, i) => `tuso${String(i).padStart(5, "0")}`);
  const text = tu.join(" ");
  // Chỉ tô 20 từ đầu: đủ để JSON styles vượt phần dư ngân sách (cần > 200
  // byte) nhưng không nhiều tới mức MỘT NỬA số styles cũng còn vượt - lúc đó
  // kênh có định dạng chẻ mãi không lọt rồi lại rơi vào nhánh bỏ định dạng.
  const styles: Style[] = [];
  let vt = 0;
  for (const [i, t] of tu.entries()) {
    if (i < 20) styles.push({ start: vt, len: t.length, st: "b" } as unknown as Style);
    vt += t.length + 1;
  }
  return { text, styles };
}

function kiemChuanChuoiThu(): { text: string; styles: Style[] } {
  const { text, styles } = chuoiThu();
  const byteChu = split.soByteTin({ text, styles: [] });
  const byteCaHai = split.soByteTin({ text, styles });
  assert.ok(
    byteChu <= NGAN_SACH_BYTE,
    `chữ trần ${byteChu} byte đã vượt ngân sách ${NGAN_SACH_BYTE} - ca sẽ đo bộ cắt ký tự, không đo styles`,
  );
  assert.ok(
    byteCaHai > NGAN_SACH_BYTE,
    `chữ + styles mới ${byteCaHai} byte, chưa vượt ngân sách ${NGAN_SACH_BYTE} - ca sẽ xanh giả`,
  );
  return { text, styles };
}

describe("ngân sách byte theo kênh", () => {
  it("kênh KHÔNG mang định dạng: `guiMotDoan` không nhận styles, chữ vẫn đã bóc markdown", async () => {
    const kq = await send.sendReplyInParts(target({ mangDinhDang: false }), "Bảng giá đây anh", [
      { start: 0, len: 8, st: "b" } as unknown as Style,
    ]);

    assert.equal(kq.sentParts, 1);
    assert.ok(
      !daGui[0]!.styles || daGui[0]!.styles.length === 0,
      "kênh bot nhận styles - Bot API không hiểu, và ngân sách byte đã tính thừa",
    );
    assert.ok(!daGui[0]!.text.includes("*"), "chữ phải đã được bóc markdown ở tầng trên");
  });

  it("styles bị vứt thì KHÔNG được tính vào ngân sách byte - kênh bot chẻ ít tin hơn", async () => {
    const { text, styles } = kiemChuanChuoiThu();
    tuning.setTuning("ZALO_RICH_TEXT_MAX_PAYLOAD_BYTES", NGAN_SACH_BYTE);
    try {
      await send.sendReplyInParts(target(), text, styles);
      const soTinKenhCoDinhDang = daGui.length;
      // Nếu bộ cắt rơi vào nhánh BỎ ĐỊNH DẠNG (đoạn quá nặng, co hết cỡ vẫn
      // vượt) thì nó cũng ra ít tin - ca này sẽ so hai con số giống nhau vì lý
      // do hoàn toàn khác thứ đang đo. Chốt lại bằng TỔNG số span giao được:
      // mất span nghĩa là đã rơi vào nhánh bỏ định dạng.
      //
      // KHÔNG khẳng định "mọi đoạn đều còn styles" - đoạn cuối vốn thường là
      // văn xuôi không có span nào, đúng báo động giả mà docstring của
      // `demDoanBoDinhDang` đã cảnh báo. Bản đầu của ca này viết đúng như vậy
      // và đỏ oan.
      const tongSpan = daGui.reduce((n, d) => n + (d.styles ?? []).length, 0);
      assert.equal(
        tongSpan,
        styles.length,
        "kênh có định dạng bị BỎ định dạng thay vì chẻ nhỏ - fixture sai, ca này đang đo nhầm nhánh",
      );

      daGui = [];
      await send.sendReplyInParts(target({ mangDinhDang: false }), text, styles);
      const soTinKenhBot = daGui.length;

      assert.ok(
        soTinKenhCoDinhDang > 1,
        `kênh có định dạng phải bị CHẺ (đang ${soTinKenhCoDinhDang} tin) - không thì ca này không so được gì`,
      );
      assert.equal(
        soTinKenhBot,
        1,
        `kênh bot chẻ ${soTinKenhBot} tin cho một đoạn chữ vừa khít ngân sách - đang tính cả styles sắp bị vứt`,
      );
    } finally {
      tuning.setTuning("ZALO_RICH_TEXT_MAX_PAYLOAD_BYTES", null);
    }
  });

  it("kênh KHÔNG mang định dạng: máy chủ từ chối thì KHÔNG gửi lại lần hai", async () => {
    // `sendOneCoDuongLui` thử lại "không định dạng" khi `styles.length > 0`.
    // Trên kênh bot, gửi lại là gửi lại Y HỆT (styles vốn đã bị vứt) - tốn
    // thêm một lời gọi API mà không đổi được gì. Hôm nay nhánh đó không chạy
    // vì `laLoiMayChuTuChoi` không nhận ra `LoiZaloBotApi`, tức ĐÚNG một cách
    // tình cờ. Ca này khoá hành vi lại bằng lý do tường minh, để lần sau ai
    // "dọn dẹp" `laLoiMayChuTuChoi` thì thấy đỏ ở đây chứ không phát hiện
    // bằng cách nhìn log gọi API đôi.
    const loi = Object.assign(new Error("máy chủ từ chối"), { code: 112 });
    const kq = await send.sendReplyInParts(
      target({
        mangDinhDang: false,
        nem: () => {
          throw loi;
        },
      }),
      "một câu ngắn",
      [{ start: 0, len: 3, st: "b" } as unknown as Style],
    );

    assert.equal(kq.sentParts, 0);
    assert.equal(daGui.length, 1, "đã gửi lại lần hai dù kênh này vốn không mang định dạng");
  });

  it("kênh CÓ định dạng vẫn thử lại chữ trơn khi máy chủ từ chối - không hồi quy", async () => {
    // Đối chứng cho ca trên: cùng một tình huống, kênh cá nhân PHẢI có đường
    // lui (mất định dạng còn hơn mất nội dung - lỗi mã 112 ngày 2026-08-05).
    let lanGoi = 0;
    const muc: ReplyTarget = {
      guiMotDoan: async (doan) => {
        lanGoi += 1;
        daGui.push(doan);
        if (lanGoi === 1) throw Object.assign(new Error("mã 112"), { code: 112 });
        return {};
      },
      threadKey: "acc:thread",
      threadId: "thread",
      threadType: 0,
    };

    const kq = await send.sendReplyInParts(muc, "một câu ngắn", [
      { start: 0, len: 3, st: "b" } as unknown as Style,
    ]);

    assert.equal(kq.sentParts, 1);
    assert.equal(lanGoi, 2, "kênh cá nhân mất đường lui 'gửi lại chữ trơn'");
    assert.ok((daGui[0]!.styles ?? []).length > 0, "lần đầu phải có styles");
    assert.ok((daGui[1]!.styles ?? []).length === 0, "lần lui phải bỏ styles");
  });

  it("chuỗi THẬT: kenhBot -> replyTargetTuKenh -> sendReplyInParts không mang styles", async () => {
    // Bốn ca trên dùng target GIẢ nên chúng chỉ chứng minh `sendReplyInParts`
    // tôn trọng cờ - không chứng minh cờ có được KHAI và có được CHỞ tới nơi.
    // Đo bằng phép phá: bỏ `mangDinhDang` khỏi `kenhBot()` thì cả bốn ca đó
    // vẫn xanh. Ca này đi trọn chuỗi thật để bịt đúng khe đó.
    const daGuiBot: { text: string; parseMode: unknown }[] = [];
    const client = {
      sendMessage: async (_chatId: string, text: string, parseMode: unknown) => {
        daGuiBot.push({ text, parseMode });
        return {};
      },
      sendChatAction: async () => ({}),
    } as unknown as Parameters<typeof kenhBotFactory>[0];

    const muc = replyTarget.replyTargetTuKenh({
      kenh: kenhBotFactory(client),
      threadId: "chat-1",
      threadType: 0,
      threadKey: "acc:chat-1",
    });

    assert.equal(muc.mangDinhDang, false, "cờ không đi từ kênh bot tới ReplyTarget");
    await send.sendReplyInParts(muc, "Bảng giá đây anh", [{ start: 0, len: 8, st: "b" } as unknown as Style]);

    assert.deepEqual(daGuiBot, [{ text: "Bảng giá đây anh", parseMode: null }]);
  });

  it("`mangDinhDang` thiếu = CÓ - mọi call site cũ giữ nguyên hành vi", async () => {
    // Cờ là TÙY CHỌN nên mọi `ReplyTarget` viết trước đợt này đều không khai.
    // Điều kiện phải là `=== false`, không phải `!== true`.
    await send.sendReplyInParts(target(), "Bảng giá", [{ start: 0, len: 8, st: "b" } as unknown as Style]);
    assert.equal((daGui[0]!.styles ?? []).length, 1, "target không khai cờ mà bị mất styles");
  });
});
