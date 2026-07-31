/**
 * "Chạy thử ngay" (dashboard, phase 05) - chạy 1 lượt job qua ĐÚNG đường ống
 * `runScheduledJob` (guard/gửi/trace y hệt lượt thật do vòng tick kích hoạt),
 * nhưng KHÔNG được làm lệch LỊCH THẬT của job.
 *
 * Không thể chỉ né `next_run_at`: `markRun()` (scheduled-job-store.ts) cộng
 * `run_count` RỒI so với `max_runs` - job 'once' luôn có `max_runs = 1` (bất
 * biến ở `createJob`), nên MỘT lượt CHẠY THỬ dùng hết đúng suất DUY NHẤT của
 * lịch, tự tắt job (`enabled = 0`, `next_run_at = NULL`) TRƯỚC KHI lịch thật
 * kịp chạy - đúng thứ brief cấm ("chạy thử không được làm lệch lịch thật"),
 * chỉ là nặng hơn câu chữ literal (không chỉ next_run_at đổi, job còn bị tắt
 * hẳn). Cùng lý do, `delivery_attempts` (đếm gửi hỏng liên tiếp, xem
 * `delivery-attempt-store.ts`) cũng bị lượt thử động vào - trộn với chuỗi gửi
 * hỏng THẬT sẽ làm job chạm trần `MAX_DELIVERY_ATTEMPTS` sớm hơn đáng lẽ.
 *
 * Giải pháp: chụp NGUYÊN VẸN các cột "sổ sách" của job TRƯỚC khi chạy, phục
 * hồi lại sau khi `runScheduledJob` (và mọi nhánh markRun/setNextRun nó gọi
 * bên trong) đã ghi xong. Lượt chạy thử vẫn để lại dấu vết THẬT trong
 * `scheduled_job_runs` (bảng lịch sử riêng, không đụng tới ở đây) - dashboard
 * vẫn thấy nó trong drawer lịch sử, chỉ có DÒNG JOB là được trả lại y nguyên.
 *
 * Không đặt hàm này vào `scheduled-job-store.ts` (giữ nguyên, tách riêng ở
 * phase khác) nên phải tự viết SQL chụp/phục hồi ở đây - không có hàm nào của
 * store cho phép ghi đè run_count, các cột last_..., hay delivery_attempts
 * về một giá trị tuỳ ý.
 */

import { db } from "../conversation/database.js";
import { listRuns, type JobRun } from "./job-run-log-store.js";
import { runScheduledJob } from "./run-scheduled-job.js";
import type { ScheduledJob } from "./scheduled-job-store.js";

type BookkeepingRow = {
  run_count: number;
  enabled: number;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  delivery_attempts: number;
};

const snapshotStmt = db.prepare(`
  SELECT run_count, enabled, next_run_at, last_run_at, last_status, last_error, delivery_attempts
  FROM scheduled_jobs WHERE id = ?
`);

const restoreStmt = db.prepare(`
  UPDATE scheduled_jobs
  SET run_count = ?, enabled = ?, next_run_at = ?, last_run_at = ?, last_status = ?, last_error = ?,
      delivery_attempts = ?
  WHERE id = ?
`);

/**
 * Chạy thử 1 job NGAY - gửi thật, tính vào trần ngày, để lại run log thật,
 * nhưng KHÔNG đổi bất kỳ cột "lịch thật" nào trên `scheduled_jobs`. Trả về
 * dòng lịch sử vừa ghi (nếu có) để route trả kết quả cho web.
 */
export async function runScheduledJobTrial(job: ScheduledJob): Promise<JobRun | undefined> {
  const before = snapshotStmt.get(job.id) as BookkeepingRow | undefined;

  await runScheduledJob(job, {
    late: false,
    scheduledFor: job.nextRunAt ?? new Date().toISOString(),
  });

  if (before) {
    restoreStmt.run(
      before.run_count,
      before.enabled,
      before.next_run_at,
      before.last_run_at,
      before.last_status,
      before.last_error,
      before.delivery_attempts,
      job.id,
    );
  }

  return listRuns(job.id, 1)[0];
}
