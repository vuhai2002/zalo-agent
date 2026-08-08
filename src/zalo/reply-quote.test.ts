import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ThreadType } from "zca-js";
// Module thuần - không chạm env/DB nên import tĩnh được
import { laLoaiTrichDanDuoc, soByteTrichDan, trichDanTrongNganSach, trichDanTuTin } from "./reply-quote.js";
import type { ParsedMessage } from "./zalo-message-parser.js";

/** Payload thật của một tin text trong nhóm, đủ 8 trường `SendMessageQuote` cần */
function tinNhom(rawData: Record<string, unknown> = {}): ParsedMessage {
  return {
    accountId: "acc-1",
    threadId: "g-1",
    threadType: ThreadType.Group,
    isGroup: true,
    senderId: "u-hai",
    senderName: "Hải",
    text: "bot ơi tra giúp giá vàng",
    images: [],
    msgId: "m-1",
    cliMsgId: "c-1",
    isSelf: false,
    mentionsMe: true,
    sentAt: "2026-08-07T17:12:00.000Z",
    rawData: {
      content: "bot ơi tra giúp giá vàng",
      msgType: "webchat",
      propertyExt: { color: 0, size: 0, type: 0, subType: 0, ext: "" },
      uidFrom: "u-hai",
      msgId: "m-1",
      cliMsgId: "c-1",
      ts: "1786122720000",
      ttl: 0,
      ...rawData,
    },
  };
}

describe("trichDanTuTin - khi nào trích", () => {
  it("nhóm: dựng đủ 8 trường zca-js cần, lấy nguyên từ payload gốc", () => {
    const q = trichDanTuTin(tinNhom());
    assert.deepEqual(q, {
      content: "bot ơi tra giúp giá vàng",
      msgType: "webchat",
      propertyExt: { color: 0, size: 0, type: 0, subType: 0, ext: "" },
      uidFrom: "u-hai",
      msgId: "m-1",
      cliMsgId: "c-1",
      ts: "1786122720000",
      ttl: 0,
    });
  });

  it("chat RIÊNG không trích - hai người thì trích dẫn không thêm thông tin gì", () => {
    const rieng = { ...tinNhom(), isGroup: false, threadType: ThreadType.User };
    assert.equal(trichDanTuTin(rieng), undefined);
  });

  it("ts dạng SỐ vẫn nhận, đổi về chuỗi đúng kiểu zca-js chờ", () => {
    assert.equal(trichDanTuTin(tinNhom({ ts: 1786122720000 }))?.ts, "1786122720000");
  });

  it("thiếu ttl thì về 0, không để undefined lọt xuống payload", () => {
    assert.equal(trichDanTuTin(tinNhom({ ttl: undefined }))?.ttl, 0);
  });
});

/**
 * Hai loại dưới đây zca-js NÉM `ZaloApiError` không kèm mã số
 * (`sendMessage.ts`, khối `if (quote)`). Lỗi không mã thì `laLoiMayChuTuChoi`
 * không nhận ra là máy chủ từ chối, nên đường lui không chạy và cả câu trả lời
 * mất trắng. Phải chặn TRƯỚC khi gọi.
 */
describe("trichDanTuTin - loại tin zca-js từ chối trích", () => {
  it("group.poll: không trích", () => {
    assert.equal(trichDanTuTin(tinNhom({ msgType: "group.poll" })), undefined);
  });

  it("webchat mà content KHÔNG phải chuỗi: không trích", () => {
    assert.equal(
      trichDanTuTin(tinNhom({ msgType: "webchat", content: { title: "x", href: "y" } })),
      undefined,
    );
  });

  it("ảnh (chat.photo, content là object): VẪN trích - đừng chặn nhầm", () => {
    const q = trichDanTuTin(tinNhom({ msgType: "chat.photo", content: { title: "ảnh", href: "u" } }));
    assert.equal(q?.msgType, "chat.photo");
  });

  it("luật gốc khớp đúng hai điều kiện của zca-js, không hơn không kém", () => {
    assert.equal(laLoaiTrichDanDuoc("group.poll", "chữ"), false);
    assert.equal(laLoaiTrichDanDuoc("webchat", { a: 1 }), false);
    assert.equal(laLoaiTrichDanDuoc("webchat", "chữ"), true);
    assert.equal(laLoaiTrichDanDuoc("chat.photo", { a: 1 }), true);
    assert.equal(laLoaiTrichDanDuoc("share.file", { a: 1 }), true);
  });
});

describe("trichDanTuTin - thiếu định danh thì không trích", () => {
  for (const truong of ["msgId", "cliMsgId", "uidFrom", "ts"] as const) {
    it(`thiếu ${truong}: Zalo không tìm ra tin gốc nên bỏ trích dẫn`, () => {
      assert.equal(trichDanTuTin(tinNhom({ [truong]: "" })), undefined);
      assert.equal(trichDanTuTin(tinNhom({ [truong]: undefined })), undefined);
    });
  }

  it("tin TỔNG HỢP của lượt theo lịch (rawData rỗng) không trích", () => {
    // `buildSyntheticMessage` để msgId/cliMsgId rỗng có chủ đích - không có tin
    // thật nào để mà trích. Đây là cửa chặn thứ hai sau việc scheduler không
    // đặt `quote` trên ReplyTarget của nó.
    const tongHop: ParsedMessage = { ...tinNhom(), msgId: "", cliMsgId: "", rawData: {} };
    assert.equal(trichDanTuTin(tongHop), undefined);
  });
});

describe("trichDanTrongNganSach", () => {
  const TRAN = 3250;

  it("không có trích dẫn: trần giữ nguyên cho chữ của bot", () => {
    const r = trichDanTrongNganSach(undefined, TRAN);
    assert.equal(r.quote, undefined);
    assert.equal(r.tranConLai, TRAN);
    assert.equal(r.boViQuaDai, false);
  });

  it("trích dẫn ngắn: giữ, và TRỪ đúng phần nó chiếm khỏi trần", () => {
    const q = trichDanTuTin(tinNhom())!;
    const r = trichDanTrongNganSach(q, TRAN);
    assert.equal(r.quote, q);
    assert.equal(r.tranConLai, TRAN - soByteTrichDan(q));
    assert.ok(r.tranConLai < TRAN, "phải trừ thật, không được để nguyên trần");
  });

  it("trích dẫn QUÁ DÀI: bỏ hẳn, trả trần nguyên vẹn cho chữ", () => {
    // Người ta dán một đoạn dài rồi bot trích lại: riêng khối trích dẫn đã vượt
    // trần, mà `chiaTheoNganSachByte` chỉ đo chữ của bot nên vẫn báo mọi đoạn
    // đều lọt - tin đầu bị Zalo chối mà không ai hiểu vì sao.
    const dai = "x".repeat(2000);
    const q = trichDanTuTin(tinNhom({ content: dai }))!;
    const r = trichDanTrongNganSach(q, TRAN);
    assert.equal(r.quote, undefined, "mất khối trang trí còn hơn mất cả tin");
    assert.equal(r.tranConLai, TRAN);
    assert.equal(r.boViQuaDai, true, "phải nói ra để nơi gọi ghi log");
  });
});
