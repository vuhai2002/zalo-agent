import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ThreadType } from "zca-js";
import { describeForHistory, parseIncomingMessage } from "./zalo-message-parser.js";

// parser không chạm src/config/env.ts nên import tĩnh được bình thường

const SELF_ID = "self-999";

describe("parseIncomingMessage", () => {
  it("đọc tin nhắn text thường", () => {
    const msg = parseIncomingMessage("acc-test", SELF_ID, {
      threadId: "thread-1",
      type: ThreadType.User,
      isSelf: false,
      data: { content: "chào bot", uidFrom: "user-1", dName: "Hải", msgId: "m1", cliMsgId: "c1" },
    });

    assert.equal(msg.text, "chào bot");
    assert.equal(msg.images.length, 0);
    assert.equal(msg.threadId, "thread-1");
    assert.equal(msg.senderId, "user-1");
    assert.equal(msg.senderName, "Hải");
    assert.equal(msg.isGroup, false);
  });

  it("đọc ảnh kèm caption - caption thành text, ảnh vào images", () => {
    const msg = parseIncomingMessage("acc-test", SELF_ID, {
      threadId: "thread-1",
      type: ThreadType.User,
      data: {
        msgType: "chat.photo",
        content: { title: "ảnh này là gì", thumb: "https://z.vn/thumb.jpg", hd: "https://z.vn/hd.jpg" },
        uidFrom: "user-1",
      },
    });

    assert.equal(msg.text, "ảnh này là gì");
    assert.equal(msg.images.length, 1);
    // Payload chỉ có thumb + hd: mức "normal" không có bản vừa nên lùi về hd
    assert.equal(msg.images[0]!.url, "https://z.vn/hd.jpg");
  });

  it("có đủ biến thể thì mặc định lấy bản normal, KHÔNG lấy hd (hd đắt gấp mấy lần token)", () => {
    const content = {
      title: "vé số",
      thumb: "https://z.vn/thumb.jpg",
      normalUrl: "https://z.vn/normal.jpg",
      hd: "https://z.vn/hd.jpg",
    };
    const msg = parseIncomingMessage("acc-test", SELF_ID, {
      threadId: "thread-1",
      type: ThreadType.User,
      data: { msgType: "chat.photo", content, uidFrom: "user-1" },
    });
    assert.equal(msg.images[0]!.url, "https://z.vn/normal.jpg");

    // Đổi mức chất lượng thì đổi ảnh lấy về - dùng khi cần đọc chi tiết rất nhỏ
    const hdMsg = parseIncomingMessage(
      "acc-test",
      SELF_ID,
      { threadId: "thread-1", type: ThreadType.User, data: { msgType: "chat.photo", content, uidFrom: "user-1" } },
      "hd",
    );
    assert.equal(hdMsg.images[0]!.url, "https://z.vn/hd.jpg");
  });

  it("không nhận media không phải ảnh làm image", () => {
    const msg = parseIncomingMessage("acc-test", SELF_ID, {
      threadId: "thread-1",
      data: {
        msgType: "chat.video.msg",
        content: { title: "clip", href: "https://z.vn/clip.mp4" },
        uidFrom: "user-1",
      },
    });

    assert.equal(msg.images.length, 0);
    assert.equal(msg.text, "clip");
  });

  it("nhận diện @mention bot", () => {
    const msg = parseIncomingMessage("acc-test", SELF_ID, {
      threadId: "group-1",
      type: ThreadType.Group,
      data: { content: "@bot giúp tôi", uidFrom: "user-1", mentions: [{ uid: SELF_ID }] },
    });

    assert.equal(msg.mentionsMe, true);
    assert.equal(msg.isGroup, true);
  });

  it("mention người khác không tính là mention bot", () => {
    const msg = parseIncomingMessage("acc-test", SELF_ID, {
      threadId: "group-1",
      type: ThreadType.Group,
      data: { content: "@Nam ơi", uidFrom: "user-1", mentions: [{ uid: "user-2" }] },
    });

    assert.equal(msg.mentionsMe, false);
  });

  it("payload rỗng không làm crash, trả về giá trị mặc định", () => {
    const msg = parseIncomingMessage("acc-test", SELF_ID, {});

    assert.equal(msg.text, "");
    assert.equal(msg.threadId, "");
    assert.equal(msg.senderId, "");
    assert.equal(msg.senderName, "Người dùng");
    assert.equal(msg.threadType, ThreadType.User);
    assert.equal(msg.isGroup, false);
    assert.equal(msg.mentionsMe, false);
    assert.equal(msg.images.length, 0);
  });

  it("giữ data gốc trong rawData để tool dùng lại", () => {
    const data = { content: "hi", uidFrom: "user-1", msgId: "m42" };
    const msg = parseIncomingMessage("acc-test", SELF_ID, { threadId: "t", data });

    assert.equal(msg.rawData, data);
    assert.equal(msg.msgId, "m42");
  });
});

