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
  // Bất biến: 'once' LUÔN đúng 1 lần - kiểm kind TRƯỚC, bỏ qua mọi maxRuns
  // caller truyền vào (kể cả tường minh > 1). Lỗ hổng đo được: maxRuns=5 lọt
  // qua trên job once thì computeNextRun('once') vẫn trả nguyên runAtUtc bất
  // kể `now`, nên sau lần chạy đầu (chưa chạm trần 5) next_run_at đứng yên ở
  // mốc đã qua -> tick sau nhặt lại NGAY -> bắn lại mỗi tick tới khi đủ 5 lần.
  const maxRuns = input.schedule.kind === "once" ? 1 : (input.maxRuns !== undefined ? input.maxRuns : null);

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
  // Vừa tự ghi xong với đúng (accountId, threadId) nên đọc lại KHÔNG cần qua
  // kiểm phạm vi - đọc unscoped tránh double-check thừa trên dữ liệu tự tin.
  return getJobUnscoped(id)!;
}

const getUnscopedStmt = db.prepare(`SELECT * FROM scheduled_jobs WHERE id = ?`);

/**
 * Đọc job KHÔNG kiểm phạm vi - CHỈ dùng nội bộ cho vòng tick (`listDueJobs`
 * quét mọi account rồi tự nó cần tra lại 1 job bằng id nó vừa tìm ra) và cho
 * `markRun`/`createJob` là những chỗ đã tự tin về nguồn gốc id. TUYỆT ĐỐI
 * không gọi hàm này với id do người dùng/LLM cung cấp - đó là đường IDOR
 * (id chỉ là 12 ký tự hex, đoán hoặc dò được).
 */
export function getJobUnscoped(id: string): ScheduledJob | undefined {
  const row = getUnscopedStmt.get(id) as ScheduledJobRow | undefined;
  return row ? mapRow(row) : undefined;
}

const getScopedStmt = db.prepare(
  `SELECT * FROM scheduled_jobs WHERE id = ? AND account_id = ? AND thread_id = ?`,
);

/**
 * Đọc job CÓ kiểm phạm vi - đường dùng cho tool/API dashboard. Kiểm ở đây
 * (tầng store) chứ không chỉ ở tool: đúng nếp "chọn Brave mà chưa có key bị
 * chặn ngay ở tầng store" - mọi caller sau này (tool phase 04, route dashboard
 * phase 05) đều tự động dính cùng luật, không ai có thể quên kiểm.
 */
