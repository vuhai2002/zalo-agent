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
 *
 * `null` = trang KHÔNG HỢP LỆ: thiếu hẳn mảng tin, hoặc có `error_code` khác 0.
 * Cố ý không hiểu những ca đó là "hết trang" (`more: false`): hiểu vậy là chốt
 * hàng chờ đã xong, rồi tin trực tiếp đẩy mốc qua mặt đoạn tin lỡ - mất câm.
 * zca-js và archive cũng chặt kiểu này (thiếu mảng thì `msgs.map` ném, trang coi
 * như không về).
 */
export function docTrangLayBu(hangCho: HangChoLayBu, duLieu: Record<string, unknown>): TrangLayBu | null {
  const d = laObject(duLieu.data) ?? duLieu;
  const maLoi = d.error_code ?? duLieu.error_code;
  if (maLoi !== undefined && maLoi !== 0 && maLoi !== "0") return null;
  const mang = d[hangCho === "tin_1_1" ? "msgs" : "groupMsgs"];
  if (!Array.isArray(mang)) return null;
  const tin = mang.filter((m): m is Record<string, unknown> => laObject(m) !== null);
  const ma = d.lastActionId;
  const { cmd, subCmd } = LENH_LAY_BU[hangCho];
  const evict = laObject(laObject(d.queueStatus)?.[`${cmd}_${subCmd}`])?.evict;
  return {
    tin,
    more: d.more === true || d.more === 1,
    // Số vượt 2^53 đã bị JSON.parse làm tròn (zca-js dùng JSONBig): mốc sai thì
    // thà không có
    lastActionId: typeof ma === "string" ? ma : typeof ma === "number" && Number.isSafeInteger(ma) ? String(ma) : null,
    evict: evict === true || evict === 1,
  };
}
