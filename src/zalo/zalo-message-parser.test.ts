import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ThreadType } from "zca-js";
import { parseIncomingMessage } from "./zalo-message-parser.js";

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
    // hd được ưu tiên hơn thumb để vision đọc ảnh nét
    assert.equal(msg.images[0]!.url, "https://z.vn/hd.jpg");
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
