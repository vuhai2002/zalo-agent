/**
 * Vòng tick: quét job đến hạn -> kiểm PRE-FLIGHT (account/thread + trần ngày,
 * rẻ, không đụng LLM nếu chặn) -> quyết định run/run-late/skip-forward ->
 * clear-before-dispatch -> dispatch KHÔNG AWAIT.
 *
 * "Không await trong tick" là luật cứng nhất ở đây (goclaw học bằng máu:
 * `wg.Wait()` trong vòng lặp làm đứng cả scheduler) - một job agent có thể
 * chạy vài phút, chặn tick kế là chặn MỌI thread khác, không riêng gì job đó.
 *
 * KHÔNG bọc `runOnThreadChain` quanh cả `runScheduledJob` ở đây (khoá thread
 * chỉ giữ ĐÚNG lúc gửi thật, trong `deliverProactively` - bọc ở tầng này sẽ
 * lồng 2 lần `runOnThreadChain` cho CÙNG threadKey và tự deadlock).
 */

import { botTimeZone, getTuning } from "../config/runtime-tuning-settings.js";
import { db } from "../conversation/database.js";
import { createLogger } from "../shared/logger.js";
import { resetDeliveryAttempts } from "./delivery-attempt-store.js";
import { finishRun, openRun } from "./job-run-log-store.js";
import { computeNextRun, decideDueAction } from "./next-run.js";
import { checkAccountAndThreadReady, checkProactiveDailyCap } from "./proactive-send-guard.js";
import { runScheduledJob } from "./run-scheduled-job.js";
import { concludeCapBlockedAtTick } from "./scheduled-job-cap-guard.js";
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

/**
 * Phục hồi lời nhắc 'once' bị GIÀNH (`next_run_at = NULL` bởi
 * clear-before-dispatch, xem `processDueJob`) nhưng process bị giết TRƯỚC khi
 * kịp `markRun` - deploy/restart BÌNH THƯỜNG, không phải sự cố hiếm. Thiếu
 * bước này: row còn `enabled = 1, next_run_at = NULL, run_count = 0`, mà
 * `listDueJobs` lọc `next_run_at IS NOT NULL` nên KHÔNG TICK NÀO còn thấy job
 * này nữa - lời nhắc biến mất VĨNH VIỄN, đúng bất biến đã chốt của nhánh này
 * bị vi phạm ("một lời nhắc chưa từng gửi được thì không bao giờ được coi là
 * đã chạy").
 *
 * `enabled = 1` + `run_count < max_runs` (hoặc `max_runs IS NULL`) phân biệt
 * "đang dở" với "đã chạy xong rồi tự tắt" - job 'once' đã hoàn thành đã bị
 * `markRun` đặt `enabled = 0` nên không khớp điều kiện đầu, nhưng vẫn giữ cả
 * điều kiện `run_count < max_runs` cho rõ ràng: thiếu nó là hồi sinh nhầm cả
 * job đã hoàn thành nếu bất biến `enabled` ở nơi khác đổi trong tương lai.
 *
 * Mặt trái CÓ CHỦ ĐÍCH, chấp nhận được: ca "tin đã ra Zalo thật nhưng process
 * chết TRƯỚC khi kịp `markRun`" cũng khớp đúng điều kiện trên nên bị hồi sinh
 * y hệt, khiến boot lại gửi trùng lần 2. Cửa sổ đó chỉ cỡ mili-giây (vài thao
 * tác SQLite đồng bộ giữa lúc gửi xong và lúc `markRun` chạy), đổi lại là xoá
 * được cửa sổ MẤT lời nhắc trước đây phủ cả lượt dispatch (lượt agent có thể
 * chạy vài phút) - đúng chiều bất biến đã chốt của nhánh này.
 */
const reviveClaimedOnceStmt = db.prepare(`
  UPDATE scheduled_jobs SET next_run_at = run_at
  WHERE enabled = 1 AND next_run_at IS NULL AND schedule_kind = 'once'
    AND run_at IS NOT NULL AND (max_runs IS NULL OR run_count < max_runs)
`);

