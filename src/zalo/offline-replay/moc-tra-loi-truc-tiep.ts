import type { ParsedMessage } from "../zalo-message-parser.js";

/** Mốc cũ hơn trần tuổi tối đa (7 ngày) vô dụng: tin lỡ cũ hơn thế đã bị chặn trước */
const TUOI_MOC_TOI_DA_MS = 7 * 24 * 3_600_000;
const DON_KHI_QUA = 500;

/** Khóa theo (thread, người gửi) - cùng cách bộ gộp tin gom batch */
export function khoaNguoi(threadKey: string, senderId: string): string {
  return `${threadKey}|${senderId}`;
}

/**
 * Nhớ "người này đã nhắn lại và được bot trả lời lúc nào", theo (thread, người gửi).
 *
 * Người dùng chốt: người ta đã nhắn và được bot trả lời bình thường thì họ biết bot
 * chạy lại rồi - tin lỡ CŨ hơn mốc đó của họ bỏ hẳn (không trả lời riêng, không xin
 * lỗi). Trong nhóm, B nhắn lại không có nghĩa A biết bot chạy lại, nên khóa theo
 * người gửi. Kèm danh sách tin VỪA nhả vào bộ gộp: người đó nhắn lại trước khi lượt
 * kịp chạy thì tin cũ đã chung batch với tin mới - chỉ gỡ cờ trễ được (gỡ hẳn khỏi
 * bộ gộp thì phải đụng bộ gộp).
 */
export class MocTraLoiTrucTiep {
  private readonly moc = new Map<string, number>();
  private readonly vuaNha = new Map<string, ParsedMessage[]>();

  /** Ghi mốc (chỉ tiến) và gỡ cờ trễ của tin cũ hơn vừa nhả của người này */
  ghi(khoa: string, lucMs: number): void {
    if (Number.isFinite(lucMs)) {
      this.moc.set(khoa, Math.max(lucMs, this.moc.get(khoa) ?? Number.NEGATIVE_INFINITY));
      if (this.moc.size > DON_KHI_QUA) {
        for (const [k, luc] of this.moc) if (luc < lucMs - TUOI_MOC_TOI_DA_MS) this.moc.delete(k);
      }
    }
    for (const m of this.vuaNha.get(khoa) ?? []) {
      if (!(Date.parse(m.sentAt) > lucMs)) delete m.layBu;
    }
    this.vuaNha.delete(khoa);
  }

  /** Tin lỡ này cũ hơn (hoặc bằng) lần người đó nhắn lại - bỏ */
  cuHonMoc(khoa: string, sentAt: string): boolean {
    const moc = this.moc.get(khoa);
    return moc !== undefined && !(Date.parse(sentAt) > moc);
  }

  /** Ghi các tin VỪA nhả vào bộ gộp (thay danh sách cũ - chỉ lần nhả gần nhất có thể còn đọng) */
  daNha(khoa: string, msgs: ParsedMessage[]): void {
    this.vuaNha.set(khoa, msgs);
  }

  xoaHet(): void {
    this.moc.clear();
    this.vuaNha.clear();
  }
}
