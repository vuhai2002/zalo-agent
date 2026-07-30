import { dayKeyOf } from "../shared/zone-time.js";
import { db } from "./database.js";

export type AgentTurnUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  steps: number;
};

const openStmt = db.prepare(`
  INSERT INTO agent_turns (account_id, thread_id) VALUES (?, ?)
`);

const finishStmt = db.prepare(`
  UPDATE agent_turns
  SET input_tokens = ?, output_tokens = ?, total_tokens = ?, steps = ?
  WHERE id = ?
`);

/**
 * Mở 1 lượt agent và lấy id NGAY, trước khi lượt chạy.
 *
 * Trước đây row chỉ được ghi SAU khi lượt xong, kéo theo hai lỗ:
 * - Lượt ném lỗi không có id nên trace của các step đã chạy bị vứt: lượt chạy
 *   tốt 5 step rồi step 6 gặp 500 là mất sạch phần chẩn đoán được.
 * - Không có id thì log trong lượt không mang nổi correlation id, hai lượt liên
 *   tiếp cùng thread trộn vào nhau và chỉ phân biệt được bằng timestamp.
 *
 * Cột số đều có DEFAULT 0 nên row mở ra là hợp lệ ngay. Process bị kill giữa
 * lượt để lại row 0 token không trace: trang Trace tự lọc (INNER JOIN sang
 * agent_steps), Overview đếm thừa 1 lượt - chấp nhận được, đổi lấy việc lượt
 * hỏng không còn vô hình.
 */
export function openAgentTurn(accountId: string, threadId: string): number {
  return Number(openStmt.run(accountId, threadId).lastInsertRowid);
}

/**
 * Chốt usage khi lượt xong - nguồn cho cột Context màn Sessions + thống kê chi phí.
 * Lượt ném lỗi vẫn nên gọi (với số đo được tới lúc hỏng) để row không nằm lại ở 0.
 */
export function finishAgentTurn(turnId: number, usage: AgentTurnUsage): void {
  finishStmt.run(usage.inputTokens, usage.outputTokens, usage.totalTokens, usage.steps, turnId);
}

const threadTotalsStmt = db.prepare(`
  SELECT COUNT(*) AS turns, COALESCE(SUM(total_tokens), 0) AS total_tokens
  FROM agent_turns WHERE account_id = ? AND thread_id = ?
`);

export function getThreadUsageTotals(
  accountId: string,
  threadId: string,
): { turns: number; totalTokens: number } {
  const row = threadTotalsStmt.get(accountId, threadId) as { turns: number; total_tokens: number };
  return { turns: row.turns, totalTokens: row.total_tokens };
}

// Trước đây gom bằng `substr(created_at, 1, 10)` ngay trong SQL - tức theo
// NGÀY UTC, lệch 7 tiếng so với ngày VN mà dashboard muốn hiển thị. SQLite
// không biết timezone nên không thể sửa bằng SQL thuần túy (offset cứng
// `datetime(created_at, '+7 hours')` lại sai với zone có DST). Giải pháp: câu
// SQL chỉ còn lo phần nó làm tốt - CHẶN PHẠM VI QUÉT bằng `created_at >= ?` -
// còn việc gộp theo ngày chuyển hẳn sang JS bằng `dayKeyOf` (qua luxon).
// Chi phí chấp nhận được: cửa sổ 7 ngày trên Overview chỉ vài chục dòng.
const dailySinceStmt = db.prepare(`
  SELECT created_at, input_tokens, output_tokens
  FROM agent_turns
  WHERE account_id = ? AND created_at >= ?
  ORDER BY created_at ASC
`);

/**
 * Thống kê theo ngày (theo `timeZone`, không phải UTC) từ mốc `sinceUtcIso` -
 * cho trang Overview. `sinceUtcIso` nên tính bằng `startOfDayUtc` lùi N ngày
 * để không lọt mất giờ đầu ngày VN (xem `overview-routes.ts`).
 */
export function getDailyUsage(
  accountId: string,
  sinceUtcIso: string,
  timeZone: string,
): { day: string; turns: number; inputTokens: number; outputTokens: number }[] {
  type Row = { created_at: string; input_tokens: number; output_tokens: number };
  const rows = dailySinceStmt.all(accountId, sinceUtcIso) as unknown as Row[];

  const byDay = new Map<string, { turns: number; inputTokens: number; outputTokens: number }>();
  for (const r of rows) {
    const day = dayKeyOf(r.created_at, timeZone);
    const agg = byDay.get(day) ?? { turns: 0, inputTokens: 0, outputTokens: 0 };
    agg.turns += 1;
    agg.inputTokens += r.input_tokens;
    agg.outputTokens += r.output_tokens;
    byDay.set(day, agg);
  }

  // Giữ nguyên thứ tự DESC (mới nhất trước) như hành vi cũ của câu SQL
  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, agg]) => ({ day, ...agg }));
}
