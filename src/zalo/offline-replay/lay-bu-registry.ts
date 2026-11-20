import type { ParsedMessage } from "../zalo-message-parser.js";

/**
 * Sổ đăng ký mỏng: account nào đang chạy lấy bù. Router chỉ import file này,
 * KHÔNG import `lay-bu-cho-account.ts` - file đó kéo `tiep-nhan-tin-lay-bu.ts`,
 * mà file kia lại import router (vòng import).
 */
export type LayBuCuaAccount = {
  /** Listener vừa kết nối: xin bù 510/511 */
  khiKetNoi(): void;
  /** Listener đóng: bỏ phần xin dở, giữ mốc */
  khiDongKetNoi(): void;
  /** Tin TRỰC TIẾP (không trùng, không self): đẩy mốc nếu hàng chờ Zalo đã bắt kịp */
  khiTinTrucTiep(msg: ParsedMessage): void;
  /** Tin trực tiếp cần trả lời: bỏ tin lấy bù cũ hơn của thread (người ta biết bot chạy lại rồi) */
  daTraLoiTrucTiep(threadKey: string, lucMs: number): void;
  dung(): void;
};

const dangChay = new Map<string, LayBuCuaAccount>();

export function dangKyLayBu(accountId: string, layBu: LayBuCuaAccount): void {
  dangChay.set(accountId, layBu);
}

export function goDangKyLayBu(accountId: string, layBu: LayBuCuaAccount): void {
  // Chỉ gỡ đúng bản đang đăng ký: bản cũ dừng muộn không được gỡ mất bản mới
  if (dangChay.get(accountId) === layBu) dangChay.delete(accountId);
}

export function layBuCuaAccount(accountId: string): LayBuCuaAccount | undefined {
  return dangChay.get(accountId);
}
