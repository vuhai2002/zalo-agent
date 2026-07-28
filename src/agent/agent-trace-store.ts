import { env } from "../config/env.js";
import { db } from "../conversation/database.js";
import type { StepTrace } from "./agent-step-trace.js";

/**
 * Lưu trace từng step của lượt agent vào SQLite, nối với `agent_turns` qua
 * turn_id.
 *
 * Vì sao lưu DB chứ không chỉ log: log trôi mất và khó nối các step của cùng
 * một lượt lại với nhau. Vì sao SQLite chứ không đẩy sang dịch vụ trace ngoài:
 * trace chứa NGUYÊN VĂN tin nhắn của người thật, đẩy lên SaaS là đẩy hội thoại
 * của họ ra khỏi máy - đó là quyết định về quyền riêng tư, không phải kỹ thuật.
 * Dashboard sẵn có đã đủ chỗ để xem.
 *
 * Bảng này phình nhanh nhất trong DB nên `pruneOldTraces` chạy cùng nhịp dọn media.
 */

const insertStmt = db.prepare(`
  INSERT INTO agent_steps
    (turn_id, step_number, text, reasoning, tool_calls, tool_results, finish_reason,
     warnings, input_tokens, output_tokens)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const selectStmt = db.prepare(`
  SELECT step_number, text, reasoning, tool_calls, tool_results, finish_reason,
         warnings, input_tokens, output_tokens
  FROM agent_steps WHERE turn_id = ? ORDER BY step_number ASC, id ASC
`);

const recentTurnsStmt = db.prepare(`
  SELECT t.id, t.total_tokens, t.steps, t.created_at,
         (SELECT COUNT(*) FROM agent_steps s WHERE s.turn_id = t.id) AS step_count
  FROM agent_turns t
  WHERE t.account_id = ? AND t.thread_id = ?
  ORDER BY t.id DESC LIMIT ?
`);

/**
 * Lượt của MỌI thread cho trang Trace ở sidebar.
 *
 * INNER JOIN chứ không LEFT: chỉ liệt kê lượt CÓ trace. Lượt không trace mà lên
 * danh sách thì bấm vào rỗng - tệ hơn là không hiện.
 * LEFT JOIN sang threads vì thread có thể chưa kịp có tên hiển thị.
 */
const recentAllStmt = db.prepare(`
  SELECT t.id, t.account_id, t.thread_id, t.total_tokens, t.steps, t.created_at,
         COALESCE(NULLIF(th.display_name, ''), t.thread_id) AS display_name,
         COUNT(s.id) AS step_count
  FROM agent_turns t
  JOIN agent_steps s ON s.turn_id = t.id
  LEFT JOIN threads th ON th.account_id = t.account_id AND th.thread_id = t.thread_id
  GROUP BY t.id
  ORDER BY t.id DESC LIMIT ?
`);

const pruneStmt = db.prepare("DELETE FROM agent_steps WHERE created_at < ?");

type StepRow = {
  step_number: number;
  text: string;
  reasoning: string;
  tool_calls: string;
  tool_results: string;
  finish_reason: string;
  warnings: string;
  input_tokens: number;
  output_tokens: number;
};

/** JSON hỏng trong DB không được làm chết trang dashboard */
function doJson<T>(raw: string, macDinh: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return macDinh;
  }
}

export function saveTurnTrace(turnId: number, steps: StepTrace[]): void {
  for (const s of steps) {
    insertStmt.run(
      turnId,
      s.stepNumber,
      s.text,
      s.reasoning,
      JSON.stringify(s.toolCalls),
      JSON.stringify(s.toolResults),
      s.finishReason,
      JSON.stringify(s.warnings),
      s.inputTokens,
      s.outputTokens,
    );
  }
}

export function getTurnTrace(turnId: number): StepTrace[] {
  const rows = selectStmt.all(turnId) as unknown as StepRow[];
  return rows.map((r) => ({
    stepNumber: r.step_number,
    text: r.text,
    reasoning: r.reasoning,
    toolCalls: doJson<StepTrace["toolCalls"]>(r.tool_calls, []),
    toolResults: doJson<StepTrace["toolResults"]>(r.tool_results, []),
    finishReason: r.finish_reason,
    warnings: doJson<string[]>(r.warnings, []),
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
  }));
}

export type TurnSummary = {
  id: number;
  totalTokens: number;
  steps: number;
  stepCount: number;
  createdAt: string;
};

/** Các lượt gần đây của 1 thread - danh sách cho dashboard bấm vào xem trace */
export function getRecentTurns(accountId: string, threadId: string, limit: number): TurnSummary[] {
  type Row = {
    id: number;
    total_tokens: number;
    steps: number;
    step_count: number;
    created_at: string;
  };
  const rows = recentTurnsStmt.all(accountId, threadId, limit) as unknown as Row[];
  return rows.map((r) => ({
    id: r.id,
    totalTokens: r.total_tokens,
    steps: r.steps,
    stepCount: r.step_count,
    createdAt: r.created_at,
  }));
}

export type TurnAcrossThreads = TurnSummary & {
  accountId: string;
  threadId: string;
  /** Tên thread, rơi về threadId khi thread chưa kịp có tên */
  displayName: string;
};

/** Lượt gần đây của mọi thread - nguồn cho trang Trace ở sidebar */
export function getRecentTurnsAllThreads(limit: number): TurnAcrossThreads[] {
  type Row = {
    id: number;
    account_id: string;
    thread_id: string;
    total_tokens: number;
    steps: number;
    step_count: number;
    created_at: string;
    display_name: string;
  };
  const rows = recentAllStmt.all(limit) as unknown as Row[];
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    threadId: r.thread_id,
    displayName: r.display_name,
    totalTokens: r.total_tokens,
    steps: r.steps,
    stepCount: r.step_count,
    createdAt: r.created_at,
  }));
}

/** Xóa trace cũ hơn N ngày. Trả về số dòng đã xóa. */
export function pruneOldTraces(retentionDays = env.AGENT_TRACE_RETENTION_DAYS): number {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  return Number(pruneStmt.run(cutoff).changes);
}
