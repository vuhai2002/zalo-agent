/**
 * CRUD bảng `scheduled_jobs` - trạng thái HIỆN TẠI của từng job lịch hẹn.
 * Lịch sử chạy nằm ở `job-run-log-store.ts` (bảng riêng, xem lý do tách ở đó).
 * Hình dạng dữ liệu (type + chuyển đổi row) nằm ở `scheduled-job-record.ts`.
 */

import { randomBytes } from "node:crypto";
import { db } from "../conversation/database.js";
import type { JobRunStatus } from "./job-run-log-store.js";
import { computeNextRun } from "./next-run.js";
import type { ParsedSchedule } from "./schedule-parser.js";
import {
  mapRow,
  scheduleColumns,
  type JobKind,
  type ScheduledJob,
  type ScheduledJobRow,
} from "./scheduled-job-record.js";

export type { JobKind, ScheduledJob } from "./scheduled-job-record.js";
export { scheduleOf } from "./scheduled-job-record.js";

export type CreateScheduledJobInput = {
  accountId: string;
  threadId: string;
  threadType: number;
  name: string;
  kind: JobKind;
  payload: string;
  schedule: ParsedSchedule;
  /** Rỗng/bỏ trống = job trôi theo BOT_TIMEZONE lúc chạy */
  timezone?: string;
  /** Bỏ trống: `once` mặc định 1 lần, `every`/`cron` mặc định vô hạn (NULL) */
  maxRuns?: number | null;
  createdBy: string;
  /** Mốc "bây giờ" dùng để tính next_run_at đầu tiên - mặc định giờ hệ thống */
  now?: Date;
};

const insertStmt = db.prepare(`
  INSERT INTO scheduled_jobs
    (id, account_id, thread_id, thread_type, name, kind, payload, schedule_kind,
     run_at, every_minutes, cron_expr, timezone, next_run_at, max_runs, created_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

export function createJob(input: CreateScheduledJobInput): ScheduledJob {
  const id = randomBytes(6).toString("hex");
  const cols = scheduleColumns(input.schedule);
  const nextRunAt = computeNextRun(input.schedule, input.now ?? new Date());
  const maxRuns = input.maxRuns !== undefined ? input.maxRuns : input.schedule.kind === "once" ? 1 : null;

  insertStmt.run(
    id,
    input.accountId,
    input.threadId,
    input.threadType,
    input.name,
    input.kind,
    input.payload,
    input.schedule.kind,
    cols.runAt,
    cols.everyMinutes,
    cols.cronExpr,
    input.timezone ?? "",
    nextRunAt,
    maxRuns,
    input.createdBy,
  );
  return getJob(id)!;
}

const getStmt = db.prepare(`SELECT * FROM scheduled_jobs WHERE id = ?`);

export function getJob(id: string): ScheduledJob | undefined {
  const row = getStmt.get(id) as ScheduledJobRow | undefined;
  return row ? mapRow(row) : undefined;
}

const listByThreadStmt = db.prepare(
  `SELECT * FROM scheduled_jobs WHERE account_id = ? AND thread_id = ? ORDER BY created_at DESC`,
);

export function listJobsForThread(accountId: string, threadId: string): ScheduledJob[] {
  const rows = listByThreadStmt.all(accountId, threadId) as unknown as ScheduledJobRow[];
  return rows.map(mapRow);
}

export type UpdateScheduledJobInput = {
  name?: string;
  payload?: string;
  schedule?: ParsedSchedule;
  timezone?: string;
  maxRuns?: number | null;
  /** Mốc "bây giờ" để tính lại next_run_at khi đổi schedule - mặc định giờ hệ thống */
  now?: Date;
};

const updateStmt = db.prepare(`
  UPDATE scheduled_jobs
  SET name = ?, payload = ?, schedule_kind = ?, run_at = ?, every_minutes = ?, cron_expr = ?,
      timezone = ?, next_run_at = ?, max_runs = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = ?
`);

/**
 * Cập nhật một phần; ô không truyền giữ nguyên giá trị cũ. Chỉ tính lại
 * `next_run_at` khi `schedule` thực sự đổi - đổi mỗi tên/payload mà tính lại
 * lịch là vô lý và có thể nhảy mốc ngoài ý muốn.
 */
export function updateJob(id: string, patch: UpdateScheduledJobInput): boolean {
  const job = getJob(id);
  if (!job) return false;

  const cols = patch.schedule
    ? scheduleColumns(patch.schedule)
    : { runAt: job.runAt, everyMinutes: job.everyMinutes, cronExpr: job.cronExpr };
  const nextRunAt = patch.schedule ? computeNextRun(patch.schedule, patch.now ?? new Date()) : job.nextRunAt;

  updateStmt.run(
    patch.name ?? job.name,
    patch.payload ?? job.payload,
    patch.schedule?.kind ?? job.scheduleKind,
    cols.runAt,
    cols.everyMinutes,
    cols.cronExpr,
    patch.timezone ?? job.timezone,
    nextRunAt,
    patch.maxRuns !== undefined ? patch.maxRuns : job.maxRuns,
    id,
  );
  return true;
}

const setEnabledStmt = db.prepare(
  `UPDATE scheduled_jobs SET enabled = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
);

export function setEnabled(id: string, enabled: boolean): boolean {
  return setEnabledStmt.run(enabled ? 1 : 0, id).changes > 0;
}

const deleteStmt = db.prepare(`DELETE FROM scheduled_jobs WHERE id = ?`);

export function deleteJob(id: string): boolean {
  return deleteStmt.run(id).changes > 0;
}

const listDueStmt = db.prepare(`
  SELECT * FROM scheduled_jobs
  WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
  ORDER BY next_run_at ASC
`);

/** Job đến hạn tính tới `nowUtc` (ISO) - nguồn cho vòng tick ở phase sau */
export function listDueJobs(nowUtc: string): ScheduledJob[] {
  const rows = listDueStmt.all(nowUtc) as unknown as ScheduledJobRow[];
  return rows.map(mapRow);
}

const setNextRunStmt = db.prepare(
  `UPDATE scheduled_jobs SET next_run_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
);

/** Ghi mốc chạy kế tiếp - vòng tick gọi hàm này TRƯỚC khi dispatch (clear-before-dispatch) */
export function setNextRun(id: string, nextRunAtUtc: string | null): void {
  setNextRunStmt.run(nextRunAtUtc, id);
}

const markRunStmt = db.prepare(`
  UPDATE scheduled_jobs
  SET run_count = ?, last_run_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_status = ?, last_error = ?,
      enabled = ?, next_run_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = ?
`);

/**
 * Ghi nhận 1 lần job đã chạy xong (tăng run_count + cập nhật tóm tắt). Chạm
 * `max_runs` thì tự `enabled = 0` và `next_run_at = NULL` nhưng GIỮ NGUYÊN
 * row - xoá hẳn (như Hermes/goclaw) làm lời nhắc đã hẹn biến mất không dấu vết.
 */
export function markRun(id: string, status: Exclude<JobRunStatus, "running">, error: string | null = null): void {
  const job = getJob(id);
  if (!job) return;

  const runCount = job.runCount + 1;
  const hitMax = job.maxRuns !== null && runCount >= job.maxRuns;

  markRunStmt.run(runCount, status, error, hitMax ? 0 : job.enabled ? 1 : 0, hitMax ? null : job.nextRunAt, id);
}
