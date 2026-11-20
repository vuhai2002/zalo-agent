import { db } from "./database.js";

/**
 * Mốc lấy bù tin lỡ theo account: id việc (`lastActionId` / msgId, cùng hệ id)
 * mới nhất của hàng chờ Zalo mà bot đã có. Lần kết nối sau xin TỪ mốc thay vì
 * từ đầu hàng chờ (~2 tuần). Cách lưu theo `zalo-archive-mcp`
 * (`offline-replay-cursor-store.ts`).
 */
export type HangChoLayBu = "tin_1_1" | "tin_nhom";

const DAY_SO = /^\d+$/;

/**
 * `id` có mới hơn `moc` không. Id Zalo là số nguyên lớn dạng chuỗi (vượt
 * Number.MAX_SAFE_INTEGER) nên so bằng BigInt. Id không phải dãy số, hoặc toàn
 * số 0, không bao giờ được làm mốc. Mốc hỏng (không phải dãy số) coi như chưa có.
 */
export function laIdZaloMoiHon(id: string, moc: string | undefined): boolean {
  if (!DAY_SO.test(id) || /^0+$/.test(id)) return false;
  if (moc === undefined || !DAY_SO.test(moc)) return true;
  return BigInt(id) > BigInt(moc);
}

const docStmt = db.prepare("SELECT queue, last_id FROM offline_replay_cursors WHERE account_id = ?");
const luuStmt = db.prepare(
  `INSERT INTO offline_replay_cursors (account_id, queue, last_id) VALUES (?, ?, ?)
   ON CONFLICT(account_id, queue) DO UPDATE SET last_id = excluded.last_id,
     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
);
const xoaStmt = db.prepare("DELETE FROM offline_replay_cursors WHERE account_id = ? AND queue = ?");

export function docMocLayBu(accountId: string): Partial<Record<HangChoLayBu, string>> {
  const out: Partial<Record<HangChoLayBu, string>> = {};
  for (const row of docStmt.all(accountId) as { queue: string; last_id: string }[]) {
    if (row.queue === "tin_1_1" || row.queue === "tin_nhom") out[row.queue] = row.last_id;
  }
  return out;
}

/** Chỉ TIẾN: id không mới hơn mốc đang có thì bỏ qua (trang về trễ, tin trực tiếp cũ) */
export function luuMocLayBu(accountId: string, hangCho: HangChoLayBu, id: string): void {
  if (!laIdZaloMoiHon(id, docMocLayBu(accountId)[hangCho])) return;
  luuStmt.run(accountId, hangCho, id);
}

/** Bỏ mốc: Zalo không trả lời khi xin từ mốc này, lần sau xin từ đầu hàng chờ */
export function xoaMocLayBu(accountId: string, hangCho: HangChoLayBu): void {
  xoaStmt.run(accountId, hangCho);
}
