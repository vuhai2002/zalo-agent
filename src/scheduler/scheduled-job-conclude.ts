/**
 * Kết luận 1 lần chạy job: guard trước khi gửi (kèm nhắn đúng 1 câu khi lần
 * đầu chạm trần ngày), rồi chốt sổ (`scheduled_job_runs` + `scheduled_jobs`)
 * và ghi history phần đã gửi. Tách khỏi `run-scheduled-job.ts` để file đó
 * không vượt ngưỡng 200 dòng - đây thuần là phần "xong rồi thì làm gì".
 */

import { getTuning } from "../config/runtime-tuning-settings.js";
import { appendMessage } from "../conversation/history-store.js";
import { createLogger } from "../shared/logger.js";
import { sendReplyInParts, type ReplyResult, type ReplyTarget } from "../zalo/send-reply-in-parts.js";
import { finishRun, type FinishRunParams } from "./job-run-log-store.js";
import { checkProactiveSendGuard, enqueueProactiveSend, recordProactiveSend } from "./proactive-send-guard.js";
import { markRun, type ScheduledJob } from "./scheduled-job-store.js";

const log = createLogger("run-scheduled-job");

/**
 * Kiểm guard, và nếu bị chặn thì tự lo hết phần còn lại (nhắn cảnh báo trần
 * đúng 1 lần nếu là lần đầu chạm, kết luận run 'skipped'). Trả `true` nghĩa là
 * caller phải dừng lại, không gửi gì thêm. Dùng chung cho cả kind='message' và
 * kind='agent' vì cùng một guard, chỉ khác chỗ gọi (trước LLM hay sau khi có text).
 */
export async function blockedByGuard(
  job: ScheduledJob,
  target: ReplyTarget,
  runId: number,
  timeZone: string,
  turnId?: number,
): Promise<boolean> {
  const guard = checkProactiveSendGuard(job.accountId, job.threadId, timeZone);
  if (guard.ok) return false;
  if (guard.notifyCapHitOnce) await sendCapNotice(target);
  conclude(job, runId, { status: "skipped", turnId, detail: guard.reason });
  return true;
}

/** Ghi history (nếu gửi được gì) + đếm vào trần ngày + chốt run - dùng chung cho cả 2 nhánh kind */
export function finishSend(
  job: ScheduledJob,
  runId: number,
  timeZone: string,
  reply: ReplyResult,
  turnId?: number,
): void {
  // Chỉ ghi phần ĐÃ gửi được: history phải khớp với cái người dùng nhìn thấy
  // (đúng nếp message-turn-processor.ts) - và chỉ tin ĐÃ gửi mới tính vào trần ngày.
  if (reply.deliveredText) {
    appendMessage(job.accountId, job.threadId, { role: "assistant", content: reply.deliveredText });
    recordProactiveSend(job.accountId, job.threadId, timeZone);
  }

  if (reply.error) {
    const message = reply.error instanceof Error ? reply.error.message : String(reply.error);
    conclude(job, runId, { status: "error", turnId, detail: message, deliveredChars: reply.deliveredText.length });
    return;
  }

  conclude(job, runId, { status: "ok", turnId, detail: "Đã gửi.", deliveredChars: reply.deliveredText.length });
}

/** Chốt CẢ 2 nơi: sổ chạy (`scheduled_job_runs`) và tóm tắt trên job (`last_status`, `run_count`) */
export function conclude(job: ScheduledJob, runId: number, params: FinishRunParams): void {
  finishRun(runId, params);
  markRun(job.id, params.status, params.status === "error" ? (params.detail ?? "Lỗi không rõ nguyên nhân.") : null);
}

/** Nhắn ĐÚNG 1 câu khi lần đầu chạm trần ngày - tự nuốt lỗi, đây đã là đường cứu cánh */
async function sendCapNotice(target: ReplyTarget): Promise<void> {
  try {
    const max = getTuning("SCHEDULER_MAX_PROACTIVE_PER_DAY");
    await enqueueProactiveSend(() =>
      sendReplyInParts(
        target,
        `Hôm nay cuộc trò chuyện này đã nhận đủ ${max} tin nhắc/báo cáo chủ động, mình tạm dừng để tránh làm phiền - các lịch còn lại sẽ tiếp tục vào ngày mai.`,
      ),
    );
  } catch (err) {
    log.error({ err }, "Gửi thông báo chạm trần thất bại - bỏ qua, không chặn việc ghi run skipped");
  }
}
