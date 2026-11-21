import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";
import { loiNhacSauGianDoan, loiNhacTraLoiTre } from "./loi-nhac-tra-loi-tre.js";

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
  it("sentAt hỏng thì bỏ qua tin đó; ngưỡng 0 thì nhắc ngay", () => {
    assert.equal(loiNhacTraLoiTre([{ ...tin("x", true), sentAt: "khong-phai-gio" }], NOW, 30, TZ), null);
    assert.notEqual(loiNhacTraLoiTre([tin("2026-03-10T11:59:59.000Z", true)], NOW, 0, TZ), null);
  });

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
    // Cùng định dạng nhãn dòng tin `[dd/mm HH:MM]` (dùng lại formatTimestamp)
    assert.ok(chu?.includes("sớm nhất [10/03 08:00]"), chu ?? "null");
  });

  it("chữ cố định giữ đủ các luật người dùng chốt", () => {
    const chu = loiNhacTraLoiTre([tin("2026-03-10T01:00:00.000Z", true)], NOW, 30, TZ) ?? "";
    // Bot chỉ gửi chữ của step CUỐI: câu xin lỗi phải nằm ở câu trả lời CHỐT, và
    // "sẽ xử lý ngay" chỉ khi chưa làm xong được (lúc gửi thì việc đã xong rồi)
    // Sự thật phải tới được model (ca thật 20/11: không biết hệ thống gián đoạn nên
    // bị hỏi "tại sao" thì tự nhận "mình quên đặt lịch"), mà giọng vẫn vui
    for (const doan of [
      "[Lời nhắc hệ thống]",
      "hệ thống của bạn bị gián đoạn",
      "bạn không hề quên",
      "câu trả lời CHỐT",
      "MỘT câu vui",
      "ngủ",
      "xưng hô như mọi khi",
      "KHÔNG bịa bệnh",
      "nói thật",
      "đừng nhận là mình quên",
      "chưa làm xong được",
    ]) {
      assert.ok(chu.includes(doan), `thiếu "${doan}"`);
    }
  });

  it("câu đùa lấy HỆ THỐNG làm chủ ngữ, không để model tự nhận mình ngủ", () => {
    // Eval model thật 2026-11-20, 3/3 lượt: câu mở đầu "mình vừa ngủ một giấc dài"
    // + nhãn "hệ thống gián đoạn" ở lượt sau = mâu thuẫn, model kết luận câu đùa là
    // "lời giải thích bịa" rồi xin lỗi vì thiếu trung thực. Câu đùa phải tự chở sự thật.
    const chu = loiNhacTraLoiTre([tin("2026-03-10T01:00:00.000Z", true)], NOW, 30, TZ) ?? "";
    assert.ok(chu.includes("hệ thống bên mình vừa ngủ"), chu);
    assert.ok(chu.includes("chủ ngữ là HỆ THỐNG"), chu);
    assert.ok(!chu.includes('"mình vừa tỉnh giấc"'), "ví dụ cũ lấy 'mình' làm chủ ngữ phải bỏ");
  });
});

describe("loiNhacSauGianDoan", () => {
  // Lượt SAU lượt trả lời trễ không còn `loiNhacTraLoiTre`. Eval model thật
  // 2026-11-20: bị trách "sao bạn sai sót" thì model xin lỗi và tự trách (kể cả
  // vì câu đùa lúc trước) - người dùng chốt: đó là lỗi HỆ THỐNG, không xin lỗi.
  const dong = (denTre?: boolean) => ({ role: "user" as const, content: "x", ...(denTre ? { denTre: true } : {}) });

  it("lịch sử không có tin mang nhãn gián đoạn: không nhắc gì", () => {
    assert.equal(loiNhacSauGianDoan([dong(), { role: "assistant" as const, content: "y" }]), null);
    assert.equal(loiNhacSauGianDoan([]), null);
  });

  it("có tin mang nhãn: nói rõ lỗi hệ thống, không xin lỗi, không tự trách", () => {
    const chu = loiNhacSauGianDoan([dong(), dong(true)]) ?? "";
    for (const doan of [
      "[Lời nhắc hệ thống]",
      "lỗi hệ thống, không phải lỗi của bạn",
      "KHÔNG xin lỗi",
      "KHÔNG tự trách",
      "đừng xin lỗi hay rút lại nó",
      "bình thản",
      "người ta không hỏi",
    ]) {
      assert.ok(chu.includes(doan), `thiếu "${doan}"`);
    }
  });
});
