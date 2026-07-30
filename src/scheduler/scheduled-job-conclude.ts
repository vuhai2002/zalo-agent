/**
 * Kết luận 1 lần chạy job: guard trước khi gửi (kèm nhắn đúng 1 câu khi lần
 * đầu chạm trần ngày), rồi chốt sổ (`scheduled_job_runs` + `scheduled_jobs`)
 * và ghi history phần đã gửi. Tách khỏi `run-scheduled-job.ts` để file đó
 * không vượt ngưỡng 200 dòng - đây thuần là phần "xong rồi thì làm gì".
 */

import { getTuning } from "../config/runtime-tuning-settings.js";
import { appendMessage } from "../conversation/history-store.js";
import { createLogger } from "../shared/logger.js";
import { sendReplyInParts, type ReplyTarget } from "../zalo/send-reply-in-parts.js";
import { finishRun, type FinishRunParams } from "./job-run-log-store.js";
import {
  checkProactiveSendGuard,
  deliverProactively,
  markProactiveCapNotified,
  recordProactiveSend,
} from "./proactive-send-guard.js";
import { markRun, setNextRun, type ScheduledJob } from "./scheduled-job-store.js";

const log = createLogger("run-scheduled-job");

/**
 * Job KHÔNG được gửi vì lý do NGOÀI Ý MUỐN của chính nó (account rớt phiên,
 * thread bị tắt, chạm trần ngày) - job CHƯA TỪNG CHẠY THẬT SỰ nên KHÔNG được
 * `markRun` (không đụng `run_count`/`enabled` - bất biến bắt buộc: "một lời
 * nhắc chưa từng gửi được thì không bao giờ được coi là đã chạy"). Job
 * `once` còn cần phục hồi `next_run_at` (`scheduler-loop.ts` đã set NULL
 * trước khi dispatch tới đây, vì `once` không có "lần kế" tự nhiên) - không
 * phục hồi thì job "kẹt": `enabled=1` nhưng vĩnh viễn không còn `next_run_at`
 * nào để mà tick sau nhặt lại.
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
 * Kiểm guard (trần ngày - account/thread đã được kiểm NGAY TRONG TICK trước
 * khi tới đây, xem `scheduler-loop.ts`; guard vẫn tự kiểm lại cả 2 điều đó
 * cho FRESH nhất, phòng account rớt phiên giữa lúc lượt agent đang chạy).
 * Chặn thì tự lo hết: nhắn cảnh báo trần đúng 1 lần nếu là lần đầu chạm, kết
 * luận run 'skipped' KHÔNG đụng run_count/next_run_at của job. Trả `true`
 * nghĩa là caller phải dừng lại, không gửi gì thêm.
 */
export async function blockedByGuard(
  job: ScheduledJob,
  target: ReplyTarget,
  runId: number,
  timeZone: string,
  scheduledFor: string,
  turnId?: number,
): Promise<boolean> {
  const guard = checkProactiveSendGuard(job.accountId, job.threadId, timeZone);
  if (guard.ok) return false;

  if (guard.notifyCapHitOnce) {
    const notified = await sendCapNotice(job, target, timeZone);
    if (notified) markProactiveCapNotified(job.accountId, job.threadId, timeZone);
  }

  concludeBlockedNotRun(job, runId, guard.reason, scheduledFor, turnId);
  return true;
}

/**
 * Gửi + ghi history + đếm trần + chốt run - MỘT bước, đi qua
 * `deliverProactively` (chờ lượt hàng đợi toàn cục TRƯỚC, vào xâu thread SAU -
 * xem lý do ở `proactive-send-guard.ts`). Gửi VÀ ghi history nằm CHUNG 1 `fn`
 * truyền cho `deliverProactively` để cả 2 cùng nằm trong đúng 1 lần giữ khoá
 * thread - tách rời sẽ mở lại đúng khe hở đã sửa (tin thật chen giữa lúc gửi
 * xong và lúc kịp ghi history).
 */
export async function sendAndConclude(
  job: ScheduledJob,
  target: ReplyTarget,
  runId: number,
  timeZone: string,
  text: string,
  turnId?: number,
): Promise<void> {
  const reply = await deliverProactively(target.threadKey, async () => {
    const r = await sendReplyInParts(target, text);
    if (r.deliveredText) {
      appendMessage(job.accountId, job.threadId, { role: "assistant", content: r.deliveredText });
    }
    return r;
  });

  // Chỉ tin ĐÃ gửi được mới tính vào trần ngày, đếm theo SỐ TIN thật sự ra
  // (reply.sentParts) - 1 câu trả lời dài có thể bị cắt thành nhiều tin.
  if (reply.deliveredText) {
    recordProactiveSend(job.accountId, job.threadId, timeZone, reply.sentParts);
  }

  if (reply.error) {
    const message = reply.error instanceof Error ? reply.error.message : String(reply.error);
    conclude(job, runId, { status: "error", turnId, detail: message, deliveredChars: reply.deliveredText.length });
    return;
  }

  conclude(job, runId, { status: "ok", turnId, detail: "Đã gửi.", deliveredChars: reply.deliveredText.length });
}

/** Chốt CẢ 2 nơi: sổ chạy (`scheduled_job_runs`) và tóm tắt trên job (`last_status`, `run_count`) - dùng khi job THỰC SỰ đã chạy (ok/error/silent) */
export function conclude(job: ScheduledJob, runId: number, params: FinishRunParams): void {
  finishRun(runId, params);
  markRun(job.id, params.status, params.status === "error" ? (params.detail ?? "Lỗi không rõ nguyên nhân.") : null);
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
