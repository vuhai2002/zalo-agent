import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ThreadType } from "zca-js";
import { doiUpdateSangParsedMessage } from "./zalo-bot-update-parser.js";
import type { ZaloBotUpdate } from "./zalo-bot-api-types.js";

/** Payload nguyên văn từ tài liệu chính thức mục Webhook */
const UPDATE_THAT: ZaloBotUpdate = {
  event_name: "message.text.received",
  message: {
    from: { id: "6ede9afa66b88fe6d6a9", display_name: "Ted", is_bot: false },
    chat: { id: "6ede9afa66b88fe6d6a9", chat_type: "PRIVATE" },
    text: "Xin chào",
    message_id: "2d758cb5e222177a4e35",
    date: 1750316131602,
  },
};

describe("doiUpdateSangParsedMessage", () => {
  it("đổi được payload nguyên văn của tài liệu", () => {
    const m = doiUpdateSangParsedMessage("bot-1", UPDATE_THAT);
    assert.equal(m?.text, "Xin chào");
    assert.equal(m?.senderName, "Ted");
    assert.equal(m?.threadId, "6ede9afa66b88fe6d6a9");
    assert.equal(m?.accountId, "bot-1");
    assert.equal(m?.isGroup, false);
    assert.equal(m?.threadType, ThreadType.User);
  });

  it("`date` là MILIGIÂY - đổi ra đúng năm 2025, không phải năm 57xxx", () => {
    // Telegram dùng GIÂY, Zalo dùng MILIGIÂY. Nhân nhầm 1000 thì `sentAt` nhảy
    // sang năm 57xxx mà không ai thấy ngay - nó chỉ hiện dạng "[dd/mm hh:mm]"
    // trong prompt. Ghim NĂM chứ không ghim cả chuỗi để test không phụ thuộc
    // múi giờ máy chạy.
    const m = doiUpdateSangParsedMessage("bot-1", UPDATE_THAT);
    assert.equal(new Date(m!.sentAt).getUTCFullYear(), 2025);
  });

  it("bỏ tin của BOT khác - chống hai bot nói chuyện vô tận", () => {
    const u: ZaloBotUpdate = {
      ...UPDATE_THAT,
      message: { ...UPDATE_THAT.message!, from: { id: "b2", display_name: "Bot Kia", is_bot: true } },
    };
    assert.equal(doiUpdateSangParsedMessage("bot-1", u), null);
  });

  it("nhóm ra đúng threadType và isGroup", () => {
    const u: ZaloBotUpdate = {
      ...UPDATE_THAT,
      message: { ...UPDATE_THAT.message!, chat: { id: "g1", chat_type: "GROUP" } },
    };
    const m = doiUpdateSangParsedMessage("bot-1", u);
    assert.equal(m?.isGroup, true);
    assert.equal(m?.threadType, ThreadType.Group);
    assert.equal(m?.threadId, "g1");
  });

  it("tin nhóm luôn mentionsMe - Zalo chỉ đẩy khi bot được nhắc tới", () => {
    // Khác kênh cá nhân: ở đó bot nhận MỌI tin nhóm nên phải tự lọc @mention.
    // Đường bot thì Zalo đã lọc sẵn, đặt false ở đây là bot câm trong nhóm.
    const u: ZaloBotUpdate = {
      ...UPDATE_THAT,
      message: { ...UPDATE_THAT.message!, chat: { id: "g1", chat_type: "GROUP" } },
    };
    assert.equal(doiUpdateSangParsedMessage("bot-1", u)?.mentionsMe, true);
  });

  it("ảnh: đọc được cả `photo` lẫn `photo_url`, và caption thành text", () => {
    const u: ZaloBotUpdate = {
      event_name: "message.image.received",
      message: { ...UPDATE_THAT.message!, text: undefined, photo: "https://a.test/1.jpg", caption: "cái bảng" },
    };
    const m = doiUpdateSangParsedMessage("bot-1", u);
    assert.deepEqual(m?.images, [{ url: "https://a.test/1.jpg" }]);
    assert.equal(m?.text, "cái bảng");

    const u2: ZaloBotUpdate = {
      event_name: "message.image.received",
      message: { ...UPDATE_THAT.message!, text: undefined, photo_url: "https://a.test/2.jpg" },
    };
    assert.deepEqual(doiUpdateSangParsedMessage("bot-1", u2)?.images, [{ url: "https://a.test/2.jpg" }]);
  });

  it("update không có message thì trả null, không ném", () => {
    assert.equal(doiUpdateSangParsedMessage("bot-1", { event_name: "gì đó lạ" }), null);
  });

  it("`date` hỏng thì lấy giờ hiện tại chứ không ra Invalid Date", () => {
    const u: ZaloBotUpdate = {
      ...UPDATE_THAT,
      message: { ...UPDATE_THAT.message!, date: 0 },
    };
    const m = doiUpdateSangParsedMessage("bot-1", u);
    assert.ok(!Number.isNaN(new Date(m!.sentAt).getTime()), `sentAt hỏng: ${m?.sentAt}`);
    assert.ok(new Date(m!.sentAt).getUTCFullYear() >= 2026);
  });
});
