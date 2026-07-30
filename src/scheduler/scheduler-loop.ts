/**
 * Vòng tick: quét job đến hạn -> quyết định run/run-late/skip-forward ->
 * clear-before-dispatch -> dispatch KHÔNG AWAIT qua `runOnThreadChain`.
 *
 * "Không await trong tick" là luật cứng nhất ở đây (goclaw học bằng máu:
 * `wg.Wait()` trong vòng lặp làm đứng cả scheduler) - một job agent có thể
 * chạy vài phút, chặn tick kế là chặn MỌI thread khác, không riêng gì job đó.
 */

import { env } from "../config/env.js";
import { getTuning } from "../config/runtime-tuning-settings.js";
import { db } from "../conversation/database.js";
import { runOnThreadChain } from "../middleware/message-batcher.js";
import { createLogger } from "../shared/logger.js";
import { finishRun, openRun } from "./job-run-log-store.js";
import { computeNextRun, decideDueAction } from "./next-run.js";
import { runScheduledJob } from "./run-scheduled-job.js";
import { listDueJobs, scheduleOf, setNextRun, type ScheduledJob } from "./scheduled-job-store.js";

const log = createLogger("scheduler-loop");

let timer: NodeJS.Timeout | undefined;

/**
 * Boot: mọi row `scheduled_job_runs` còn `status='running'` là process CŨ bị
 * giết giữa chừng - một process duy nhất (node:sqlite đồng bộ), không cần
 * chứng minh bằng pid như Hermes (2 tiến trình gateway/CLI tranh nhau jobs.json).
 */
const interruptStaleRunsStmt = db.prepare(`
  UPDATE scheduled_job_runs
  SET status = 'interrupted', finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE status = 'running'
`);

/** Gọi sau `startAllAccounts()` lúc boot. An toàn khi gọi lại (no-op nếu đã chạy). */
export function startScheduler(): void {
  if (!getTuning("SCHEDULER_ENABLED")) {
    log.info("SCHEDULER_ENABLED=false - không đăng ký vòng tick, job vẫn nằm nguyên trong DB");
    return;
  }
  if (timer) return; // đã chạy rồi - gọi 2 lần không được nhân đôi vòng tick

  const interrupted = interruptStaleRunsStmt.run().changes;
  if (interrupted > 0) {
    log.warn({ interrupted }, "Đánh dấu các lượt job dở dang từ lần chạy trước là 'interrupted'");
  }

  // Chạy NGAY, không đợi hết SCHEDULER_TICK_MS đầu tiên - job quá hạn (bot vừa
  // khởi động lại sau một khoảng ngừng) được xử lý liền, qua đúng cơ chế
  // grace/skip-forward vẫn dùng mỗi tick - không cần nhánh riêng cho "lúc boot".
  void runSchedulerTick();
  timer = setInterval(() => void runSchedulerTick(), getTuning("SCHEDULER_TICK_MS"));
  timer.unref();
  log.info({ tickMs: getTuning("SCHEDULER_TICK_MS") }, "Scheduler đã khởi động");
}

/** Gọi trong `shutdown()`. An toàn khi gọi dù chưa từng start. */
export function stopScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
}

/**
 * 1 lần quét job đến hạn. Export riêng (không chỉ gọi được qua `setInterval`)
 * để test gọi trực tiếp, không phải chờ timer thật.
 */
export async function runSchedulerTick(now: Date = new Date()): Promise<void> {
  // Đọc lại MỖI tick, không chỉ lúc startScheduler(): SCHEDULER_ENABLED là
  // tham số chỉnh-nóng, đúng triết lý getTuning "đọc lại mỗi lần dùng" của cả
  // dự án. Thiếu dòng này thì tắt cờ trên dashboard trong lúc bot đang chạy
  // không có tác dụng gì - interval đã đăng ký ở startScheduler() cứ thế chạy
  // tiếp, một cái công tắc an toàn mà không thật sự tắt được là vô nghĩa.
  if (!getTuning("SCHEDULER_ENABLED")) return;

  // Một job hỏng không được giết vòng lặp (goclaw safeCheckJobs) - bọc TOÀN
  // BỘ tick, không chỉ từng job: lỗi bất ngờ ngay ở listDueJobs cũng không
  // được làm setInterval ngừng gọi tick kế tiếp.
  try {
    const due = listDueJobs(now.toISOString());
    for (const job of due) {
      processDueJob(job, now);
    }
  } catch (err) {
    log.error({ err }, "Tick lỗi - vòng lặp vẫn tiếp tục ở lần kế");
  }
}

function processDueJob(job: ScheduledJob, now: Date): void {
  try {
    const schedule = scheduleOf(job, env.BOT_TIMEZONE);
    const scheduledFor = job.nextRunAt!; // listDueJobs đã lọc next_run_at NOT NULL
    const action = decideDueAction(
      { schedule, nextRunAt: new Date(scheduledFor), onceGraceMinutes: getTuning("SCHEDULER_ONCE_GRACE_MINUTES") },
      now,
    );

    // Clear-before-dispatch: ghi next_run_at MỚI trước khi dispatch, để tick
    // kế (SCHEDULER_TICK_MS sau) không nhặt lại ĐÚNG job này trong lúc nó còn
    // chạy dở. 'once' không có "mốc kế" thật - computeNextRun trả nguyên
    // runAtUtc CŨ (đã ở quá khứ) bất kể `now`, nên phải clear thẳng về NULL;
    // dùng computeNextRun ở đây sẽ để lại mốc cũ và tick kế nhặt lại NGAY,
    // dispatch lần 2 trước khi markRun (run-scheduled-job.ts) kịp tắt job.
    const nextRunAt = schedule.kind === "once" ? null : computeNextRun(schedule, new Date(scheduledFor), now);
    setNextRun(job.id, nextRunAt);

    if (action === "skip-forward") {
      // Bỏ lượt HẲN, không dispatch: every/cron trễ quá grace, "chạy bù" sẽ
      // dồn backlog. Ghi run 'skipped' NGAY (không qua run-scheduled-job.ts,
      // không có gì thật sự chạy) để dashboard vẫn thấy vì sao mốc kế nhảy xa.
      const runId = openRun(job.id);
      finishRun(runId, { status: "skipped", detail: "Bỏ lượt vì đã trễ quá cửa sổ grace - dời sang lần kế tiếp." });
      log.info({ jobId: job.id, nextRunAt }, "Job trễ quá grace - bỏ lượt, dời lịch");
      return;
    }

    const threadKey = `${job.accountId}:${job.threadId}`;
    // KHÔNG await: đúng luật cứng nhất của cả vòng tick (xem doc đầu file)
    void runOnThreadChain(threadKey, () => runScheduledJob(job, { late: action === "run-late", scheduledFor }));
  } catch (err) {
    // 1 job hỏng không được giết tick - các job KHÁC trong CÙNG tick vẫn phải
    // được xử lý tiếp (goclaw safeCheckJobs, cùng lý do với try/catch ở trên
    // nhưng ở mức TỪNG JOB thay vì cả tick).
    log.error({ jobId: job.id, err }, "Lỗi xử lý 1 job đến hạn - bỏ qua job này, tick vẫn tiếp tục");
  }
}
