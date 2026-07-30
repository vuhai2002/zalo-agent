/**
 * Xử lý riêng cho lượt bị TRẦN NGÀY chặn - khác các lý do "chưa sẵn sàng"
 * khác (account/thread, xem `concludeBlockedNotRun` ở `scheduled-job-conclude.ts`)
 * ở chỗ 'once' KHÔNG được lùi `next_run_at` về mốc đã qua (tick sau lại chạm
 * trần y hệt, đúng vòng lặp đốt LLM mỗi 30s đã sửa ở đây): phải đẩy hẳn sang
 * ĐẦU NGÀY VN KẾ TIẾP, khớp đúng câu thông báo bot vừa gửi "các lịch còn lại
 * sẽ tiếp tục vào ngày mai". Tách khỏi `scheduled-job-conclude.ts` để file đó
 * không vượt ngưỡng 200 dòng - đây thuần là nhánh "trần ngày" của kết luận 1 lượt.
 *
 * 2 điểm gọi:
 * - `concludeCapBlocked`: đã có `runId`/`target` sẵn (từ `blockedByGuard` lúc
 *   dispatch - giành chỗ NGUYÊN TỬ đã thất bại ở đó).
 * - `concludeCapBlockedAtTick`: gọi TRƯỚC dispatch (`scheduler-loop.ts`, lọc
 *   sớm THUẦN ĐỌC) - chưa có gì sẵn, phải tự mở run + tự resolve api.
 */

import type { API, ThreadType } from "zca-js";
import { getTuning } from "../config/runtime-tuning-settings.js";
import { appendMessage } from "../conversation/history-store.js";
import { createLogger } from "../shared/logger.js";
import { startOfNextDayUtc } from "../shared/zone-time.js";
import { getRunningAccountApi } from "../zalo/account-manager.js";
import { sendReplyInParts, type ReplyTarget } from "../zalo/send-reply-in-parts.js";
import { finishRun, openRun } from "./job-run-log-store.js";
import { markProactiveCapNotified, recordProactiveSend } from "./proactive-send-guard.js";
import { deliverProactively } from "./proactive-send-queue.js";
import { setNextRun, type ScheduledJob } from "./scheduled-job-store.js";

const log = createLogger("run-scheduled-job");

/**
 * Kết luận 1 lượt bị chặn vì CHẠM TRẦN NGÀY, đã có `runId` (đã `openRun`)
 * sẵn. `every`/`cron` không đụng `next_run_at` - `scheduler-loop.ts` đã tính
 * đúng mốc kế tự nhiên của chính lịch đó trước khi tới đây.
 */
export async function concludeCapBlocked(
  job: ScheduledJob,
  runId: number,
  reason: string,
  timeZone: string,
  now: Date,
  opts: { notifyCapHitOnce: boolean; target?: ReplyTarget; turnId?: number },
): Promise<void> {
  if (job.scheduleKind === "once") {
    setNextRun(job.id, startOfNextDayUtc(timeZone, now));
  }
  finishRun(runId, { status: "skipped", detail: reason, turnId: opts.turnId });

  if (opts.notifyCapHitOnce && opts.target) {
    await notifyCapHit(job, opts.target, timeZone);
  }
}

/**
 * Bản dùng ở TICK, TRƯỚC dispatch (`scheduler-loop.ts`) - chưa có `runId`
 * (chưa `openRun`) lẫn `target` (chưa resolve `api`) như lúc dispatch, tự lo
 * cả 2. KHÔNG BAO GIỜ ném lỗi ra ngoài: bị gọi KHÔNG AWAIT từ tick, đúng luật
 * cứng của cả vòng tick (xem `scheduler-loop.ts`).
 */
export async function concludeCapBlockedAtTick(
  job: ScheduledJob,
  reason: string,
  notifyCapHitOnce: boolean,
  timeZone: string,
  now: Date,
): Promise<void> {
  try {
    const runId = openRun(job.id);
    const api = notifyCapHitOnce ? getRunningAccountApi(job.accountId) : undefined;
    const target = toTarget(job, api);
    await concludeCapBlocked(job, runId, reason, timeZone, now, { notifyCapHitOnce: Boolean(target), target });
  } catch (err) {
    log.error({ jobId: job.id, err }, "Lỗi kết luận job bị chặn ở trần ngày ngay tại tick");
  }
}

function toTarget(job: ScheduledJob, api: API | undefined): ReplyTarget | undefined {
  if (!api) return undefined;
  return {
    api,
    threadKey: `${job.accountId}:${job.threadId}`,
    threadId: job.threadId,
    threadType: job.threadType as ThreadType,
  };
}

async function notifyCapHit(job: ScheduledJob, target: ReplyTarget, timeZone: string): Promise<void> {
  const notified = await sendCapNotice(job, target, timeZone);
  if (notified) markProactiveCapNotified(job.accountId, job.threadId, timeZone);
}

/** Nhắn ĐÚNG 1 câu khi lần đầu chạm trần ngày. Trả `true` khi thật sự gửi được - caller chỉ đánh dấu "đã báo" khi đó */
async function sendCapNotice(job: ScheduledJob, target: ReplyTarget, timeZone: string): Promise<boolean> {
  try {
    const max = getTuning("SCHEDULER_MAX_PROACTIVE_PER_DAY");
    const text = `Hôm nay cuộc trò chuyện này đã nhận đủ ${max} tin nhắc/báo cáo chủ động, mình tạm dừng để tránh làm phiền - các lịch còn lại sẽ tiếp tục vào ngày mai.`;

    const reply = await deliverProactively(target.threadKey, async () => {
      const r = await sendReplyInParts(target, text);
      if (r.deliveredText) {
        appendMessage(job.accountId, job.threadId, { role: "assistant", content: r.deliveredText });
      }
      return r;
    });

    if (reply.deliveredText) {
      recordProactiveSend(job.accountId, job.threadId, timeZone, reply.sentParts);
    }
    return Boolean(reply.deliveredText) && !reply.error;
  } catch (err) {
    log.error({ err }, "Gửi thông báo chạm trần thất bại - bỏ qua, không chặn việc ghi run skipped");
    return false;
  }
}
