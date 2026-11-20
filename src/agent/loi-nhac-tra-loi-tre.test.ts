import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";
import { loiNhacTraLoiTre } from "./loi-nhac-tra-loi-tre.js";

/**
 * Lượt có tin lấy bù trễ quá ngưỡng phải nhắc model mở đầu bằng MỘT câu vui
 * xin lỗi vì trả lời muộn - lý do mơ hồ, không bịa bệnh (người dùng chốt).
 */
const NOW = new Date("2026-03-10T12:00:00.000Z");
const TZ = "Asia/Ho_Chi_Minh";

function tin(sentAt: string, layBu: boolean): ParsedMessage {
  return {
    accountId: "acc",
    threadId: "t",
    threadType: 0,
    isGroup: false,
    senderId: "u-lan",
    senderName: "Lan",
    text: "Hẹn họp lúc 9h nhé",
    images: [],
    msgId: sentAt,
    cliMsgId: "c",
    isSelf: false,
    mentionsMe: false,
    sentAt,
    rawData: {},
    ...(layBu ? { layBu: true as const } : {}),
  };
}

describe("loiNhacTraLoiTre", () => {
  it("batch không có tin lấy bù -> null", () => {
    assert.equal(loiNhacTraLoiTre([tin("2026-03-10T01:00:00.000Z", false)], NOW, 30, TZ), null);
  });

  it("trễ 29 phút, ngưỡng 30 -> null; trễ đúng 30 phút -> có lời nhắc", () => {
    assert.equal(loiNhacTraLoiTre([tin("2026-03-10T11:31:00.000Z", true)], NOW, 30, TZ), null);
    assert.notEqual(loiNhacTraLoiTre([tin("2026-03-10T11:30:00.000Z", true)], NOW, 30, TZ), null);
  });

  it("mốc giờ là tin lấy bù SỚM NHẤT, theo múi giờ của bot", () => {
    const chu = loiNhacTraLoiTre(
      [tin("2026-03-10T01:00:00.000Z", true), tin("2026-03-10T02:00:00.000Z", true), tin("2026-03-10T00:00:00.000Z", false)],
      NOW,
      30,
      TZ,
    );
    assert.ok(chu?.includes("sớm nhất 08:00 10/03"), chu ?? "null");
  });

  it("chữ cố định giữ đủ các luật người dùng chốt", () => {
    const chu = loiNhacTraLoiTre([tin("2026-03-10T01:00:00.000Z", true)], NOW, 30, TZ) ?? "";
    for (const doan of ["[Lời nhắc hệ thống]", "MỘT câu vui", "xưng hô như mọi khi", "KHÔNG bịa bệnh", "đợi chút"]) {
      assert.ok(chu.includes(doan), `thiếu "${doan}"`);
    }
  });
});
