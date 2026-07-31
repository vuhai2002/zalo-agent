/**
 * Kết luận CHUNG cho 1 lần chạy job: bất biến "chưa từng gửi thì không được
 * coi là đã chạy" (Finding 1) và cơ chế thử lại tối đa `MAX_DELIVERY_ATTEMPTS`
 * lần khi gửi hỏng. Phần "gửi thật + guard trước khi gửi" tách sang
 * `scheduled-job-send.ts` (đủ lớn để tách riêng, tránh file này vượt 200 dòng)
 * - 2 file cùng thao tác trên `scheduled_job_runs`/`scheduled_jobs`, chỉ khác
 * NƠI gọi (trước khi có gì gửi thật, hay sau khi đã cố gửi).
 */

import { resetDeliveryAttempts, incrementDeliveryAttempts, MAX_DELIVERY_ATTEMPTS } from "./delivery-attempt-store.js";
import { finishRun, type FinishRunParams } from "./job-run-log-store.js";
import { markRun, setNextRun, type ScheduledJob } from "./scheduled-job-store.js";

/**
 * Job KHÔNG được gửi vì lý do NGOÀI Ý MUỐN của chính nó (account rớt phiên,
 * thread bị tắt) - job CHƯA TỪNG CHẠY THẬT SỰ nên KHÔNG được `markRun`. Job
 * `once` còn cần phục hồi `next_run_at` về ĐÚNG `scheduledFor` cũ (thử lại
 * NGAY tick sau - khác lý do TRẦN NGÀY, xem `scheduled-job-cap-guard.ts`).
 * Reset `delivery_attempts`: lượt này kết thúc KHÔNG PHẢI vì gửi hỏng.
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
  resetDeliveryAttempts(job.id);
}

/**
 * Chốt CẢ 2 nơi: sổ chạy (`scheduled_job_runs`) và tóm tắt trên job. Reset
 * `delivery_attempts`: lượt này đã THẬT SỰ kết thúc, đứt chuỗi gửi hỏng LIÊN
 * TIẾP - không cộng dồn qua các lượt thành công/im lặng xen giữa (Mục 4, vòng 3).
 */
export function conclude(job: ScheduledJob, runId: number, params: FinishRunParams): void {
  finishRun(runId, params);
  markRun(job.id, params.status, params.status === "error" ? (params.detail ?? "Lỗi không rõ nguyên nhân.") : null);
  resetDeliveryAttempts(job.id);
}

/**
 * CHƯA gửi được GÌ (mạng hỏng, lượt agent ném lỗi giữa chừng, hay lỗi bất ngờ
 * ở tầng ngoài cùng của `runScheduledJob`) - bất biến "chưa từng gửi thì
 * không được coi là đã chạy" (Finding 1). Đếm vào `delivery_attempts` thay vì
 * `markRun` ngay: rớt mạng 1 lần không được giết job, nhưng cũng không được
 * thử lại VÔ HẠN. Chạm `MAX_DELIVERY_ATTEMPTS` mới thật sự tiêu suất chạy.
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
    // thử lại NGAY. every/cron đã có mốc kế đúng nhịp riêng - không đụng vào.
    if (job.scheduleKind === "once") setNextRun(job.id, scheduledFor);
    finishRun(runId, { status: "error", detail: `${message} (thử lại lần ${attempts}/${MAX_DELIVERY_ATTEMPTS})`, turnId });
    return;
  }

  conclude(job, runId, { status: "error", turnId, detail: `${message} (đã thử ${MAX_DELIVERY_ATTEMPTS} lần liên tiếp, dừng)` });
}
