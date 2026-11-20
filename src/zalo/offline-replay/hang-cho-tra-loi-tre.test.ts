import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { ParsedMessage } from "../zalo-message-parser.js";
import { HangChoTraLoiTre } from "./hang-cho-tra-loi-tre.js";

/**
 * Hàng chờ trả lời trễ: tin lấy bù đã ghi lịch sử chờ ở đây rồi được nhả TỪNG
 * hội thoại vào bộ gộp, cách nhau một nhịp ngẫu nhiên - sau một lần mất kết nối
 * dài, cả chục người được trả lời dồn trong vài giây là kiểu dễ bị Zalo gắn cờ.
 */
beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout"] });
});

afterEach(() => {
  mock.timers.reset();
});

function tin(threadId: string, sentAt: string, extra: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    accountId: "acc",
    threadId,
    threadType: 0,
    isGroup: false,
    senderId: `u-${threadId}`,
    senderName: `Người ${threadId}`,
    text: "Hẹn họp lúc 9h nhé",
    images: [],
    msgId: `${threadId}-${sentAt}`,
    cliMsgId: "c",
    isSelf: false,
    mentionsMe: false,
    sentAt,
    rawData: {},
    layBu: true,
    ...extra,
  };
}

const key = (t: string) => `acc:${t}`;

function dung(gian: [number, number] = [20_000, 60_000]) {
  const enq: [string, string][] = [];
  const boQua: ParsedMessage[][] = [];
  const hang = new HangChoTraLoiTre({
    accountId: "acc",
    enqueue: (tk, m) => enq.push([tk, m.msgId]),
    gianCachMs: () => gian,
    luuAnhTinBoQua: (msgs) => boQua.push(msgs),
    random: () => 0,
  });
  return { hang, enq, boQua };
}

describe("nhả có giãn nhịp", () => {
  it("thread theo giờ gửi sớm nhất; mỗi thread đủ tin theo thứ tự; thread kế đúng sau nhịp tối thiểu", () => {
    const { hang, enq } = dung();
    hang.them(key("b"), tin("b", "2026-03-10T08:00:00.000Z"));
    hang.them(key("a"), tin("a", "2026-03-10T07:30:00.000Z"));
    hang.them(key("a"), tin("a", "2026-03-10T07:00:00.000Z"));
    hang.them(key("c"), tin("c", "2026-03-10T09:00:00.000Z"));
    hang.nha();
    assert.deepEqual(
      enq.map(([tk, id]) => [tk, id]),
      [
        [key("a"), "a-2026-03-10T07:00:00.000Z"],
        [key("a"), "a-2026-03-10T07:30:00.000Z"],
      ],
    );
    mock.timers.tick(19_999);
    assert.equal(enq.length, 2, "thread kế nhả sớm hơn nhịp tối thiểu");
    mock.timers.tick(1);
    assert.equal(enq.at(-1)?.[0], key("b"));
    mock.timers.tick(20_000);
    assert.equal(enq.at(-1)?.[0], key("c"));
    assert.equal(hang.soThreadDangCho(), 0);
  });

  it("nhịp lấy trong [min, max] kể cả khi cấu hình đảo ngược (min > max)", () => {
    const { hang, enq } = dung([60_000, 20_000]);
    hang.them(key("a"), tin("a", "2026-03-10T07:00:00.000Z"));
    hang.them(key("b"), tin("b", "2026-03-10T08:00:00.000Z"));
    hang.nha();
    mock.timers.tick(20_000);
    assert.equal(enq.length, 2, "min/max đảo ngược phải được chuẩn hóa về [20s, 60s]");
  });

  it("gọi nha() khi đang nhả thì không nhả chồng; them() sau đó vẫn tới lượt", () => {
    const { hang, enq } = dung();
    hang.them(key("a"), tin("a", "2026-03-10T07:00:00.000Z"));
    hang.them(key("b"), tin("b", "2026-03-10T08:00:00.000Z"));
    hang.nha();
    hang.nha();
    assert.equal(enq.length, 1);
    hang.them(key("c"), tin("c", "2026-03-10T09:00:00.000Z"));
    mock.timers.tick(20_000);
    mock.timers.tick(20_000);
    assert.deepEqual(
      enq.map(([tk]) => tk),
      [key("a"), key("b"), key("c")],
    );
  });

  it("nhả hết rồi, lượt sau them() + nha() lại chạy được", () => {
    const { hang, enq } = dung();
    hang.them(key("a"), tin("a", "2026-03-10T07:00:00.000Z"));
    hang.nha();
    mock.timers.tick(60_000);
    hang.them(key("b"), tin("b", "2026-03-10T08:00:00.000Z"));
    hang.nha();
    assert.equal(enq.at(-1)?.[0], key("b"));
  });
});

