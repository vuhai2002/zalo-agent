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

function dung(opts: { khoangToiThieuMs?: number; guiLenhNem?: boolean } = {}) {
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
    onHangChoXong: (kq) => xong.push(kq),
    onLuotXong: () => luotXong++,
    khoangToiThieuMs: () => opts.khoangToiThieuMs ?? 600_000,
    random: () => 0,
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
    assert.equal(luotXong(), 1, "hết lượt (dở) vẫn phải nhả hàng chờ trả lời");
    mock.timers.tick(60_000);
    assert.deepEqual(lenh.filter((l) => l.cmd === 510).at(-1), { cmd: 510, first: true, lastId: "1030" });
    for (let i = 31; i <= 35; i++) {
      bo.khiTrang("tin_1_1", trang(String(1000 + i), i < 35));
      mock.timers.tick(2_000);
    }
    assert.equal(xong.at(-1)?.trangThai, "du");
    assert.equal(luotXong(), 2);
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

  it("trang về TRỄ (lượt đã kết thúc): vẫn giao tin, không xin thêm", () => {
    const { bo, lenh, tin } = dung();
    bo.khiKetNoi();
    mock.timers.tick(8_000);
    bo.khiTrang("tin_1_1", trang("900", true, 2));
    mock.timers.tick(10_000);
    assert.equal(tin.length, 2);
    assert.equal(lenh.filter((l) => l.cmd === 510).length, 1);
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

  it("lượt trước xong đủ: nối lại trong khoảng tối thiểu thì không xin, qua khoảng thì xin", () => {
    const { bo, lenh } = dung({ khoangToiThieuMs: 600_000 });
    bo.khiKetNoi();
    bo.khiTrang("tin_1_1", trang("10", false));
    mock.timers.tick(2_000);
    bo.khiTrang("tin_nhom", trang("20", false));
    const truoc = lenh.length;
    bo.khiKetNoi();
    assert.equal(lenh.length, truoc);
    mock.timers.tick(600_000);
    bo.khiKetNoi();
    assert.equal(lenh.length, truoc + 1);
  });
});

describe("tin trực tiếp đẩy mốc", () => {
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
