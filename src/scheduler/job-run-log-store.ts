/**
 * Sổ ghi ĐÃ XẢY RA GÌ ở từng lần job lịch hẹn chạy (bảng `scheduled_job_runs`).
 *
 * Khác `scheduled_jobs.last_status` (chỉ nói lần CUỐI): job hỏng 5 lần rồi lần
 * 6 chạy được sẽ trông khoẻ mạnh hoàn hảo nếu không có log riêng kể lại từng
 * lần - đúng lý do Hermes tách `executions.py` khỏi `jobs.py`. `turn_id` nối
 * sang `agent_turns` cho job kind='agent', bấm thẳng sang trang Trace khi cần
 * biết vì sao job trả lời sai.
 */

import { getTuning } from "../config/runtime-tuning-settings.js";
import { db } from "../conversation/database.js";

export type JobRunStatus = "running" | "ok" | "silent" | "skipped" | "error" | "interrupted";

export type JobRun = {
  id: number;
  jobId: string;
  turnId: number | null;
  status: JobRunStatus;
  detail: string;
  deliveredChars: number;
  startedAt: string;
  finishedAt: string | null;
};

type Row = {
  id: number;
  job_id: string;
  turn_id: number | null;
  status: JobRunStatus;
  detail: string;
  delivered_chars: number;
  started_at: string;
  finished_at: string | null;
};

function mapRow(r: Row): JobRun {
  return {
    id: r.id,
    jobId: r.job_id,
    turnId: r.turn_id,
    status: r.status,
    detail: r.detail,
    deliveredChars: r.delivered_chars,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

const openStmt = db.prepare(`INSERT INTO scheduled_job_runs (job_id, status) VALUES (?, 'running')`);

// Giữ KEEP lượt gần nhất mỗi job - cùng pattern prune của history-store/memory-store
// (dọn NGAY sau khi ghi, không cần cron riêng). Chạy trong `openRun` chứ không
// `finishRun` vì openRun đã sẵn có `jobId` - finishRun chỉ nhận runId, tra ngược
// ra jobId sẽ tốn thêm 1 SELECT mỗi lần chốt lượt.
const capStmt = db.prepare(`
  DELETE FROM scheduled_job_runs
  WHERE job_id = ?
    AND id <= (SELECT id FROM scheduled_job_runs
               WHERE job_id = ?
               ORDER BY id DESC LIMIT 1 OFFSET ?)
`);

/** Mở 1 lượt chạy (status='running') và lấy id NGAY - trước khi job thực sự chạy */
export function openRun(jobId: string, keep = getTuning("SCHEDULER_RUN_LOG_KEEP")): number {
  const id = Number(openStmt.run(jobId).lastInsertRowid);
  capStmt.run(jobId, jobId, keep);
  return id;
}

const finishStmt = db.prepare(`
  UPDATE scheduled_job_runs
  SET status = ?, detail = ?, delivered_chars = ?, turn_id = ?,
      finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = ?
`);

export type FinishRunParams = {
  status: Exclude<JobRunStatus, "running">;
  detail?: string;
  deliveredChars?: number;
  turnId?: number | null;
};

/** Chốt 1 lượt đã mở bằng `openRun` - gọi cả khi lỗi (detail là thông báo lỗi) */
export function finishRun(runId: number, params: FinishRunParams): void {
  finishStmt.run(params.status, params.detail ?? "", params.deliveredChars ?? 0, params.turnId ?? null, runId);
}

const listStmt = db.prepare(`
  SELECT id, job_id, turn_id, status, detail, delivered_chars, started_at, finished_at
  FROM scheduled_job_runs WHERE job_id = ? ORDER BY id DESC LIMIT ?
`);

/** Lịch sử chạy của 1 job, mới nhất trước - cho drawer lịch sử trên dashboard */
export function listRuns(jobId: string, limit = 50): JobRun[] {
  const rows = listStmt.all(jobId, limit) as unknown as Row[];
  return rows.map(mapRow);
}

const hasRunningStmt = db.prepare(`SELECT 1 FROM scheduled_job_runs WHERE job_id = ? AND status = 'running' LIMIT 1`);

/**
 * Job còn 1 lượt CHƯA CHỐT SỔ (status='running') - dùng để chặn "Chạy thử
 * ngay" (`schedule-routes.ts`) đụng độ với lượt DISPATCH THẬT đang chạy dở
 * (job `kind='agent'` có thể chạy lâu hơn `SCHEDULER_TICK_MS`). Đúng bài
 * "job hỏng 5 lần rồi lần 6..." đã ghi ở đầu file - `scheduled_jobs.last_status`
 * không đủ, phải hỏi bảng run log mới biết CÓ đang chạy hay không.
 */
export function hasRunningRun(jobId: string): boolean {
  return hasRunningStmt.get(jobId) !== undefined;
}
