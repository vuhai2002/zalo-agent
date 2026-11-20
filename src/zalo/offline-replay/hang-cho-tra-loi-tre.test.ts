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

function dung(gian: [number, number] = [20_000, 60_000], opts: { random?: number; tran?: number; tuChoi?: boolean } = {}) {
  const enq: [string, string][] = [];
  const boQua: ParsedMessage[][] = [];
  const hang = new HangChoTraLoiTre({
    accountId: "acc",
    enqueue: (tk, m) => {
      enq.push([tk, m.msgId]);
      return !opts.tuChoi;
    },
    gianCachMs: () => gian,
    luuAnhTinBoQua: (msgs) => boQua.push(msgs),
    random: () => opts.random ?? 0,
    tranTinMoiNguoi: opts.tran ?? 32,
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

  it("nhịp không vượt tối đa (random sát 1)", () => {
    const { hang, enq } = dung([20_000, 60_000], { random: 0.9999 });
    hang.them(key("a"), tin("a", "2026-03-10T07:00:00.000Z"));
    hang.them(key("b"), tin("b", "2026-03-10T08:00:00.000Z"));
    hang.nha();
    mock.timers.tick(59_000);
    assert.equal(enq.length, 1, "nhịp đang lấy sát tối thiểu thay vì ngẫu nhiên trong khoảng");
    mock.timers.tick(1_000);
    assert.equal(enq.length, 2);
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

describe("trần tin mỗi người gửi của bộ gộp", () => {
  it("một người quá trần: chỉ đẩy N tin MỚI NHẤT, phần cũ hơn đi đường lưu ảnh", () => {
    const { hang, enq, boQua } = dung([20_000, 60_000], { tran: 2 });
    for (const gio of ["07:00", "07:10", "07:20", "07:30"]) {
      hang.them(key("a"), tin("a", `2026-03-10T${gio}:00.000Z`));
    }
    hang.nha();
    assert.deepEqual(
      enq.map(([, id]) => id),
      ["a-2026-03-10T07:20:00.000Z", "a-2026-03-10T07:30:00.000Z"],
    );
    assert.deepEqual(
      boQua.flat().map((m) => m.sentAt),
      ["2026-03-10T07:00:00.000Z", "2026-03-10T07:10:00.000Z"],
    );
  });

  it("trần tính theo NGƯỜI GỬI (bộ gộp gom theo người), không theo cả nhóm", () => {
    const { hang, enq } = dung([20_000, 60_000], { tran: 1 });
    hang.them(key("g"), tin("g", "2026-03-10T07:00:00.000Z", { senderId: "u-lan" }));
    hang.them(key("g"), tin("g", "2026-03-10T07:01:00.000Z", { senderId: "u-minh", msgId: "g-minh" }));
    hang.nha();
    assert.equal(enq.length, 2);
  });

  it("bộ gộp từ chối tin (trả false): tin đó đi đường lưu ảnh", () => {
    const { hang, boQua } = dung([20_000, 60_000], { tuChoi: true });
    hang.them(key("a"), tin("a", "2026-03-10T07:00:00.000Z"));
    hang.nha();
    assert.equal(boQua.flat().length, 1);
  });
});

describe("đã có người trả lời", () => {
  it("tin của tài khoản SAU tin chờ cuối: bỏ lượt thread đó, lưu ảnh, không tốn nhịp", () => {
    const { hang, enq, boQua } = dung();
    hang.them(key("a"), tin("a", "2026-03-10T07:00:00.000Z"));
    hang.ghiNhanTinSelf(key("a"), Date.parse("2026-03-10T07:05:00.000Z"));
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
    hang.ghiNhanTinSelf(key("a"), Date.parse("2026-03-10T06:00:00.000Z"));
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

  it("đã nhaNgay một thread: tin lấy bù tới SAU trong cùng lượt không xếp lại (không trả lời trễ hai lần)", () => {
    const { hang, enq } = dung();
    hang.them(key("a"), tin("a", "2026-03-10T07:00:00.000Z"));
    hang.nhaNgay(key("a"));
    hang.them(key("a"), tin("a", "2026-03-10T07:05:00.000Z"));
    hang.nha();
    mock.timers.tick(120_000);
    assert.equal(enq.length, 1);
    // Lượt lấy bù SAU bắt đầu thì thread đó lại được xếp như thường
    hang.batDauLuotMoi();
    hang.them(key("a"), tin("a", "2026-03-10T09:00:00.000Z"));
    hang.nha();
    assert.equal(enq.length, 2);
  });

  it("nhaNgay ở lượt trước KHÔNG chặn tin lỡ của lần mất mạng sau", () => {
    const { hang, enq } = dung();
    hang.them(key("x"), tin("x", "2026-03-10T07:00:00.000Z"));
    hang.them(key("p"), tin("p", "2026-03-10T07:10:00.000Z"));
    hang.nha();
    hang.nhaNgay(key("p"));
    mock.timers.tick(120_000);
    // Vài giờ sau: mất mạng lần 2, lượt mới bắt đầu, P lại có tin lỡ
    hang.batDauLuotMoi();
    hang.them(key("p"), tin("p", "2026-03-10T12:00:00.000Z"));
    hang.nha();
    assert.deepEqual(
      enq.map(([, id]) => id),
      ["x-2026-03-10T07:00:00.000Z", "p-2026-03-10T07:10:00.000Z", "p-2026-03-10T12:00:00.000Z"],
    );
  });

  it("nhaNgay: đẩy theo thứ tự giờ gửi; chủ đã trả lời SAU tin chờ thì không đẩy tin cũ", () => {
    const { hang, enq, boQua } = dung();
    hang.them(key("a"), tin("a", "2026-03-10T07:30:00.000Z"));
    hang.them(key("a"), tin("a", "2026-03-10T07:00:00.000Z"));
    hang.nhaNgay(key("a"));
    assert.deepEqual(
      enq.map(([, id]) => id),
      ["a-2026-03-10T07:00:00.000Z", "a-2026-03-10T07:30:00.000Z"],
    );
    hang.them(key("b"), tin("b", "2026-03-10T07:00:00.000Z"));
    hang.ghiNhanTinSelf(key("b"), Date.parse("2026-03-10T07:05:00.000Z"));
    assert.equal(hang.nhaNgay(key("b")), false);
    assert.equal(enq.length, 2);
    assert.equal(boQua.flat().some((m) => m.threadId === "b"), true);
  });

  it("nhaNgay chạy được cả khi hàng chờ chưa bắt đầu nhả", () => {
    const enq: ParsedMessage[] = [];
    const hang = new HangChoTraLoiTre({
      accountId: "acc",
      enqueue: (_tk, m) => {
        enq.push(m);
        return true;
      },
      gianCachMs: () => [20_000, 60_000],
      luuAnhTinBoQua: () => {},
    });
    hang.them(key("a"), tin("a", "2026-03-10T07:00:00.000Z"));
    assert.equal(hang.nhaNgay(key("a")), true);
    assert.equal(enq[0]?.layBu, true);
  });
});

describe("dừng", () => {
  it("nhaNgay sau khi dừng: không đẩy gì", () => {
    const { hang, enq } = dung();
    hang.them(key("a"), tin("a", "2026-03-10T07:00:00.000Z"));
    hang.dungVaBaoBoDo();
    assert.equal(hang.nhaNgay(key("a")), false);
    assert.equal(enq.length, 0);
  });

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
        return true;
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
