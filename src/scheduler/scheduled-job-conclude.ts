/**
 * Kết luận 1 lần chạy job: guard trước khi gửi (giành 1 suất trần ngày NGUYÊN
 * TỬ), rồi chốt sổ (`scheduled_job_runs` + `scheduled_jobs`) và ghi history
 * phần đã gửi. Nhánh "bị chặn vì trần ngày" tách sang
 * `scheduled-job-cap-guard.ts` (cần đẩy `next_run_at` khác hẳn các lý do
 * chặn khác) - file này giữ phần CHUNG: guard account/thread, gửi thật, và
 * đếm số lần gửi hỏng liên tiếp (`delivery_attempts`).
 */

import { appendMessage } from "../conversation/history-store.js";
import { sendReplyInParts, type ReplyTarget } from "../zalo/send-reply-in-parts.js";
import { incrementDeliveryAttempts, MAX_DELIVERY_ATTEMPTS, resetDeliveryAttempts } from "./delivery-attempt-store.js";
import { finishRun, type FinishRunParams } from "./job-run-log-store.js";
import {
  checkAccountAndThreadReady,
  recordProactiveSend,
  refundProactiveSlot,
  reserveProactiveSlot,
} from "./proactive-send-guard.js";
import { deliverProactively } from "./proactive-send-queue.js";
import { concludeCapBlocked } from "./scheduled-job-cap-guard.js";
import { markRun, setNextRun, type ScheduledJob } from "./scheduled-job-store.js";

/**
 * Job KHÔNG được gửi vì lý do NGOÀI Ý MUỐN của chính nó (account rớt phiên,
 * thread bị tắt) - job CHƯA TỪNG CHẠY THẬT SỰ nên KHÔNG được `markRun` (không
 * đụng `run_count`/`enabled` - bất biến bắt buộc: "một lời nhắc chưa từng gửi
 * được thì không bao giờ được coi là đã chạy"). Job `once` còn cần phục hồi
 * `next_run_at` về ĐÚNG `scheduledFor` cũ (thử lại NGAY tick sau - khác lý do
 * TRẦN NGÀY, xem `scheduled-job-cap-guard.ts`: account/thread thường là sự
 * cố TẠM THỜI, còn trần ngày thì thử lại trong ngày vẫn chạm y hệt).
 */
export function concludeBlockedNotRun(
  job: ScheduledJob,
  runId: number,
  reason: string,
  scheduledFor: string,
  turnId?: number,
): void {
  if (job.scheduleKind === "once") {
    setNextRun(job.id, scheduledFor);
  }
  finishRun(runId, { status: "skipped", detail: reason, turnId });
}

/**
 * Kiểm guard NGAY TRƯỚC LÚC GỬI: account/thread recheck FRESH (đã kiểm ở
 * `scheduler-loop.ts` trước clear-before-dispatch, nhưng lượt agent có thể
 * chạy dài - re-check ở đây phòng account rớt phiên/thread bị tắt GIỮA lúc
 * đang chạy) + GIÀNH 1 suất trần ngày NGUYÊN TỬ (`reserveProactiveSlot` - xem
 * doc ở đó vì sao khác lần lọc sớm ở tick).
 *
 * Chặn thì tự lo hết rồi trả `true` - caller dừng lại, không gửi gì thêm. Trả
 * `false` nghĩa là ĐÃ GIÀNH ĐƯỢC 1 suất - caller BẮT BUỘC gọi `sendAndConclude`
 * ngay sau, hàm đó tự hoàn/cộng thêm suất tuỳ kết quả gửi thật.
 */
export async function blockedByGuard(
  job: ScheduledJob,
  target: ReplyTarget,
  runId: number,
  timeZone: string,
  scheduledFor: string,
  turnId?: number,
): Promise<boolean> {
  const fresh = checkAccountAndThreadReady(job.accountId, job.threadId);
  if (!fresh.ok) {
    concludeBlockedNotRun(job, runId, fresh.reason, scheduledFor, turnId);
    return true;
  }

  const slot = reserveProactiveSlot(job.accountId, job.threadId, timeZone);
  if (!slot.ok) {
    await concludeCapBlocked(job, runId, slot.reason, timeZone, new Date(), {
      notifyCapHitOnce: slot.notifyCapHitOnce,
      target,
      turnId,
    });
    return true;
  }

  return false;
}

