import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import type { API } from "zca-js";
import { giaiMaKhungWs } from "./giai-ma-khung-ws.js";
import { docTrangLayBu, LENH_LAY_BU } from "./doc-trang-lay-bu.js";
import { ganNgheKhungWsTho } from "./raw-ws-frame-listener.js";
import { dungKhungWs, KHOA_TEST } from "./khung-ws-test-helper.js";

/**
 * Phản hồi lấy bù (cmd 510/511) phải đọc từ KHUNG WS THÔ: zca-js 2.3.0 chỉ phát
 * mảng tin qua `old_messages` và vứt `more` / `lastActionId` - thiếu hai trường
 * đó thì không lật trang được, chỉ còn cách đoán "trang rỗng = hết".
 */
const TRANG = { msgs: [{ msgId: "1" }], more: 1, lastActionId: 8400000000001, queueStatus: { "510_1": { evict: 0 } } };

describe("giaiMaKhungWs", () => {
  it("encrypt 0 (JSON trơn)", () => {
    assert.deepEqual(giaiMaKhungWs(dungKhungWs(510, 1, TRANG, 0), null), TRANG);
  });

  it("encrypt 1 (base64 + nén)", () => {
    assert.deepEqual(giaiMaKhungWs(dungKhungWs(510, 1, TRANG, 1), null), TRANG);
  });

  it("encrypt 2 (AES-GCM + nén) với đúng khóa", () => {
    assert.deepEqual(giaiMaKhungWs(dungKhungWs(510, 1, TRANG, 2), KHOA_TEST), TRANG);
  });

  it("encrypt 3 (AES-GCM, không nén)", () => {
    assert.deepEqual(giaiMaKhungWs(dungKhungWs(510, 1, TRANG, 3), KHOA_TEST), TRANG);
  });

  it("khóa sai / thiếu khóa -> null, không ném", () => {
    const khung = dungKhungWs(510, 1, TRANG, 2);
    const khoaKhac = Buffer.alloc(32, 7).toString("base64");
    assert.equal(giaiMaKhungWs(khung, khoaKhac), null);
    assert.equal(giaiMaKhungWs(khung, null), null);
  });

  it("JSON hỏng sau đầu khung -> null, không ném", () => {
    const hong = Buffer.concat([dungKhungWs(510, 1, {}).subarray(0, 4), Buffer.from("{khong-phai-json", "utf8")]);
    assert.equal(giaiMaKhungWs(hong, null), null);
  });
});

describe("docTrangLayBu", () => {
  it("tin nhóm: đọc groupMsgs trong data, more 1, lastActionId số -> chuỗi, evict theo 511_1", () => {
    const trang = docTrangLayBu("tin_nhom", {
      data: { groupMsgs: [{ a: 1 }], more: 1, lastActionId: 123, queueStatus: { "511_1": { evict: 1 } } },
    });
    assert.deepEqual(trang, { tin: [{ a: 1 }], more: true, lastActionId: "123", evict: true });
  });

  it("tin 1-1 ở cấp trên cùng; thiếu more -> false; thiếu mảng tin -> []", () => {
    assert.deepEqual(docTrangLayBu("tin_1_1", { lastActionId: "9" }), {
      tin: [],
      more: false,
      lastActionId: "9",
      evict: false,
    });
  });

  it("evict của hàng chờ KHÁC không tính; lastActionId thiếu -> null", () => {
    const trang = docTrangLayBu("tin_1_1", { msgs: [], more: true, queueStatus: { "511_1": { evict: 1 } } });
    assert.equal(trang.evict, false);
    assert.equal(trang.lastActionId, null);
    assert.equal(trang.more, true);
  });

  it("LENH_LAY_BU: 510 tin 1-1, 511 tin nhóm, lệnh con 1", () => {
    assert.deepEqual(LENH_LAY_BU, { tin_1_1: { cmd: 510, subCmd: 1 }, tin_nhom: { cmd: 511, subCmd: 1 } });
  });
});

/** Listener giả: EventEmitter có `ws` (cũng là EventEmitter) đổi mỗi lần nối lại */
function listenerGia(): EventEmitter & { ws: EventEmitter | null; cipherKey: string | null } {
  const l = new EventEmitter() as EventEmitter & { ws: EventEmitter | null; cipherKey: string | null };
  l.ws = new EventEmitter();
  l.cipherKey = null;
  return l;
}

describe("ganNgheKhungWsTho", () => {
  it("chỉ gọi onFrame cho đúng lệnh + lệnh con, kèm cipherKey hiện tại", () => {
    const listener = listenerGia();
    listener.cipherKey = "k";
    const nhan: [number, string | null][] = [];
    ganNgheKhungWsTho({ listener } as unknown as API, { cmd: 510, subCmd: 1 }, (f, k) => nhan.push([f.readUInt16LE(1), k]), () => {});
    listener.ws!.emit("message", dungKhungWs(511, 1, {}));
    listener.ws!.emit("message", dungKhungWs(510, 0, {}));
    listener.ws!.emit("message", dungKhungWs(510, 1, {}));
    listener.ws!.emit("message", "chuoi-khong-phai-buffer");
    assert.deepEqual(nhan, [[510, "k"]]);
  });

  it("nối lại (ws mới + 'connected') thì gắn sang ws mới, bỏ ws cũ", () => {
    const listener = listenerGia();
    let dem = 0;
    ganNgheKhungWsTho({ listener } as unknown as API, { cmd: 510, subCmd: 1 }, () => dem++, () => {});
    const wsCu = listener.ws!;
    listener.ws = new EventEmitter();
    listener.emit("connected");
    wsCu.emit("message", dungKhungWs(510, 1, {}));
    listener.ws.emit("message", dungKhungWs(510, 1, {}));
    assert.equal(dem, 1);
  });

  it("hàm gỡ trả về thì không nhận gì nữa; onFrame ném thì vào onError, không ném ra ws", () => {
    const listener = listenerGia();
    const loi: unknown[] = [];
    const go = ganNgheKhungWsTho(
      { listener } as unknown as API,
      { cmd: 510, subCmd: 1 },
      () => {
        throw new Error("hong");
      },
      (e) => loi.push(e),
    );
    assert.doesNotThrow(() => listener.ws!.emit("message", dungKhungWs(510, 1, {})));
    assert.equal(loi.length, 1);
    go();
    listener.ws!.emit("message", dungKhungWs(510, 1, {}));
    assert.equal(loi.length, 1);
  });
});
