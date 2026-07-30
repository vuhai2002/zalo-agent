/**
 * Kiểu dữ liệu của 1 job lịch hẹn + chuyển đổi row DB (snake_case) <-> object
 * (camelCase). Tách khỏi `scheduled-job-store.ts` để file CRUD không vượt quá
 * ngưỡng 200 dòng - đây thuần là "hình dạng dữ liệu", không có câu SQL nào.
 */

import type { ParsedSchedule } from "./schedule-parser.js";

export type JobKind = "message" | "agent";

export type ScheduledJob = {
  id: string;
  accountId: string;
  threadId: string;
  threadType: number;
  name: string;
  kind: JobKind;
  payload: string;
  scheduleKind: ParsedSchedule["kind"];
  runAt: string | null;
  everyMinutes: number | null;
  cronExpr: string | null;
  /** Rỗng = job trôi theo BOT_TIMEZONE lúc chạy, xem `scheduleOf` */
  timezone: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  runCount: number;
  maxRuns: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

/** Hình dạng row thô đọc thẳng từ SQLite (snake_case, số 0/1 cho boolean) */
export type ScheduledJobRow = {
  id: string;
  account_id: string;
  thread_id: string;
  thread_type: number;
  name: string;
  kind: string;
  payload: string;
  schedule_kind: string;
  run_at: string | null;
  every_minutes: number | null;
  cron_expr: string | null;
  timezone: string;
  enabled: number;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  run_count: number;
  max_runs: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export function mapRow(r: ScheduledJobRow): ScheduledJob {
  return {
    id: r.id,
    accountId: r.account_id,
    threadId: r.thread_id,
    threadType: r.thread_type,
    name: r.name,
    kind: r.kind as JobKind,
    payload: r.payload,
    scheduleKind: r.schedule_kind as ParsedSchedule["kind"],
    runAt: r.run_at,
    everyMinutes: r.every_minutes,
    cronExpr: r.cron_expr,
    timezone: r.timezone,
    enabled: r.enabled === 1,
    nextRunAt: r.next_run_at,
    lastRunAt: r.last_run_at,
    lastStatus: r.last_status,
    lastError: r.last_error,
    runCount: r.run_count,
    maxRuns: r.max_runs,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Cột riêng theo `schedule.kind` - đúng 1 trong 3 có giá trị, còn lại NULL */
export function scheduleColumns(
  schedule: ParsedSchedule,
): { runAt: string | null; everyMinutes: number | null; cronExpr: string | null } {
  return {
    runAt: schedule.kind === "once" ? schedule.runAtUtc : null,
    everyMinutes: schedule.kind === "every" ? schedule.minutes : null,
    cronExpr: schedule.kind === "cron" ? schedule.expr : null,
  };
}

/**
 * Dựng lại `ParsedSchedule` từ 1 row - cầu nối để phase sau (vòng tick) gọi
 * thẳng `computeNextRun`/`decideDueAction` mà không phải tự bóc cột. Cột
 * `timezone` rỗng nghĩa là job trôi theo cấu hình hiện tại nên rơi về
 * `defaultTimeZone` (BOT_TIMEZONE) do CALLER truyền vào - module này không tự
 * đọc env.
 */
export function scheduleOf(job: ScheduledJob, defaultTimeZone: string): ParsedSchedule {
  if (job.scheduleKind === "once") return { kind: "once", runAtUtc: job.runAt! };
  if (job.scheduleKind === "every") return { kind: "every", minutes: job.everyMinutes! };
  return { kind: "cron", expr: job.cronExpr!, timeZone: job.timezone || defaultTimeZone };
}