/**
 * Gửi + ghi history + đếm trần + chốt run - MỘT bước, đi qua
 * `deliverProactively`. BẮT BUỘC gọi SAU khi `blockedByGuard` trả `false` (đã
 * giành 1 suất trần).
 *
 * Gửi được (dù chỉ 1 phần) thì suất đã giành coi là DÙNG - cộng thêm phần CÒN
 * LẠI nếu `sentParts` > 1, rồi reset `delivery_attempts` (lượt này CÓ chạy
 * thật). KHÔNG gửi được GÌ thì hoàn lại suất đã giành rồi tính vào
 * `delivery_attempts` (`concludeDeliveryFailed`) - trần chỉ đếm tin THẬT ra
 * được, và gửi hỏng không được phép giết job ngay (Finding 1).
 */
export async function sendAndConclude(
  job: ScheduledJob,
  target: ReplyTarget,
  runId: number,
  timeZone: string,
  text: string,
  scheduledFor: string,
  turnId?: number,
): Promise<void> {
  const reply = await deliverProactively(target.threadKey, async () => {
    const r = await sendReplyInParts(target, text);
    if (r.deliveredText) {
      appendMessage(job.accountId, job.threadId, { role: "assistant", content: r.deliveredText });
    }
    return r;
  });

  if (!reply.deliveredText) {
    refundProactiveSlot(job.accountId, job.threadId, timeZone);
    concludeDeliveryFailed(job, runId, scheduledFor, errorText(reply.error) ?? "Gửi thất bại không rõ nguyên nhân.", turnId);
    return;
  }

  if (reply.sentParts > 1) {
    recordProactiveSend(job.accountId, job.threadId, timeZone, reply.sentParts - 1);
  }
  resetDeliveryAttempts(job.id);

  if (reply.error) {
    conclude(job, runId, {
      status: "error",
      turnId,
      detail: errorText(reply.error) ?? "Lỗi không rõ nguyên nhân.",
      deliveredChars: reply.deliveredText.length,
    });
    return;
  }

  conclude(job, runId, { status: "ok", turnId, detail: "Đã gửi.", deliveredChars: reply.deliveredText.length });
}

/** Chốt CẢ 2 nơi: sổ chạy (`scheduled_job_runs`) và tóm tắt trên job (`last_status`, `run_count`) - dùng khi job THỰC SỰ đã chạy (ok/error/silent) */
export function conclude(job: ScheduledJob, runId: number, params: FinishRunParams): void {
  finishRun(runId, params);
  markRun(job.id, params.status, params.status === "error" ? (params.detail ?? "Lỗi không rõ nguyên nhân.") : null);
}

/**
 * CHƯA gửi được GÌ (mạng hỏng, lượt agent ném lỗi giữa chừng, hay lỗi bất ngờ
 * ở tầng ngoài cùng của `runScheduledJob`) - 3 đường mà bất biến "chưa từng
 * gửi thì không được coi là đã chạy" từng bị vỡ (Finding 1). Đếm vào cột bền
 * `delivery_attempts` thay vì `markRun` ngay: rớt mạng 1 lần không được phép
 * giết job, nhưng cũng không được thử lại VÔ HẠN (rơi lại đúng vòng lặp đốt
 * LLM mỗi tick). Chạm `MAX_DELIVERY_ATTEMPTS` mới thật sự tiêu suất chạy +
 * ghi 'error' cho dashboard thấy.
 */
export function concludeDeliveryFailed(
  job: ScheduledJob,
  runId: number,
  scheduledFor: string,
  message: string,
  turnId?: number,
): void {
  const attempts = incrementDeliveryAttempts(job.id);

  if (attempts < MAX_DELIVERY_ATTEMPTS) {
    // 'once' không có mốc kế tự nhiên - phục hồi về scheduledFor để tick sau
    // thử lại NGAY. every/cron đã có mốc kế đúng nhịp riêng của nó (đặt bởi
    // clear-before-dispatch trước khi dispatch tới đây) - không đụng vào.
    if (job.scheduleKind === "once") setNextRun(job.id, scheduledFor);
    finishRun(runId, { status: "error", detail: `${message} (thử lại lần ${attempts}/${MAX_DELIVERY_ATTEMPTS})`, turnId });
    return;
  }

  resetDeliveryAttempts(job.id);
  conclude(job, runId, { status: "error", turnId, detail: `${message} (đã thử ${MAX_DELIVERY_ATTEMPTS} lần liên tiếp, dừng)` });
}

function errorText(err: unknown): string | undefined {
  if (err === undefined) return undefined;
  return err instanceof Error ? err.message : String(err);
}