describe("đã có người trả lời", () => {
  it("tin của tài khoản SAU tin chờ cuối: bỏ lượt thread đó, lưu ảnh, không tốn nhịp", () => {
    const { hang, enq, boQua } = dung();
    hang.them(key("a"), tin("a", "2026-03-10T07:00:00.000Z"));
    hang.ghiNhanTinSelf(key("a"), "2026-03-10T07:05:00.000Z");
    hang.them(key("b"), tin("b", "2026-03-10T08:00:00.000Z"));
    hang.nha();
    assert.deepEqual(
      enq.map(([tk]) => tk),
      [key("b")],
    );
    assert.equal(boQua.length, 1);
    assert.equal(boQua[0]?.[0]?.threadId, "a");
  });

  it("tin của tài khoản TRƯỚC tin chờ: vẫn trả lời", () => {
    const { hang, enq } = dung();
    hang.ghiNhanTinSelf(key("a"), "2026-03-10T06:00:00.000Z");
    hang.them(key("a"), tin("a", "2026-03-10T07:00:00.000Z"));
    hang.nha();
    assert.equal(enq.length, 1);
  });
});

describe("tin trực tiếp chen vào", () => {
  it("nhaNgay: đẩy NGAY tin chờ của thread (giữ cờ layBu), gỡ khỏi hàng; không có thì false", () => {
    const { hang, enq } = dung();
    hang.them(key("a"), tin("a", "2026-03-10T07:00:00.000Z"));
    hang.them(key("b"), tin("b", "2026-03-10T08:00:00.000Z"));
    hang.nha();
    assert.equal(hang.nhaNgay(key("b")), true);
    assert.deepEqual(
      enq.map(([tk]) => tk),
      [key("a"), key("b")],
    );
    assert.equal(hang.nhaNgay(key("b")), false);
    mock.timers.tick(120_000);
    assert.equal(enq.length, 2, "thread đã nhả ngay bị nhả lần hai");
  });

  it("nhaNgay chạy được cả khi hàng chờ chưa bắt đầu nhả", () => {
    const enq: ParsedMessage[] = [];
    const hang = new HangChoTraLoiTre({
      accountId: "acc",
      enqueue: (_tk, m) => enq.push(m),
      gianCachMs: () => [20_000, 60_000],
      luuAnhTinBoQua: () => {},
    });
    hang.them(key("a"), tin("a", "2026-03-10T07:00:00.000Z"));
    assert.equal(hang.nhaNgay(key("a")), true);
    assert.equal(enq[0]?.layBu, true);
  });
});

describe("dừng", () => {
  it("dungVaBaoBoDo: trả thread còn chờ, sau đó không enqueue gì nữa", () => {
    const { hang, enq } = dung();
    hang.them(key("a"), tin("a", "2026-03-10T07:00:00.000Z"));
    hang.them(key("b"), tin("b", "2026-03-10T08:00:00.000Z"));
    hang.nha();
    assert.deepEqual(hang.dungVaBaoBoDo(), [key("b")]);
    mock.timers.tick(600_000);
    hang.them(key("c"), tin("c", "2026-03-10T09:00:00.000Z"));
    hang.nha();
    assert.equal(enq.length, 1);
  });

  it("enqueue ném: không ném ra ngoài, thread sau vẫn tới lượt", () => {
    let lan = 0;
    const hang = new HangChoTraLoiTre({
      accountId: "acc",
      enqueue: () => {
        lan++;
        if (lan === 1) throw new Error("hỏng");
      },
      gianCachMs: () => [0, 0],
      luuAnhTinBoQua: () => {},
      random: () => 0,
    });
    hang.them(key("a"), tin("a", "2026-03-10T07:00:00.000Z"));
    hang.them(key("b"), tin("b", "2026-03-10T08:00:00.000Z"));
    assert.doesNotThrow(() => hang.nha());
    assert.doesNotThrow(() => mock.timers.tick(0));
    assert.equal(lan, 2);
  });
});
