import type { HangChoLayBu } from "../../conversation/offline-replay-cursor-store.js";
import type { TrangLayBu } from "./doc-trang-lay-bu.js";

/** Kiểu + hằng số của bộ xin bù tin lỡ (`xin-bu-tin-lo.ts`), tách ra cho file chính gọn */
export const TRAN_TRANG = 30;
export const HET_GIO_TRANG_MS = 8_000;
export const CHAY_TIEP_SAU_TRAN_MS = 60_000;
export const HANG_CHO: readonly HangChoLayBu[] = ["tin_1_1", "tin_nhom"];
/** 511 bắt đầu sau 510 thêm [BAT_DAU_511_MS, + LECH_511_MS) */
export const BAT_DAU_511_MS = 2_000;
export const LECH_511_MS = 3_000;
/** Trang kế xin sau [NHIP_TRANG_MS, + LECH_TRANG_MS) - giữ nhịp, không dồn dập */
export const NHIP_TRANG_MS = 2_000;
export const LECH_TRANG_MS = 2_000;

export type KetQuaHangCho = {
  hangCho: HangChoLayBu;
  trangThai: "du" | "do";
  lyDo: string | null;
  soTrang: number;
  soTin: number;
};

export type BoXinBu = {
  khiKetNoi(): void;
  /** Kết nối đóng: bỏ phần xin dở, GIỮ mốc (trang không về vì mất kết nối, không phải Zalo chê mốc) */
  khiDongKetNoi(): void;
  khiTrang(hangCho: HangChoLayBu, trang: TrangLayBu): void;
  /** Trang về mà không đọc được (giải mã hỏng, sai hình): dừng dở, GIỮ mốc - khác "Zalo im" */
  khiTrangHong(hangCho: HangChoLayBu, lyDo: string): void;
  khiTinTrucTiep(hangCho: HangChoLayBu, msgId: string): void;
  dung(): void;
};

export type Luot = {
  soTrang: number;
  soTin: number;
  daXin: string | null;
  tuMoc: boolean;
  evict: boolean;
  cho: ReturnType<typeof setTimeout> | null;
};

export type PhuThuocXinBu = {
  accountId: string;
  /** Gửi lệnh xin bù qua WebSocket của listener (`api.listener.sendWs`) */
  guiLenh: (cmd: 510 | 511, data: { first: boolean; lastId: string | null; preIds: [] }) => void;
  onTin: (hangCho: HangChoLayBu, tinTho: Record<string, unknown>) => void;
  onHangChoXong: (kq: KetQuaHangCho) => void;
  /**
   * Hết một lượt (cả hai hàng chờ đã kết thúc, đủ hoặc dở; hoặc lượt chạy tiếp sau
   * trần xong; hoặc kết nối đóng giữa lượt) - nhả hàng chờ trả lời trễ. Có thể gọi
   * nhiều lần trong một kết nối.
   */
  onLuotXong: () => void;
  khoangToiThieuMs: () => number;
  /** Công tắc tắt nhanh - đọc lúc bắt đầu lượt và lúc chạy tiếp, không chỉ lúc kết nối */
  dangBat?: () => boolean;
  now?: () => number;
  random?: () => number;
};
