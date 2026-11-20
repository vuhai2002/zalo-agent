import {
  docMocLayBu,
  luuMocLayBu,
  xoaMocLayBu,
  type HangChoLayBu,
} from "../../conversation/offline-replay-cursor-store.js";
import { createLogger } from "../../shared/logger.js";
import { LENH_LAY_BU } from "./doc-trang-lay-bu.js";
import {
  CHAY_TIEP_SAU_TRAN_MS,
  HANG_CHO,
  HET_GIO_TRANG_MS,
  TRAN_TRANG,
  type BoXinBu,
  type Luot,
  type PhuThuocXinBu,
} from "./xin-bu-tin-lo-kieu.js";

export type { BoXinBu, KetQuaHangCho } from "./xin-bu-tin-lo-kieu.js";
export { TRAN_TRANG } from "./xin-bu-tin-lo-kieu.js";

/**
 * Xin Zalo gửi lại tin lỡ từ hai hàng chờ: 510 (1-1), 511 (nhóm). Như Zalo Web,
 * port từ `zalo-archive-mcp/src/zalo/offline-message-replay.ts` (đã chạy thật):
 * xin TỪ mốc (`first: true`), còn `more` thì xin tiếp bằng `lastActionId`; mỗi
 * trang giao tin TRƯỚC rồi mới lưu mốc (chết giữa chừng thì xin lại, khử trùng lo);
 * tin trực tiếp chỉ đẩy mốc khi hàng chờ đã bắt kịp - đẩy sớm là nhảy qua tin lỡ.
 */