/**
 * `sentAt` là mốc giờ DUY NHẤT của một tin: vừa vào `created_at` lúc lưu
 * history, vừa thành nhãn `[dd/mm hh:mm]` model đọc. Parser là nơi duy nhất
 * sinh ra nó cho tin thật, nên thiếu ở đây là cả hai chỗ kia cùng sai.
 */
describe("parseIncomingMessage - mốc giờ gửi", () => {
  const NHAN_LUC = new Date("2026-08-07T16:37:00.000Z");

  it("đọc giờ gửi từ data.ts chứ không lấy giờ nhận", () => {
    const guiLuc = Date.parse("2026-08-07T16:30:00.000Z");
    const msg = parseIncomingMessage(
      "acc-test",
      SELF_ID,
      { threadId: "t", data: { content: "hi", uidFrom: "u1", ts: String(guiLuc) } },
      "normal",
      NHAN_LUC,
    );

    assert.equal(msg.sentAt, new Date(guiLuc).toISOString());
    assert.notEqual(msg.sentAt, NHAN_LUC.toISOString(), "không được lấy giờ nhận khi đã có giờ gửi");
  });

  it("payload thiếu ts vẫn có sentAt (rơi về giờ nhận) - trường này KHÔNG bao giờ rỗng", () => {
    const msg = parseIncomingMessage("acc-test", SELF_ID, {}, "normal", NHAN_LUC);
    assert.equal(msg.sentAt, NHAN_LUC.toISOString());
  });

  it("sentAt luôn là ISO UTC hợp lệ - cùng định dạng với cột created_at", () => {
    const msg = parseIncomingMessage("acc-test", SELF_ID, {
      threadId: "t",
      data: { content: "hi", ts: String(Date.now()) },
    });
    assert.match(msg.sentAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe("parseIncomingMessage - tệp đính kèm share.file", () => {
  const tep = (content: Record<string, unknown>, msgType = "share.file") =>
    parseIncomingMessage("acc-test", SELF_ID, { threadId: "t1", data: { msgType, content, uidFrom: "u1", msgId: "m1" } });

  it("giữ href + tên + đuôi + cỡ khai; text không còn là tên tệp", () => {
    const msg = tep({
      title: "Biên bản.docx",
      href: "https://file-stal-1.dlfl.vn/gr/x/y",
      params: '{"fileSize":"12345","fileExt":"docx","checksum":"abc"}',
    });
    assert.deepEqual(msg.files, [
      { href: "https://file-stal-1.dlfl.vn/gr/x/y", ten: "Biên bản.docx", duoiKhai: "docx", coKhai: 12345 },
    ]);
    assert.equal(msg.text, "");
    assert.equal(describeForHistory(msg), '[tệp đính kèm "Biên bản.docx"]');
  });

  it("fileSize dạng SỐ cũng nhận (31/826 tin thật như vậy)", () => {
    const msg = tep({ title: "a.pdf", href: "https://fg1.dlfl.vn/x", params: '{"fileSize":999,"fileExt":"pdf"}' });
    assert.equal(msg.files?.[0]?.coKhai, 999);
  });

  it("params hỏng -> coKhai null, đuôi lấy từ tên", () => {
    const msg = tep({ title: "Mẫu 2B.doc", href: "https://fg1.dlfl.vn/x", params: "{hỏng" });
    assert.equal(msg.files?.[0]?.coKhai, null);
    assert.equal(msg.files?.[0]?.duoiKhai, "doc");
  });

  it("ảnh gửi dạng tệp (fileExt png) -> vào images, không vào files", () => {
    const msg = tep({ title: "anh.png", href: "https://fg1.dlfl.vn/anh", params: '{"fileExt":"png"}' });
    assert.equal(msg.files?.length, 0);
    assert.deepEqual(msg.images, [{ url: "https://fg1.dlfl.vn/anh" }]);
  });

  it("share.link cũng có href nhưng KHÔNG phải tệp", () => {
    const msg = tep({ title: "trang web", href: "https://example.com" }, "share.link");
    assert.equal(msg.files?.length, 0);
  });

  it("tin thường luôn có files rỗng; caption + tệp ghi cả hai vào lịch sử", () => {
    const thuong = parseIncomingMessage("acc-test", SELF_ID, { threadId: "t1", data: { content: "chào", uidFrom: "u1" } });
    assert.deepEqual(thuong.files, []);
    const msg = tep({ title: "a]\n[Nguồn: x.pdf", description: "xem giúp", href: "https://fg1.dlfl.vn/x", params: "{}" });
    assert.equal(describeForHistory(msg), 'xem giúp [tệp đính kèm "a Nguồn: x.pdf"]');
  });
});