/**
 * Ghi lý do chặn PRE-FLIGHT (account/thread) lên chính row job (Mục 5): trước
 * đây job bị chặn ở đây không để lại dấu vết nào, account rớt phiên 3 ngày
 * liền thì job hiện y hệt job khoẻ mạnh trên dashboard. Trần ngày không cần
 * cột này - `concludeCapBlockedAtTick` đã tự ghi 1 dòng run log 'skipped'.
 * Dùng lại `last_status`/`last_error` - tự "lành" khi job chạy thật lần kế.
 */
const markBlockedStmt = db.prepare(`
  UPDATE scheduled_jobs SET last_status = 'blocked', last_error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = ?
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

  // Chạy TRƯỚC tick đầu tiên: nhặt lại lời nhắc 'once' bị giành dở lúc restart.
  const revived = reviveClaimedOnceStmt.run().changes;
  if (revived > 0) {
    log.warn(
      { revived },
      "Phục hồi next_run_at cho lời nhắc 'once' bị giành (clear-before-dispatch) nhưng process bị giết trước khi kịp chạy xong",
    );
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
    pruneStaleReasons(due);
    for (const job of due) {
      processDueJob(job, now);
    }
  } catch (err) {
    log.error({ err }, "Tick lỗi - vòng lặp vẫn tiếp tục ở lần kế");
  }
}

/** Lý do chặn LẦN GẦN NHẤT mỗi job - chỉ log lại khi lý do ĐỔI, tránh spam mỗi 30s khi account offline nhiều ngày liền */
const lastPreflightReason = new Map<string, string>();

/**
 * Job KHÔNG CÒN due (bị xoá, hoặc `next_run_at` đã đổi) thì bỏ dấu vết chặn cũ
 * - tránh rò rỉ bộ nhớ, cùng lý do `threadChains` của `message-batcher.ts` phải
 * tự dọn: job bị xoá ĐÚNG lúc đang bị chặn sẽ để lại entry vĩnh viễn nếu chỉ
 * dọn ở nhánh "qua được preflight".
 */
function pruneStaleReasons(due: ScheduledJob[]): void {
  if (lastPreflightReason.size === 0) return;
  const dueIds = new Set(due.map((j) => j.id));
  for (const id of lastPreflightReason.keys()) {
    if (!dueIds.has(id)) lastPreflightReason.delete(id);
  }
}

function processDueJob(job: ScheduledJob, now: Date): void {
  try {
    // Kiểm phần RẺ (không tốn LLM, không chạm agent_turns) TRƯỚC clear-before-dispatch.
    // Chặn ở đây thì KHÔNG đụng next_run_at/run_count/enabled của job - tick
    // sau tự thử lại. Bất biến bắt buộc: "một lời nhắc chưa từng chạy thì
    // không bao giờ được coi là đã chạy" - account rớt phiên (ca hoàn toàn
    // bình thường của zca-js) đúng lúc job đến hạn không được phép giết job.
    const preflight = checkAccountAndThreadReady(job.accountId, job.threadId);
    if (!preflight.ok) {
      if (lastPreflightReason.get(job.id) !== preflight.reason) {
        lastPreflightReason.set(job.id, preflight.reason);
        log.warn({ jobId: job.id, reason: preflight.reason }, "Job chưa dispatch được - tick sau thử lại");
        markBlockedStmt.run(preflight.reason, job.id);
        // KHÔNG PHẢI vì gửi hỏng - đây là đường chặn PHỔ BIẾN nhất trong sản
        // xuất (account/thread chặn ngay ở tick). Thiếu dòng này: 3 lần gửi
        // hỏng CÁCH NHAU HÀNG TUẦN vẫn cộng dồn đủ 3, job 'once' bị tắt hẳn -
        // mất 1 lời nhắc dù chưa từng hỏng LIÊN TIẾP thật sự.
        resetDeliveryAttempts(job.id);
      }
      return;
    }
    lastPreflightReason.delete(job.id); // qua được rồi - xoá dấu vết lần chặn trước (nếu có)

    const schedule = scheduleOf(job, botTimeZone());
    // 'once' dùng `run_at` (mốc GỐC, không bao giờ bị ghi đè) để tính độ trễ +
    // nhãn "nhắc trễ" - `next_run_at` có thể đã bị trần ngày đẩy sang giờ khác
    // hoặc gửi-hỏng phục hồi, dùng nó sẽ MẤT nhãn cho job vừa bị hoãn cả đêm.
    // every/cron không có run_at (NULL) nên vẫn dùng next_run_at.
    const scheduledFor = schedule.kind === "once" ? job.runAt! : job.nextRunAt!;
    const action = decideDueAction(
      { schedule, nextRunAt: new Date(scheduledFor), onceGraceMinutes: getTuning("SCHEDULER_ONCE_GRACE_MINUTES") },
      now,
    );

    // Clear-before-dispatch: ghi next_run_at MỚI trước khi dispatch, để tick
    // kế không nhặt lại ĐÚNG job này trong lúc nó còn chạy dở. 'once' không có
    // "mốc kế" thật (computeNextRun trả nguyên runAtUtc CŨ bất kể `now`) nên
    // phải clear thẳng về NULL - để nguyên mốc cũ sẽ bị tick kế nhặt lại NGAY.
    const nextRunAt = schedule.kind === "once" ? null : computeNextRun(schedule, new Date(scheduledFor), now);
    setNextRun(job.id, nextRunAt);

    if (action === "skip-forward") {
      // Bỏ lượt HẲN: every/cron trễ quá grace, "chạy bù" sẽ dồn backlog. Ghi
      // 'skipped' NGAY để dashboard thấy vì sao mốc kế nhảy xa.
      const runId = openRun(job.id);
      finishRun(runId, { status: "skipped", detail: "Bỏ lượt vì đã trễ quá cửa sổ grace - dời sang lần kế tiếp." });
      log.info({ jobId: job.id, nextRunAt }, "Job trễ quá grace - bỏ lượt, dời lịch");
      resetDeliveryAttempts(job.id); // KHÔNG PHẢI vì gửi hỏng - chỉ every/cron chạm nhánh này
      return;
    }

    // Lọc SỚM trần ngày TRƯỚC dispatch (Mục 1) - THUẦN ĐỌC, không giữ chỗ
    // (giành chỗ THẬT xảy ra sát lúc gửi, xem blockedByGuard). Thiếu bước này
    // job chạm trần bị đốt lại nguyên 1 lượt LLM mỗi 30 giây tới hết ngày.
    const timeZone = job.timezone || botTimeZone();
    const cap = checkProactiveDailyCap(job.accountId, job.threadId, timeZone, now);
    if (!cap.ok) {
      // Không await (luật cứng của cả tick) - hàm này tự cam kết không bao
      // giờ ném lỗi ra ngoài (try/catch nội bộ, xem scheduled-job-cap-guard.ts).
      void concludeCapBlockedAtTick(job, cap.reason, cap.notifyCapHitOnce, timeZone, now);
      return;
    }

    // KHÔNG await: đúng luật cứng nhất của cả vòng tick (xem doc đầu file).
    // KHÔNG bọc runOnThreadChain ở đây - xem doc đầu file vì sao (deadlock).
    void runScheduledJob(job, { late: action === "run-late", scheduledFor });
  } catch (err) {
    // 1 job hỏng không được giết tick - các job KHÁC trong CÙNG tick vẫn phải
    // được xử lý tiếp (goclaw safeCheckJobs, cùng lý do với try/catch ở trên
    // nhưng ở mức TỪNG JOB thay vì cả tick).
    log.error({ jobId: job.id, err }, "Lỗi xử lý 1 job đến hạn - bỏ qua job này, tick vẫn tiếp tục");
  }
}
