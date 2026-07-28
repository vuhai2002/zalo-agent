import { db } from "./database.js";

export type AgentTurnUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  steps: number;
};

const insertStmt = db.prepare(`
  INSERT INTO agent_turns (account_id, thread_id, input_tokens, output_tokens, total_tokens, steps)
  VALUES (?, ?, ?, ?, ?, ?)
`);

/**
 * Ghi usage 1 lượt agent - nguồn cho cột Context màn Sessions + thống kê chi phí.
 * Trả về id của lượt để trace từng step nối vào (agent_steps.turn_id).
 */
export function recordAgentTurn(
  accountId: string,
  threadId: string,
  usage: AgentTurnUsage,
): number {
  const info = insertStmt.run(
    accountId,
    threadId,
    usage.inputTokens,
    usage.outputTokens,
    usage.totalTokens,
    usage.steps,
  );
  return Number(info.lastInsertRowid);
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
