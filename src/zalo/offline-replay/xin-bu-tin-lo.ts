import {
  docMocLayBu,
  luuMocLayBu,
  xoaMocLayBu,
  type HangChoLayBu,
} from "../../conversation/offline-replay-cursor-store.js";
import { createLogger } from "../../shared/logger.js";
import { LENH_LAY_BU } from "./doc-trang-lay-bu.js";
import * as K from "./xin-bu-tin-lo-kieu.js";

export type { BoXinBu, KetQuaHangCho } from "./xin-bu-tin-lo-kieu.js";
export { TRAN_TRANG } from "./xin-bu-tin-lo-kieu.js";

/**
 * Xin Zalo gửi lại tin lỡ từ hai hàng chờ: 510 (1-1), 511 (nhóm). Như Zalo Web,
 * port từ `zalo-archive-mcp/src/zalo/offline-message-replay.ts` (đã chạy thật):
 * xin TỪ mốc (`first: true`), còn `more` thì xin tiếp bằng `lastActionId`; mỗi
 * trang giao tin TRƯỚC rồi mới lưu mốc (chết giữa chừng thì xin lại, khử trùng lo);
 * tin trực tiếp chỉ đẩy mốc khi hàng chờ đã bắt kịp - đẩy sớm là nhảy qua tin lỡ.
 * Mọi callback `deps.*` bọc lại: chạy trong timer / handler của ws, ném ra là
 * `uncaughtException` - thoát tiến trình, kéo theo mọi account.
 */