export function taoBoXinBu(deps: PhuThuocXinBu): BoXinBu {
  const log = createLogger(`lay-bu:${deps.accountId}`);
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const luot: Partial<Record<HangChoLayBu, Luot>> = {};
  const choBatDau = new Set<HangChoLayBu>();
  const daBatKip = new Set<HangChoLayBu>();
  let lanXinCuoi = Number.NEGATIVE_INFINITY;
  let daDung = false;

  const sau = (ms: number, fn: () => void): ReturnType<typeof setTimeout> => {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!daDung) fn();
    }, ms);
    timers.add(t);
    return t;
  };

  const luuMoc = (hangCho: HangChoLayBu, id: string): void => {
    try {
      luuMocLayBu(deps.accountId, hangCho, id);
    } catch (err) {
      log.warn({ err, hangCho }, "Không lưu được mốc lấy bù");
    }
  };

  const ketThuc = (hangCho: HangChoLayBu, l: Luot, trangThai: "du" | "do", lyDo: string | null): void => {
    if (luot[hangCho] !== l) return;
    delete luot[hangCho];
    if (l.cho) {
      clearTimeout(l.cho);
      timers.delete(l.cho);
    }
    // Lượt dở: lần kết nối sau xin lại ngay, không chờ khoảng tối thiểu
    if (trangThai === "do") lanXinCuoi = Number.NEGATIVE_INFINITY;
    deps.onHangChoXong({ hangCho, trangThai, lyDo, soTrang: l.soTrang, soTin: l.soTin });
    if (HANG_CHO.every((h) => !luot[h]) && choBatDau.size === 0) deps.onLuotXong();
  };

  const xin = (hangCho: HangChoLayBu, l: Luot, lastId: string | null, first: boolean): void => {
    if (luot[hangCho] !== l) return;
    try {
      deps.guiLenh(LENH_LAY_BU[hangCho].cmd, { first, lastId, preIds: [] });
    } catch (err) {
      log.warn({ err, hangCho }, "Gửi lệnh xin bù thất bại");
      ketThuc(hangCho, l, "do", "Gửi lệnh xin bù tới Zalo thất bại");
      return;
    }
    l.daXin = lastId;
    l.cho = sau(HET_GIO_TRANG_MS, () => {
      l.cho = null;
      if (l.tuMoc && l.soTrang === 0 && l.daXin) {
        // Zalo không trả lời khi xin từ mốc: bỏ mốc, lần sau xin từ đầu hàng chờ
        try {
          xoaMocLayBu(deps.accountId, hangCho, l.daXin);
        } catch (err) {
          log.warn({ err, hangCho }, "Không bỏ được mốc lấy bù");
        }
        log.warn({ hangCho }, "Zalo không trả lời khi xin bù từ mốc đã lưu - bỏ mốc, lần sau xin từ đầu");
      }
      ketThuc(hangCho, l, "do", `Zalo không trả trang ${l.soTrang + 1} trong ${HET_GIO_TRANG_MS / 1000} giây`);
    });
  };

  const batDau = (hangCho: HangChoLayBu): void => {
    choBatDau.delete(hangCho);
    let mocHienTai: string | null = null;
    try {
      mocHienTai = docMocLayBu(deps.accountId)[hangCho] ?? null;
    } catch (err) {
      log.warn({ err, hangCho }, "Không đọc được mốc lấy bù - xin từ đầu hàng chờ");
    }
    const l: Luot = { soTrang: 0, soTin: 0, daXin: null, tuMoc: mocHienTai !== null, evict: false, cho: null };
    luot[hangCho] = l;
    xin(hangCho, l, mocHienTai, true);
  };

  const huyHet = (): void => {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    choBatDau.clear();
  };

  return {
    khiKetNoi() {
      if (daDung) return;
      daBatKip.clear();
      if (now() - lanXinCuoi < deps.khoangToiThieuMs()) {
        log.debug("Vừa lấy bù gần đây - lần kết nối này bỏ qua");
        return;
      }
      lanXinCuoi = now();
      choBatDau.add("tin_nhom");
      batDau("tin_1_1");
      sau(2_000 + Math.floor(random() * 3_000), () => batDau("tin_nhom"));
    },

    khiDongKetNoi() {
      if (daDung) return;
      huyHet();
      daBatKip.clear();
      for (const h of HANG_CHO) {
        const l = luot[h];
        if (l) ketThuc(h, l, "do", "Mất kết nối giữa chừng - lần nối sau xin tiếp");
      }
    },

    khiTrang(hangCho, trang) {
      if (daDung) return;
      for (const t of trang.tin) {
        try {
          deps.onTin(hangCho, t);
        } catch (err) {
          log.warn({ err, hangCho }, "Xử lý một tin lấy bù hỏng - bỏ qua tin đó");
        }
      }
      const l = luot[hangCho];
      if (!l) return; // trang về trễ: tin đã giao, không lật tiếp
      if (l.cho) {
        clearTimeout(l.cho);
        timers.delete(l.cho);
        l.cho = null;
      }
      l.soTrang++;
      l.soTin += trang.tin.length;
      if (trang.evict && !l.evict) {
        l.evict = true;
        log.warn({ hangCho }, "Zalo báo hàng chờ đã đầy và bỏ bớt phần cũ - một ít tin lỡ có thể đã mất");
      }
      if (trang.lastActionId) luuMoc(hangCho, trang.lastActionId);

      if (!trang.more) {
        daBatKip.add(hangCho);
        ketThuc(hangCho, l, l.evict ? "do" : "du", l.evict ? "Zalo báo hàng chờ đã đầy và bỏ bớt phần cũ" : null);
        return;
      }
      const ke = trang.lastActionId;
      if (!ke || ke === l.daXin) {
        ketThuc(hangCho, l, "do", "Zalo báo còn trang nhưng thiếu mã trang");
        return;
      }
      if (l.soTrang >= TRAN_TRANG) {
        ketThuc(hangCho, l, "do", `Chạm trần ${TRAN_TRANG} trang - chạy tiếp sau ${CHAY_TIEP_SAU_TRAN_MS / 1000} giây`);
        // Chạy tiếp TRONG cùng kết nối: lần đầu chưa có mốc thì phần tin lỡ thật
        // nằm ở cuối ~2 tuần, mà kết nối ổn định có thể sống nhiều ngày
        sau(CHAY_TIEP_SAU_TRAN_MS, () => {
          if (!luot[hangCho]) batDau(hangCho);
        });
        return;
      }
      sau(2_000 + Math.floor(random() * 2_000), () => xin(hangCho, l, ke, false));
    },

    khiTrangHong(hangCho, lyDo) {
      if (daDung) return;
      const l = luot[hangCho];
      if (l) ketThuc(hangCho, l, "do", lyDo);
    },

    khiTinTrucTiep(hangCho, msgId) {
      if (daDung || !daBatKip.has(hangCho)) return;
      luuMoc(hangCho, msgId);
    },

    dung() {
      daDung = true;
      huyHet();
      for (const h of HANG_CHO) delete luot[h];
    },
  };
}
