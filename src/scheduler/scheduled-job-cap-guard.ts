/**
 * Xử lý riêng cho lượt bị TRẦN NGÀY chặn - khác các lý do "chưa sẵn sàng"
 * khác (account/thread, xem `concludeBlockedNotRun` ở `scheduled-job-conclude.ts`)
 * ở chỗ 'once' KHÔNG được lùi `next_run_at` về mốc đã qua (tick sau lại chạm
 * trần y hệt, đúng vòng lặp đốt LLM mỗi 30s đã sửa ở đây): phải đẩy sang giờ
 * CẤU HÌNH ĐƯỢC (`SCHEDULER_DEFERRED_RUN_HOUR`) của NGÀY MAI, khớp đúng câu
 * thông báo bot vừa gửi "các lịch còn lại sẽ tiếp tục vào ngày mai". Tách khỏi
 * `scheduled-job-conclude.ts` để file đó không vượt ngưỡng 200 dòng - đây
 * thuần là nhánh "trần ngày" của kết luận 1 lượt.
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
import { deferredRunAtUtc } from "../shared/zone-time.js";
import { getRunningAccountApi } from "../zalo/account-manager.js";
import { sendReplyInParts, type ReplyTarget } from "../zalo/send-reply-in-parts.js";
import { resetDeliveryAttempts } from "./delivery-attempt-store.js";
import { finishRun, openRun } from "./job-run-log-store.js";
import { recordProactiveSend, reserveCapNotice, revertCapNotice } from "./proactive-send-guard.js";
import { deliverProactively } from "./proactive-send-queue.js";
import { setNextRun, type ScheduledJob } from "./scheduled-job-store.js";

const log = createLogger("run-scheduled-job");

/**
 * Kết luận 1 lượt bị chặn vì CHẠM TRẦN NGÀY, đã có `runId` (đã `openRun`)
 * sẵn. `every`/`cron` không đụng `next_run_at` - `scheduler-loop.ts` đã tính
 * đúng mốc kế tự nhiên của chính lịch đó trước khi tới đây. Reset
 * `delivery_attempts`: lượt này kết thúc KHÔNG PHẢI vì gửi hỏng (chưa từng
 * thử gửi payload thật) - không được để chuỗi gửi hỏng của các lần khác cộng
 * dồn qua lượt bị chặn vì trần này.
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
    setNextRun(job.id, deferredRunAtUtc(timeZone, getTuning("SCHEDULER_DEFERRED_RUN_HOUR"), now));
  }
  finishRun(runId, { status: "skipped", detail: reason, turnId: opts.turnId });
  resetDeliveryAttempts(job.id);

  if (opts.notifyCapHitOnce && opts.target) {
    await notifyCapHit(job, opts.target, timeZone, now);
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

/**
 * Giành QUYỀN gửi thông báo NGUYÊN TỬ trước (`reserveCapNotice`) rồi mới thật
 * sự gửi - đây là điểm chặn race N job cùng thread cùng bị chặn trong CÙNG 1
 * tick (trước fix: quyết định "có phải lần đầu chạm trần" đọc TỪ TRƯỚC lúc
 * gửi, mà đường gửi phải chờ `SCHEDULER_SEND_GAP_MS`, nên N job đều tưởng
 * mình là lần đầu). Gửi hỏng thì `revertCapNotice` trả quyền lại.
 *
 * Nhận `now` từ `concludeCapBlocked` (không tự `new Date()`): reserve/revert
 * phải cùng `day_key` với chính lượt đang xử lý - sát nửa đêm, tự lấy giờ
 * thật ở đây có thể lệch sang ngày MAI so với `now` caller đang cầm, ghi "đã
 * báo" nhầm ngày khiến hôm sau chạm trần thật lại không có thông báo nào.
 */
async function notifyCapHit(job: ScheduledJob, target: ReplyTarget, timeZone: string, now: Date): Promise<void> {
  if (!reserveCapNotice(job.accountId, job.threadId, timeZone, now)) return; // job/tick khác đã giành hoặc đã gửi rồi
  const notified = await sendCapNotice(job, target, timeZone, now);
  if (!notified) revertCapNotice(job.accountId, job.threadId, timeZone, now);
}

/** Nhắn ĐÚNG 1 câu khi lần đầu chạm trần ngày. Trả `true` khi thật sự gửi được - caller chỉ giữ quyền "đã báo" khi đó */
async function sendCapNotice(job: ScheduledJob, target: ReplyTarget, timeZone: string, now: Date): Promise<boolean> {
  try {
    const max = getTuning("SCHEDULER_MAX_PROACTIVE_PER_DAY");
    const text = `Hôm nay cuộc trò chuyện này đã nhận đủ ${max} tin nhắc/báo cáo chủ động, mình tạm dừng để tránh làm phiền - các lịch còn lại sẽ tiếp tục vào ngày mai.`;

    const reply = await deliverProactively(target.threadKey, async () => {
      const r = await sendReplyInParts(target, text);
      if (r.deliveredText) {
        try {
          appendMessage(job.accountId, job.threadId, { role: "assistant", content: r.deliveredText });
        } catch (err) {
          // Thông báo ĐÃ RA Zalo thật - ghi history hỏng KHÔNG được phép biến
          // "đã gửi" thành "chưa gửi" (cùng lỗi Mục 2): throw ở đây sẽ làm
          // outer catch bên dưới trả false -> revertCapNotice -> job/tick sau
          // gửi LẶP LẠI đúng câu thông báo dù lần này đã ra thật.
          log.error({ err, jobId: job.id }, "Ghi history thông báo chạm trần sau khi gửi thành công bị lỗi - vẫn coi là ĐÃ GỬI");
        }
      }
      return r;
    });

    if (reply.deliveredText) {
      recordProactiveSend(job.accountId, job.threadId, timeZone, reply.sentParts, now);
    }
    // CHỈ xét đã ra được hay chưa (`deliveredText`) - KHÔNG xét `reply.error`
    // nữa (Mục 3, vòng 4): thông báo có thể đã RA THẬT rồi mới hỏng ở bước
    // ghi history (gắn vào reply.error, xem nhánh catch của appendMessage ở
    // trên) - trả `false` ở ca đó sẽ làm caller `revertCapNotice`, và tick sau
    // GỬI LẶP LẠI đúng câu thông báo dù lần này đã tới nơi. Cùng lớp lỗi vừa
    // đóng ở `scheduled-job-send.ts` (Mục 2).
    return Boolean(reply.deliveredText);
  } catch (err) {
    log.error({ err }, "Gửi thông báo chạm trần thất bại - bỏ qua, không chặn việc ghi run skipped");
    return false;
  }
}