export function taoBoXinBu(deps: K.PhuThuocXinBu): K.BoXinBu {
  const log = createLogger(`lay-bu:${deps.accountId}`);
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const luot: Partial<Record<HangChoLayBu, K.Luot>> = {};
  const choBatDau = new Set<HangChoLayBu>();
  const daBatKip = new Set<HangChoLayBu>();
  let lanXinCuoi = Number.NEGATIVE_INFINITY;
  let daDung = false;

  const an = (viec: string, fn: () => void): void => {
    try {
      fn();
    } catch (err) {
      log.warn({ err }, `Lấy bù: ${viec} hỏng - bỏ qua`);
    }
  };
  const sau = (ms: number, fn: () => void): ReturnType<typeof setTimeout> => {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!daDung) an("hẹn giờ", fn);
    }, ms);
    timers.add(t);
    return t;
  };
  const dangCoLuot = (): boolean => K.HANG_CHO.some((h) => luot[h]);

  const ketThuc = (hangCho: HangChoLayBu, l: K.Luot, trangThai: "du" | "do", lyDo: string | null): void => {
    if (luot[hangCho] !== l) return;
    delete luot[hangCho];
    if (l.cho) {
      clearTimeout(l.cho);
      timers.delete(l.cho);
      l.cho = null;
    }
    // Lượt dở: lần kết nối sau xin lại ngay, không chờ khoảng tối thiểu
    if (trangThai === "do") lanXinCuoi = Number.NEGATIVE_INFINITY;
    an("báo hàng chờ xong", () => deps.onHangChoXong({ hangCho, trangThai, lyDo, soTrang: l.soTrang, soTin: l.soTin }));
    if (!dangCoLuot() && choBatDau.size === 0) an("báo xong lượt", deps.onLuotXong);
  };

  const xin = (hangCho: HangChoLayBu, l: K.Luot, lastId: string | null, first: boolean): void => {
    if (luot[hangCho] !== l) return;
    try {
      deps.guiLenh(LENH_LAY_BU[hangCho].cmd, { first, lastId, preIds: [] });
    } catch (err) {
      log.warn({ err, hangCho }, "Gửi lệnh xin bù thất bại");
      ketThuc(hangCho, l, "do", "Gửi lệnh xin bù tới Zalo thất bại");
      return;
    }
    l.daXin = lastId;
    l.cho = sau(K.HET_GIO_TRANG_MS, () => {
      if (luot[hangCho] !== l) return; // timer của lượt đã thay - không được đụng mốc
      l.cho = null;
      if (l.tuMoc && l.soTrang === 0 && l.daXin) {
        // Zalo không trả lời khi xin từ mốc: bỏ mốc, lần sau xin từ đầu hàng chờ
        const mocDaXin = l.daXin;
        an("bỏ mốc", () => xoaMocLayBu(deps.accountId, hangCho, mocDaXin));
        log.warn({ hangCho }, "Zalo không trả lời khi xin bù từ mốc đã lưu - bỏ mốc, lần sau xin từ đầu");
      }
      ketThuc(hangCho, l, "do", `Zalo không trả trang ${l.soTrang + 1} trong ${K.HET_GIO_TRANG_MS / 1000} giây`);
    });
  };

  const docMoc = (hangCho: HangChoLayBu): string | null => {
    try {
      return docMocLayBu(deps.accountId)[hangCho] ?? null;
    } catch (err) {
      log.warn({ err, hangCho }, "Không đọc được mốc lấy bù");
      return null;
    }
  };

  const batDau = (hangCho: HangChoLayBu): void => {
    choBatDau.delete(hangCho);
    const moc = docMoc(hangCho);
    const l: K.Luot = { soTrang: 0, soTin: 0, daXin: null, tuMoc: moc !== null, evict: false, cho: null };
    luot[hangCho] = l;
    xin(hangCho, l, moc, true);
  };

  const batDauLuot = (): void => {
    lanXinCuoi = now();
    choBatDau.add("tin_nhom");
    batDau("tin_1_1");
    sau(K.BAT_DAU_511_MS + Math.floor(random() * K.LECH_511_MS), () => batDau("tin_nhom"));
  };

  /** Dọn mọi thứ đang chạy (đóng kết nối, hoặc kết nối mới tới khi lượt cũ còn dở) */
  const donLuot = (lyDo: string): void => {
    const dangDo = timers.size > 0 || choBatDau.size > 0 || dangCoLuot();
    const conLuot = dangCoLuot();
    for (const t of timers) clearTimeout(t);
    timers.clear();
    choBatDau.clear();
    daBatKip.clear();
    if (!dangDo) return;
    lanXinCuoi = Number.NEGATIVE_INFINITY;
    for (const h of K.HANG_CHO) {
      const l = luot[h];
      if (l) ketThuc(h, l, "do", lyDo);
    }
    // Không còn lượt nào để `ketThuc` báo xong (vd 510 đã xong, 511 chưa kịp bắt
    // đầu): vẫn phải nhả tin đã lấy về, không thì chúng kẹt tới lượt sau
    if (!conLuot) an("báo xong lượt", deps.onLuotXong);
  };

  return {
    khiKetNoi() {
      if (daDung) return;
      donLuot("Kết nối mới thay kết nối cũ giữa lượt");
      let khoang = 0;
      an("đọc khoảng tối thiểu", () => (khoang = deps.khoangToiThieuMs()));
      const conCho = lanXinCuoi + khoang - now();
      if (conCho > 0) {
        // Vừa lấy bù xong: HOÃN tới hết khoảng chứ không bỏ - kết nối sau đó có thể
        // ổn định nhiều ngày, bỏ là tin lỡ lúc chớp mạng không bao giờ được xin
        log.debug({ conChoMs: conCho }, "Vừa lấy bù gần đây - hoãn lượt này");
        sau(conCho, batDauLuot);
        return;
      }
      batDauLuot();
    },

    khiDongKetNoi() {
      if (!daDung) donLuot("Mất kết nối giữa chừng - lần nối sau xin tiếp");
    },

    khiTrang(hangCho, trang) {
      if (daDung) return;
      for (const t of trang.tin) an("xử lý một tin lấy bù", () => deps.onTin(hangCho, t));
      const l = luot[hangCho];
      // Trang về trễ (lượt đã kết thúc) hay LẠC (không có yêu cầu nào đang chờ):
      // tin đã giao, không lật tiếp, không đụng mốc
      if (!l || !l.cho) return;
      clearTimeout(l.cho);
      timers.delete(l.cho);
      l.cho = null;
      l.soTrang++;
      l.soTin += trang.tin.length;
      if (trang.evict && !l.evict) {
        l.evict = true;
        log.warn({ hangCho }, "Zalo báo hàng chờ đã đầy và bỏ bớt phần cũ - một ít tin lỡ có thể đã mất");
      }
      const ke = trang.lastActionId;
      if (ke) an("lưu mốc", () => luuMocLayBu(deps.accountId, hangCho, ke));

      if (!trang.more) {
        daBatKip.add(hangCho);
        ketThuc(hangCho, l, l.evict ? "do" : "du", l.evict ? "Zalo báo hàng chờ đã đầy và bỏ bớt phần cũ" : null);
      } else if (!ke || ke === l.daXin) {
        ketThuc(hangCho, l, "do", "Zalo báo còn trang nhưng thiếu mã trang");
      } else if (l.soTrang >= K.TRAN_TRANG) {
        // Chỉ chạy tiếp khi mốc ĐÃ tiến tới trang cuối: không thì lượt sau xin lại
        // đúng 30 trang đó, lặp mãi trong cùng kết nối
        const tien = docMoc(hangCho) === ke;
        ketThuc(hangCho, l, "do", tien ? `Chạm trần ${K.TRAN_TRANG} trang - chạy tiếp sau` : "Chạm trần, mốc không tiến");
        if (tien) sau(K.CHAY_TIEP_SAU_TRAN_MS, () => !luot[hangCho] && batDau(hangCho));
        else log.warn({ hangCho }, "Chạm trần trang mà mốc không lưu được - không chạy tiếp");
      } else {
        sau(K.NHIP_TRANG_MS + Math.floor(random() * K.LECH_TRANG_MS), () => xin(hangCho, l, ke, false));
      }
    },

    khiTrangHong(hangCho, lyDo) {
      const l = luot[hangCho];
      if (!daDung && l) ketThuc(hangCho, l, "do", lyDo);
    },

    khiTinTrucTiep(hangCho, msgId) {
      if (daDung || !daBatKip.has(hangCho)) return;
      an("đẩy mốc theo tin trực tiếp", () => luuMocLayBu(deps.accountId, hangCho, msgId));
    },

    dung() {
      daDung = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      choBatDau.clear();
      for (const h of K.HANG_CHO) delete luot[h];
    },
  };
}
