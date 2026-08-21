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

  it("sticker / tin thoại / loại lạ ra NHÃN, không phải tin rỗng", () => {
    // Tin rỗng dựng ra một lượt agent trắng trơn: model không biết người ta vừa
    // gửi cái gì mà bot không đọc được, nên trả lời vu vơ.
    const nhan = (eventName: string, them: Record<string, unknown>) =>
      doiUpdateSangParsedMessage("bot-1", {
        event_name: eventName,
        message: { ...UPDATE_THAT.message!, text: undefined, ...them },
      } as ZaloBotUpdate)?.text;

    assert.equal(nhan("message.sticker.received", { sticker: "s1" }), "[gửi một sticker]");
    assert.equal(nhan("message.voice.received", { voice_url: "https://v.test/a.m4a" }), "[gửi một tin thoại]");
    assert.equal(nhan("message.unsupported.received", {}), "[gửi một nội dung bot chưa đọc được]");
  });

  it("ảnh KHÔNG moi được URL thì có NHÃN - không để tin biến mất im lặng", () => {
    // Bản vá cho một lỗi mất tin: Zalo đổi tên trường ảnh -> `text` rỗng và
    // `images` rỗng -> `shouldRespond` bỏ qua với `record: false` -> tin không
    // vào history, chỉ một dòng debug. Kênh này không có `offset` nên đó là mất
    // hẳn. Bản vá đó chưa có test nào canh: xóa nó đi thì cả suite vẫn xanh.
    const m = doiUpdateSangParsedMessage("bot-1", {
      event_name: "message.image.received",
      message: { ...UPDATE_THAT.message!, text: undefined, photo: undefined, photo_url: undefined },
    } as ZaloBotUpdate);
    assert.match(m?.text ?? "", /ảnh/, `ảnh không moi được URL mà không có nhãn: ${JSON.stringify(m?.text)}`);
    assert.deepEqual(m?.images, []);
  });

  it("ảnh KHÔNG bị gắn nhãn - nó có đường riêng qua `images`", () => {
    const m = doiUpdateSangParsedMessage("bot-1", {
      event_name: "message.image.received",
      message: { ...UPDATE_THAT.message!, text: undefined, photo: "https://a.test/1.jpg" },
    } as ZaloBotUpdate);
    assert.equal(m?.text, "", "ảnh bị gắn nhãn thừa - nó đã nằm trong images rồi");
    assert.equal(m?.images.length, 1);
  });

  it("update không có message thì trả null, không ném", () => {
    assert.equal(doiUpdateSangParsedMessage("bot-1", { event_name: "gì đó lạ" }), null);
  });

  it("`date` hỏng thì lấy giờ hiện tại chứ không ra Invalid Date", () => {
    const u: ZaloBotUpdate = {
      ...UPDATE_THAT,
      message: { ...UPDATE_THAT.message!, date: 0 },
    };
    // Kẹp giữa hai mốc chụp QUANH lời gọi thay vì so với một năm cố định -
    // khẳng định theo đồng hồ máy chạy là thứ repo vừa dọn ở đợt trước.
    const truoc = Date.now();
    const m = doiUpdateSangParsedMessage("bot-1", u);
    const sau = Date.now();
    const t = new Date(m!.sentAt).getTime();
    assert.ok(!Number.isNaN(t), `sentAt hỏng: ${m?.sentAt}`);
    assert.ok(t >= truoc && t <= sau, `sentAt ${m?.sentAt} nằm ngoài [${truoc}, ${sau}]`);
  });

  it("tin NHÓM của kênh bot KHÔNG sinh trích dẫn - lưới chắn phải tường minh", async () => {
    // `mangDinhDang` chữa được ca `styles` bị tính vào ngân sách byte rồi bị
    // đường gửi vứt. `quote` là ANH EM SINH ĐÔI chưa được gắn cờ đó:
    // `message-turn-processor` đặt `quote` cho CẢ HAI kênh, `kenhBot.duongGui`
    // thì vứt nó, mà `trichDanTrongNganSach` vẫn trừ tới 30% ngân sách byte
    // cho một khối không bao giờ đi trên dây.
    //
    // Hôm nay không chạm tới được, nhưng nhờ một lưới chắn TÌNH CỜ:
    // `trichDanTuTin` đọc `msg.rawData.msgType`, mà parser này đặt
    // `rawData: {...m}` từ `ZaloBotMessage` - kiểu đó không có `msgType`. Zalo
    // thêm một trường trùng tên vào payload bot là cửa mở lại ngay.
    //
    // Ca này biến lưới tình cờ thành lưới có canh. KHÔNG thêm cờ
    // `mangTrichDan`: YAGNI cho tới khi có kênh thứ ba, và một ca test rẻ hơn
    // một trường phải chở qua bốn chỗ.
    const { trichDanTuTin } = await import("../zalo/reply-quote.js");
    const u: ZaloBotUpdate = {
      event_name: "message.text.received",
      message: {
        from: { id: "u1", display_name: "Hải", is_bot: false },
        chat: { id: "g1", chat_type: "GROUP" },
        text: "cho hỏi bảng giá",
        message_id: "m1",
        date: 1750316131602,
      },
    };
    const m = doiUpdateSangParsedMessage("bot-1", u);
    assert.equal(m?.isGroup, true, "fixture phải là tin NHÓM - chat riêng vốn không trích, ca này sẽ đo rỗng");
    assert.equal(
      trichDanTuTin(m!),
      undefined,
      "kênh bot sinh trích dẫn - nó sẽ bị `duongGui` vứt nhưng vẫn ăn ngân sách byte",
    );
  });

});
