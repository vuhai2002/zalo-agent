import type { HangChoLayBu } from "../../conversation/offline-replay-cursor-store.js";

/** Lệnh Zalo của hai hàng chờ tin (cách Zalo Web xin tin lỡ khi kết nối) */
export const LENH_LAY_BU: Record<HangChoLayBu, { cmd: 510 | 511; subCmd: 1 }> = {
  tin_1_1: { cmd: 510, subCmd: 1 },
  tin_nhom: { cmd: 511, subCmd: 1 },
};

export type TrangLayBu = {
  /** Tin thô (hình `TMessage`/`TGroupMessage` của zca-js), chưa bọc */
  tin: Record<string, unknown>[];
  /** Zalo còn trang sau */
  more: boolean;
  /** Mã trang: xin trang sau từ đây, và là mốc mới của hàng chờ */
  lastActionId: string | null;
  /** Zalo báo hàng chờ đã đầy và bỏ bớt phần cũ */
  evict: boolean;
};

const laObject = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * Đọc một trang phản hồi 510/511 đã giải mã: `{ msgs | groupMsgs, more,
 * lastActionId, queueStatus }`, có khi nằm trong `data`. Hình dạng theo phản
 * hồi thật đã ghi ở `zalo-archive-mcp` (`offline-message-replay.ts`).
 */
export function docTrangLayBu(hangCho: HangChoLayBu, duLieu: Record<string, unknown>): TrangLayBu {
  const d = laObject(duLieu.data) ?? duLieu;
  const mang = d[hangCho === "tin_1_1" ? "msgs" : "groupMsgs"];
  const tin = Array.isArray(mang) ? mang.filter((m): m is Record<string, unknown> => laObject(m) !== null) : [];
  const ma = d.lastActionId;
  const { cmd, subCmd } = LENH_LAY_BU[hangCho];
  const evict = laObject(laObject(d.queueStatus)?.[`${cmd}_${subCmd}`])?.evict;
  return {
    tin,
    more: d.more === true || d.more === 1,
    lastActionId: typeof ma === "string" || typeof ma === "number" ? String(ma) : null,
    evict: evict === true || evict === 1,
  };
}
