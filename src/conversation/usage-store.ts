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

const dailyStmt = db.prepare(`
  SELECT substr(created_at, 1, 10) AS day,
         COUNT(*) AS turns,
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens
  FROM agent_turns
  WHERE account_id = ? AND created_at >= ?
  GROUP BY day ORDER BY day DESC
`);

/** Thống kê theo ngày (UTC) từ mốc sinceIsoDate (vd '2026-07-18') - cho trang Overview */
export function getDailyUsage(
  accountId: string,
  sinceIsoDate: string,
): { day: string; turns: number; inputTokens: number; outputTokens: number }[] {
  type Row = { day: string; turns: number; input_tokens: number; output_tokens: number };
  const rows = dailyStmt.all(accountId, sinceIsoDate) as unknown as Row[];
  return rows.map((r) => ({
    day: r.day,
    turns: r.turns,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
  }));
}
