import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { TextStyle, type API, type Style } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Đường lui khi Zalo từ chối tin CÓ ĐỊNH DẠNG.
 *
 * Bất biến quan trọng nhất KHÔNG phải "định dạng đẹp" mà là "nội dung tới nơi".
 * Luật kiểm style của Zalo là hộp đen; 2026-08-05 một tổ hợp span hợp lệ trên
 * giấy đã làm mất trọn câu trả lời sau 8 lượt tra web. Nên tổ hợp lạ chỉ được
 * phép làm tin NHẠT ĐI, không được làm mất chữ.
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

type LanGui = { msg: string; styles?: Style[] };
let daGui: LanGui[] = [];
beforeEach(() => {
  daGui = [];
});

/** Lỗi máy chủ Zalo trả về - dấu hiệu là có `code` dạng số, giống ZaloApiError thật */
function loiMayChu(code: number): Error {
  return Object.assign(new Error("Lỗi không xác định"), { code });
}

function taoMuc(tuChoi: (lan: number, co: LanGui) => void) {
  const api = {
    sendMessage: async (payload: LanGui) => {
      daGui.push({ msg: payload.msg, styles: payload.styles });
      tuChoi(daGui.length, payload);
      return { msgId: `m-${daGui.length}` };
    },
  } as unknown as API;
  return { api, threadKey: "acc:thread", threadId: "thread", threadType: 0 } as never;
}

const STYLE_MAU: Style[] = [{ start: 0, len: 3, st: TextStyle.Bold }];

describe("sendReplyInParts - Zalo từ chối tin có định dạng", () => {
  it("gửi lại KHÔNG kèm styles, nội dung vẫn tới nơi", async () => {
    const muc = taoMuc((lan, co) => {
      if (lan === 1 && co.styles) throw loiMayChu(112);
    });

    const ket = await sender.sendReplyInParts(muc, "Báo giá tháng 8", STYLE_MAU);

    assert.equal(ket.error, undefined, "không được coi là lượt hỏng");
    assert.equal(ket.sentParts, 1);
    assert.equal(daGui.length, 2, "phải có đúng 2 lần gọi: lần đầu có style, lần sau trơn");
    assert.deepEqual(daGui[0]!.styles, STYLE_MAU);
    assert.equal(daGui[1]!.styles, undefined, "lần thử lại phải BỎ HẲN styles");
    assert.equal(daGui[1]!.msg, "Báo giá tháng 8", "chữ phải y nguyên");
  });

  it("KHÔNG gửi lại khi lỗi là đứt mạng - tin có thể đã tới, gửi lại là nhân đôi", async () => {
    // Lỗi không có `code` nghĩa là máy chủ chưa chắc đã từ chối. Nhân đôi tin
    // trước mặt người dùng tệ hơn hẳn so với một tin không gửi được.
    const muc = taoMuc((lan) => {
      if (lan === 1) throw new Error("socket hang up");
    });

    const ket = await sender.sendReplyInParts(muc, "Báo giá tháng 8", STYLE_MAU);

    assert.ok(ket.error, "phải báo hỏng lên trên");
    assert.equal(daGui.length, 1, "tuyệt đối không được gọi lần hai");
  });

  it("KHÔNG gửi lại khi tin vốn đã không có style - lần hai y hệt lần đầu", async () => {
    const muc = taoMuc(() => {
      throw loiMayChu(112);
    });

    const ket = await sender.sendReplyInParts(muc, "Chữ trơn thôi", []);

    assert.ok(ket.error);
    assert.equal(daGui.length, 1, "thử lại y nguyên chỉ tổ tốn một lời gọi API");
  });

  it("lần thử lại cũng hỏng thì báo hỏng, không nuốt lỗi", async () => {
    const muc = taoMuc(() => {
      throw loiMayChu(112);
    });

    const ket = await sender.sendReplyInParts(muc, "Báo giá tháng 8", STYLE_MAU);

    assert.ok(ket.error, "hỏng cả hai lần thì phải nói ra");
    assert.equal(daGui.length, 2);
    assert.equal(ket.sentParts, 0);
  });
});