export function getJob(accountId: string, threadId: string, id: string): ScheduledJob | undefined {
  const row = getScopedStmt.get(id, accountId, threadId) as ScheduledJobRow | undefined;
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
  WHERE id = ? AND account_id = ? AND thread_id = ?
`);

/**
 * Cập nhật một phần; ô không truyền giữ nguyên giá trị cũ. Chỉ tính lại
 * `next_run_at` khi `schedule` thực sự đổi - đổi mỗi tên/payload mà tính lại
 * lịch là vô lý và có thể nhảy mốc ngoài ý muốn.
 *
 * `(accountId, threadId)` bắt buộc và đưa thẳng vào WHERE - job của thread
 * khác thì coi như không tồn tại (trả `false`), không lộ cả sự tồn tại của nó.
 */
export function updateJob(
  accountId: string,
  threadId: string,
  id: string,
  patch: UpdateScheduledJobInput,
): boolean {
  const job = getJob(accountId, threadId, id);
  if (!job) return false;

  const cols = patch.schedule
    ? scheduleColumns(patch.schedule)
    : { runAt: job.runAt, everyMinutes: job.everyMinutes, cronExpr: job.cronExpr };
  const nextRunAt = patch.schedule ? computeNextRun(patch.schedule, patch.now ?? new Date()) : job.nextRunAt;
  const effectiveKind = patch.schedule?.kind ?? job.scheduleKind;
  // Kind THỰC SỰ đổi - không phải chỉ "có patch.schedule". Trigger rộng hơn
  // (cứ có patch.schedule là tính lại) từng làm mất maxRuns=5 đặt tường minh
  // lúc tạo khi chỉ đổi tần suất every 30m -> every 45m (kind vẫn "every"):
  // trần "nhắc 5 lần rồi thôi" biến mất, job hoá vô hạn - đúng loại rủi ro
  // phase này sinh ra để chặn, chỉ khác chiều với ca dưới.
  const kindChanged = patch.schedule !== undefined && patch.schedule.kind !== job.scheduleKind;

  let maxRuns: number | null;
  if (effectiveKind === "once") {
    // Bất biến: 'once' LUÔN đúng 1 lần, kể cả khi patch truyền maxRuns khác -
    // computeNextRun('once') trả nguyên runAtUtc bất kể `now` nên maxRuns > 1
    // làm next_run_at đứng yên sau lần chạy đầu và bị nhặt lại mỗi tick tới
    // khi đủ số lần.
    maxRuns = 1;
  } else if (patch.maxRuns !== undefined) {
    maxRuns = patch.maxRuns;
  } else if (kindChanged) {
    // Đổi hẳn sang kind khác (every<->cron) mà không nói rõ maxRuns -> mặc
    // định vô hạn, mirror đúng ternary của createJob cho kind mới.
    maxRuns = null;
  } else {
    // Không đổi kind (kể cả không đổi schedule gì) -> giữ nguyên giá trị cũ.
    maxRuns = job.maxRuns;
  }

  updateStmt.run(
    patch.name ?? job.name,
    patch.payload ?? job.payload,
    patch.schedule?.kind ?? job.scheduleKind,
    cols.runAt,
    cols.everyMinutes,
    cols.cronExpr,
    patch.timezone ?? job.timezone,
    nextRunAt,
    maxRuns,
    id,
    accountId,
    threadId,
  );
  return true;
}

const setEnabledStmt = db.prepare(
  `UPDATE scheduled_jobs SET enabled = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE id = ? AND account_id = ? AND thread_id = ?`,
);

export function setEnabled(accountId: string, threadId: string, id: string, enabled: boolean): boolean {
  return setEnabledStmt.run(enabled ? 1 : 0, id, accountId, threadId).changes > 0;
}

const deleteStmt = db.prepare(`DELETE FROM scheduled_jobs WHERE id = ? AND account_id = ? AND thread_id = ?`);
// Không có FK/cascade tới scheduled_job_runs (job_id chỉ là TEXT thường) và
// bảng đó chỉ được prune xuống SCHEDULER_RUN_LOG_KEEP khi job đó MỞ LƯỢT MỚI -
// job đã xoá thì không bao giờ mở lượt nữa, nên lịch sử của nó mồ côi VĨNH
// VIỄN nếu thiếu dòng dưới. Dashboard (schedule-page.tsx) đã nói với người
// dùng "Lịch sử chạy của lịch hẹn này cũng sẽ bị xóa theo" - câu đó phải ĐÚNG.
const deleteRunsStmt = db.prepare(`DELETE FROM scheduled_job_runs WHERE job_id = ?`);

export function deleteJob(accountId: string, threadId: string, id: string): boolean {
  const deleted = deleteStmt.run(id, accountId, threadId).changes > 0;
  if (deleted) deleteRunsStmt.run(id);
  return deleted;
}

const listDueStmt = db.prepare(`
  SELECT * FROM scheduled_jobs
  WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
  ORDER BY next_run_at ASC
`);

/**
 * Job đến hạn tính tới `nowUtc` (ISO) - nguồn cho vòng tick ở phase sau. CỐ Ý
 * không nhận `(accountId, threadId)`: vòng tick quét TOÀN CỤC mọi account, nó
 * không có "thread đang gọi" để mà giới hạn theo.
 */
export function listDueJobs(nowUtc: string): ScheduledJob[] {
  const rows = listDueStmt.all(nowUtc) as unknown as ScheduledJobRow[];
  return rows.map(mapRow);
}

const setNextRunStmt = db.prepare(
  `UPDATE scheduled_jobs SET next_run_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
);

/**
 * Ghi mốc chạy kế tiếp - vòng tick gọi hàm này TRƯỚC khi dispatch
 * (clear-before-dispatch). Không kiểm phạm vi: id ở đây luôn đến từ
 * `listDueJobs` (vòng tick tự tìm ra, không phải id người dùng cung cấp).
 */
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
 *
 * Không kiểm phạm vi, cùng lý do `setNextRun`: id đến từ vòng tick nội bộ.
 */
export function markRun(id: string, status: Exclude<JobRunStatus, "running">, error: string | null = null): void {
  const job = getJobUnscoped(id);
  if (!job) return;

  const runCount = job.runCount + 1;
  const hitMax = job.maxRuns !== null && runCount >= job.maxRuns;

  markRunStmt.run(runCount, status, error, hitMax ? 0 : job.enabled ? 1 : 0, hitMax ? null : job.nextRunAt, id);
}
