import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";
import type { TrangLayBu } from "./doc-trang-lay-bu.js";

/**
 * Bộ xin bù tin lỡ: mỗi lần kết nối xin Zalo hàng chờ tin 1-1 (510) rồi tin nhóm
 * (511) từ mốc đã lưu, lật trang theo `more` / `lastActionId`. Khuôn ca kiểm theo
 * `zalo-archive-mcp/src/zalo/offline-message-replay.test.ts` (đã chạy thật).
 */
let dataDir: string;
let mod: typeof import("./xin-bu-tin-lo.js");
let moc: typeof import("../../conversation/offline-replay-cursor-store.js");
let database: typeof import("../../conversation/database.js");

const ACC = "acc-xin-bu";

before(async () => {
  dataDir = setupTestEnv();
  mod = await import("./xin-bu-tin-lo.js");
  moc = await import("../../conversation/offline-replay-cursor-store.js");
  database = await import("../../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(() => {
  database.db.exec("DELETE FROM offline_replay_cursors");
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
});

afterEach(() => {
  mock.timers.reset();
});

type Lenh = { cmd: number; first: boolean; lastId: string | null };

function dung(opts: { khoangToiThieuMs?: number; guiLenhNem?: boolean; callbackNem?: boolean; dangBat?: () => boolean } = {}) {
  const lenh: Lenh[] = [];
  const tin: [string, Record<string, unknown>][] = [];
  const xong: import("./xin-bu-tin-lo.js").KetQuaHangCho[] = [];
  let luotXong = 0;
  const bo = mod.taoBoXinBu({
    accountId: ACC,
    guiLenh: (cmd, data) => {
      if (opts.guiLenhNem) throw new Error("ws đóng");
      lenh.push({ cmd, first: data.first, lastId: data.lastId });
    },
    onTin: (h, t) => tin.push([h, t]),
    onHangChoXong: (kq) => {
      xong.push(kq);
      if (opts.callbackNem) throw new Error("callback hỏng");
    },
    onLuotXong: () => {
      luotXong++;
      if (opts.callbackNem) throw new Error("callback hỏng");
    },
    khoangToiThieuMs: () => opts.khoangToiThieuMs ?? 600_000,
    random: () => 0,
    dangBat: opts.dangBat,
  });
  return { bo, lenh, tin, xong, luotXong: () => luotXong };
}

const trang = (lastActionId: string | null, more: boolean, soTin = 1, evict = false): TrangLayBu => ({
  tin: Array.from({ length: soTin }, (_, i) => ({ msgId: `${lastActionId}-${i}` })),
  more,
  lastActionId,
  evict,
});

describe("bắt đầu lượt", () => {
  it("kết nối: xin 510 ngay từ đầu hàng chờ, 511 sau 2 giây (không sớm hơn)", () => {
    const { bo, lenh } = dung();
    bo.khiKetNoi();
    assert.deepEqual(lenh, [{ cmd: 510, first: true, lastId: null }]);
    mock.timers.tick(1_999);
    assert.equal(lenh.length, 1);
    mock.timers.tick(1);
    assert.deepEqual(lenh[1], { cmd: 511, first: true, lastId: null });
  });

  it("có mốc đã lưu thì xin TỪ mốc", () => {
    moc.luuMocLayBu(ACC, "tin_1_1", "100");
    const { bo, lenh } = dung();
    bo.khiKetNoi();
    assert.deepEqual(lenh[0], { cmd: 510, first: true, lastId: "100" });
  });
});

describe("lật trang", () => {
  it("còn trang: giao tin, lưu mốc mỗi trang, xin tiếp bằng lastActionId sau 2 giây", () => {
    const { bo, lenh, tin } = dung();
    bo.khiKetNoi();
    bo.khiTrang("tin_1_1", trang("200", true, 2));
    assert.equal(tin.length, 2);
    assert.equal(moc.docMocLayBu(ACC).tin_1_1, "200");
    mock.timers.tick(1_999);
    assert.equal(lenh.filter((l) => l.cmd === 510).length, 1);
    mock.timers.tick(1);
    assert.deepEqual(lenh.filter((l) => l.cmd === 510)[1], { cmd: 510, first: false, lastId: "200" });
  });

  it("hết trang cả hai hàng chờ: mỗi hàng chờ 'du', onLuotXong đúng một lần", () => {
    const { bo, xong, luotXong } = dung();
    bo.khiKetNoi();
    bo.khiTrang("tin_1_1", trang("300", false, 3));
    assert.equal(luotXong(), 0, "511 chưa bắt đầu mà đã báo xong lượt");
    mock.timers.tick(2_000);
    bo.khiTrang("tin_nhom", trang("400", false, 0));
    assert.deepEqual(
      xong.map((k) => [k.hangCho, k.trangThai, k.soTrang, k.soTin]),
      [
        ["tin_1_1", "du", 1, 3],
        ["tin_nhom", "du", 1, 0],
      ],
    );
    assert.equal(luotXong(), 1);
  });

  it("chạm trần 30 trang: dừng dở, 60 giây sau chạy tiếp TỪ mốc trong cùng kết nối, tới khi hết", () => {
    const { bo, lenh, xong, luotXong } = dung();
    bo.khiKetNoi();
    mock.timers.tick(2_000);
    bo.khiTrang("tin_nhom", trang("1", false, 0));
    for (let i = 1; i <= 30; i++) {
      bo.khiTrang("tin_1_1", trang(String(1000 + i), true));
      mock.timers.tick(2_000);
    }
    assert.equal(xong.find((k) => k.hangCho === "tin_1_1")?.trangThai, "do");
    assert.equal(lenh.filter((l) => l.cmd === 510).length, 30, "trang 31 không được xin ngay");
    // Còn lượt chạy tiếp thì CHƯA nhả: tin chủ trả lời tay có thể nằm ở trang sau,
    // nhả sớm là trả lời chồng, và trang sau lại thêm tin cho thread đã nhả -> xin lỗi hai lần
    assert.equal(luotXong(), 0, "nhả hàng chờ khi còn lượt chạy tiếp");
    mock.timers.tick(60_000);
    assert.deepEqual(lenh.filter((l) => l.cmd === 510).at(-1), { cmd: 510, first: true, lastId: "1030" });
    for (let i = 31; i <= 35; i++) {
      bo.khiTrang("tin_1_1", trang(String(1000 + i), i < 35));
      mock.timers.tick(2_000);
    }
    assert.equal(xong.at(-1)?.trangThai, "du");
    assert.equal(luotXong(), 1);
  });

  it("lượt CHẠY TIẾP sau trần mà Zalo im: dở nhưng GIỮ mốc (mốc do chính Zalo vừa trả)", () => {
    const { bo } = dung();
    bo.khiKetNoi();
    mock.timers.tick(2_000);
    bo.khiTrang("tin_nhom", trang("1", false, 0));
    for (let i = 1; i <= 30; i++) {
      bo.khiTrang("tin_1_1", trang(String(1000 + i), true));
      mock.timers.tick(2_000);
    }
    mock.timers.tick(60_000); // chạy tiếp: xin từ 1030
    mock.timers.tick(8_000); // Zalo im
    assert.equal(moc.docMocLayBu(ACC).tin_1_1, "1030", "lượt chạy tiếp đã bỏ mất mốc tốt");
  });

  it("công tắc tắt: lượt hoãn và lượt chạy tiếp cũng không xin", () => {
    let bat = true;
    const { bo, lenh } = dung({ khoangToiThieuMs: 600_000, dangBat: () => bat });
    bo.khiKetNoi();
    bo.khiTrang("tin_1_1", trang("10", false));
    mock.timers.tick(2_000);
    bo.khiTrang("tin_nhom", trang("20", false));
    bo.khiDongKetNoi();
    bo.khiKetNoi(); // hoãn
    bat = false;
    const truoc = lenh.length;
    mock.timers.tick(600_000);
    assert.equal(lenh.length, truoc, "tắt rồi mà lượt hoãn vẫn xin");
  });

  it("còn trang mà thiếu mã trang, hay trùng mã vừa xin: dừng dở, không xin lặp", () => {
    const { bo, lenh, xong } = dung();
    bo.khiKetNoi();
    bo.khiTrang("tin_1_1", trang(null, true));
    mock.timers.tick(10_000);
    assert.equal(lenh.filter((l) => l.cmd === 510).length, 1);
    assert.equal(xong[0]?.trangThai, "do");

    moc.luuMocLayBu(ACC, "tin_1_1", "50");
    const b2 = dung({ khoangToiThieuMs: 0 });
    b2.bo.khiKetNoi();
    b2.bo.khiTrang("tin_1_1", trang("50", true));
    mock.timers.tick(10_000);
    assert.equal(b2.lenh.filter((l) => l.cmd === 510).length, 1);
    assert.equal(b2.xong[0]?.trangThai, "do");
  });

  it("Zalo báo hàng chờ đã đầy (evict): lượt đó dở", () => {
    const { bo, xong } = dung();
    bo.khiKetNoi();
    bo.khiTrang("tin_1_1", trang("10", false, 1, true));
    assert.equal(xong[0]?.trangThai, "do");
  });
});

describe("trang không về / hỏng", () => {
  it("trang ĐẦU xin TỪ mốc không về trong 8 giây: dở và bỏ mốc", () => {
    moc.luuMocLayBu(ACC, "tin_1_1", "100");
    const { bo, xong } = dung();
    bo.khiKetNoi();
    mock.timers.tick(8_000);
    assert.equal(xong[0]?.trangThai, "do");
    assert.equal(moc.docMocLayBu(ACC).tin_1_1, undefined);
  });

  it("trang SAU không về: dở nhưng GIỮ mốc", () => {
    const { bo, xong } = dung();
    bo.khiKetNoi();
    bo.khiTrang("tin_1_1", trang("200", true));
    // Hai nhịp: timer hết giờ của trang sau chỉ được hẹn lúc trang sau được xin (giây 2)
    mock.timers.tick(2_000);
    mock.timers.tick(8_000);
    assert.equal(xong.find((k) => k.hangCho === "tin_1_1")?.trangThai, "do");
    assert.equal(moc.docMocLayBu(ACC).tin_1_1, "200");
  });

  it("trang về mà không đọc được (khiTrangHong): dở, GIỮ mốc, không chờ hết giờ", () => {
    moc.luuMocLayBu(ACC, "tin_1_1", "100");
    const { bo, xong } = dung();
    bo.khiKetNoi();
    bo.khiTrangHong("tin_1_1", "không giải mã được");
    assert.equal(xong[0]?.trangThai, "do");
    assert.equal(moc.docMocLayBu(ACC).tin_1_1, "100");
    mock.timers.tick(8_000);
    assert.equal(xong.filter((k) => k.hangCho === "tin_1_1").length, 1, "hết giờ không được kết thúc lần hai");
  });

  it("gửi lệnh ném: hàng chờ đó dở, không ném ra ngoài", () => {
    const { bo, xong } = dung({ guiLenhNem: true });
    assert.doesNotThrow(() => bo.khiKetNoi());
    assert.equal(xong[0]?.trangThai, "do");
  });

  it("trang về TRỄ (lượt đã kết thúc): vẫn giao tin, không xin thêm, không đụng mốc", () => {
    const { bo, lenh, tin } = dung();
    bo.khiKetNoi();
    mock.timers.tick(8_000);
    bo.khiTrang("tin_1_1", trang("900", true, 2));
    mock.timers.tick(10_000);
    assert.equal(tin.length, 2);
    assert.equal(lenh.filter((l) => l.cmd === 510).length, 1);
    assert.equal(moc.docMocLayBu(ACC).tin_1_1, undefined);
  });

  it("trang LẠC tới lúc không có yêu cầu nào đang chờ: giao tin, không lật thêm, không tính trang", () => {
    const { bo, lenh, tin } = dung();
    bo.khiKetNoi();
    bo.khiTrang("tin_1_1", trang("10", true));
    bo.khiTrang("tin_1_1", trang("11", true));
    mock.timers.tick(2_000);
    assert.deepEqual(
      lenh.filter((l) => l.cmd === 510).map((l) => l.lastId),
      [null, "10"],
    );
    assert.equal(tin.length, 2);
    assert.equal(moc.docMocLayBu(ACC).tin_1_1, "10");
  });

  it("callback ném (kể cả trong timer, kể cả lúc đóng): không ném ra ngoài, hàng chờ còn lại vẫn kết thúc", () => {
    const { bo, xong } = dung({ callbackNem: true });
    assert.doesNotThrow(() => bo.khiKetNoi());
    // 511 bắt đầu TRONG nhịp tick đầu nên hết giờ của nó tính từ cuối nhịp đó
    assert.doesNotThrow(() => mock.timers.tick(8_000));
    assert.doesNotThrow(() => mock.timers.tick(8_000));
    assert.equal(xong.length, 2);
    const b2 = dung({ callbackNem: true });
    b2.bo.khiKetNoi();
    mock.timers.tick(2_000);
    assert.doesNotThrow(() => b2.bo.khiDongKetNoi());
    assert.equal(b2.xong.length, 2, "hàng chờ thứ hai không được kết thúc vì callback của cái đầu ném");
  });

  it("chạm trần mà mốc KHÔNG tiến (mã trang không phải dãy số): không chạy tiếp, không lặp", () => {
    const { bo, lenh, xong, luotXong } = dung();
    bo.khiKetNoi();
    mock.timers.tick(2_000);
    bo.khiTrang("tin_nhom", trang("1", false, 0));
    for (let i = 1; i <= 30; i++) {
      bo.khiTrang("tin_1_1", trang(`ma-${i}`, true));
      mock.timers.tick(2_000);
    }
    mock.timers.tick(60_000);
    mock.timers.tick(60_000);
    assert.equal(lenh.filter((l) => l.cmd === 510).length, 30);
    assert.equal(xong.find((k) => k.hangCho === "tin_1_1")?.trangThai, "do");
    assert.equal(luotXong(), 1, "không chạy tiếp thì phải nhả ngay");
  });
});

describe("kết nối đóng / nối lại", () => {
  it("đóng giữa chừng: không xin thêm, giữ mốc; nối lại liền là xin lại ngay dù chưa qua khoảng tối thiểu", () => {
    const { bo, lenh } = dung();
    bo.khiKetNoi();
    bo.khiTrang("tin_1_1", trang("200", true));
    bo.khiDongKetNoi();
    mock.timers.tick(20_000);
    assert.equal(lenh.length, 1);
    assert.equal(moc.docMocLayBu(ACC).tin_1_1, "200");
    bo.khiKetNoi();
    assert.deepEqual(lenh.at(-1), { cmd: 510, first: true, lastId: "200" });
  });

  it("lượt trước xong đủ: nối lại trong khoảng tối thiểu thì HOÃN tới hết khoảng, không bỏ hẳn", () => {
    const { bo, lenh } = dung({ khoangToiThieuMs: 600_000 });
    bo.khiKetNoi();
    bo.khiTrang("tin_1_1", trang("10", false));
    mock.timers.tick(2_000);
    bo.khiTrang("tin_nhom", trang("20", false));
    bo.khiDongKetNoi();
    mock.timers.tick(1_000);
    const truoc = lenh.length;
    bo.khiKetNoi();
    assert.equal(lenh.length, truoc, "chưa hết khoảng tối thiểu mà đã xin");
    mock.timers.tick(596_999);
    assert.equal(lenh.length, truoc);
    mock.timers.tick(1);
    assert.deepEqual(lenh.at(-1), { cmd: 510, first: true, lastId: "10" });
  });

  it("mạng chập chờn: lượt đang HOÃN mà đóng rồi nối lại vẫn hoãn, không xin ngay", () => {
    const { bo, lenh, luotXong } = dung({ khoangToiThieuMs: 600_000 });
    bo.khiKetNoi();
    bo.khiTrang("tin_1_1", trang("10", false));
    mock.timers.tick(2_000);
    bo.khiTrang("tin_nhom", trang("20", false));
    bo.khiDongKetNoi();
    const truoc = lenh.length;
    const xongTruoc = luotXong();
    bo.khiKetNoi(); // hoãn
    bo.khiDongKetNoi();
    bo.khiKetNoi(); // vẫn phải hoãn
    assert.equal(lenh.length, truoc, "chập chờn mà vẫn xin bù ngay");
    assert.equal(luotXong(), xongTruoc, "đóng lúc chỉ đang hoãn không phải xong một lượt");
    mock.timers.tick(600_000);
    assert.equal(lenh.length, truoc + 1);
  });

  it("đóng đúng lúc 511 còn chờ bắt đầu: vẫn báo xong lượt đúng một lần, nối lại là xin ngay", () => {
    const { bo, lenh, luotXong } = dung({ khoangToiThieuMs: 600_000 });
    bo.khiKetNoi();
    bo.khiTrang("tin_1_1", trang("10", false, 2));
    assert.equal(luotXong(), 0);
    bo.khiDongKetNoi();
    assert.equal(luotXong(), 1, "tin 1-1 vừa lấy về phải được nhả để trả lời");
    const truoc = lenh.length;
    bo.khiKetNoi();
    assert.deepEqual(lenh.slice(truoc), [{ cmd: 510, first: true, lastId: "10" }]);
  });

  it("đóng giữa lượt rồi nối lại: các timer chạy tiếp/hết giờ cũ không còn tác dụng", () => {
    const { bo, lenh } = dung();
    bo.khiKetNoi();
    mock.timers.tick(2_000);
    bo.khiTrang("tin_nhom", trang("1", false, 0));
    for (let i = 1; i <= 30; i++) {
      bo.khiTrang("tin_1_1", trang(String(1000 + i), true));
      mock.timers.tick(2_000);
    }
    bo.khiDongKetNoi();
    mock.timers.tick(120_000);
    assert.equal(lenh.filter((l) => l.cmd === 510).length, 30, "chạy tiếp sau trần vẫn bắn sau khi đã đóng");
  });

  it("kết nối mới tới khi lượt cũ còn chạy (không có 'đóng' xen giữa): dọn lượt cũ, không gửi 511 hai lần, không bỏ mốc oan", () => {
    moc.luuMocLayBu(ACC, "tin_1_1", "100");
    const { bo, lenh } = dung({ khoangToiThieuMs: 0 });
    bo.khiKetNoi();
    bo.khiKetNoi();
    bo.khiTrang("tin_1_1", trang("150", false));
    mock.timers.tick(5_000);
    mock.timers.tick(8_000);
    assert.equal(lenh.filter((l) => l.cmd === 511).length, 1, "511 của lượt cũ vẫn bắn");
    assert.equal(moc.docMocLayBu(ACC).tin_1_1, "150", "timer hết giờ của lượt cũ đã bỏ mất mốc");
  });
});

describe("tin trực tiếp đẩy mốc", () => {
  it("bắt kịp ở kết nối trước không tính cho kết nối sau", () => {
    const { bo } = dung({ khoangToiThieuMs: 600_000 });
    bo.khiKetNoi();
    bo.khiTrang("tin_1_1", trang("300", false));
    bo.khiDongKetNoi();
    bo.khiKetNoi();
    bo.khiTinTrucTiep("tin_1_1", "500");
    assert.equal(moc.docMocLayBu(ACC).tin_1_1, "300");
  });

  it("chỉ sau khi hàng chờ đó đã lấy bù xong trong kết nối này, và chỉ tiến", () => {
    const { bo } = dung();
    bo.khiKetNoi();
    bo.khiTinTrucTiep("tin_1_1", "500");
    assert.equal(moc.docMocLayBu(ACC).tin_1_1, undefined, "đẩy mốc trước khi bắt kịp là nhảy qua đoạn tin lỡ");
    bo.khiTrang("tin_1_1", trang("300", false));
    bo.khiTinTrucTiep("tin_1_1", "500");
    assert.equal(moc.docMocLayBu(ACC).tin_1_1, "500");
    bo.khiTinTrucTiep("tin_1_1", "400");
    assert.equal(moc.docMocLayBu(ACC).tin_1_1, "500");
    bo.khiTinTrucTiep("tin_nhom", "700");
    assert.equal(moc.docMocLayBu(ACC).tin_nhom, undefined, "hàng chờ nhóm chưa bắt kịp");
  });
});

describe("dừng", () => {
  it("dung(): không xin thêm, không gọi callback nào nữa", () => {
    const { bo, lenh, tin, xong } = dung();
    bo.khiKetNoi();
    bo.dung();
    mock.timers.tick(20_000);
    bo.khiTrang("tin_1_1", trang("1", false));
    assert.equal(lenh.length, 1);
    assert.equal(tin.length, 0);
    assert.equal(xong.length, 0);
  });
});
