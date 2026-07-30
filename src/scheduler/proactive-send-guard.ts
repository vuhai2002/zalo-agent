/**
 * Guardrail trước MỌI lần gửi CHỦ ĐỘNG của scheduler (không phải trả lời tin
 * tới): account đang chạy -> thread còn hợp lệ (tồn tại trong bảng `threads`
 * VÀ `bot_enabled = 1`) -> chưa chạm trần ngày (đếm THEO TIN, bền qua restart
 * - xem `proactive-send-counter-store.ts`). Hỏng bất kỳ điều nào thì trả lý
 * do dạng chữ để ghi vào `scheduled_job_runs.detail`.
 *
 * Kèm hàng đợi rải đều TOÀN CỤC (`SCHEDULER_SEND_GAP_MS`) - khác
 * `middleware/rate-limiter.ts` hiện có vốn chỉ xếp hàng TRONG một thread.
 */

import { getTuning } from "../config/runtime-tuning-settings.js";
import { findThreadStatus } from "../conversation/thread-store.js";
import { todayKey } from "../shared/zone-time.js";
import { isAccountRunning } from "../zalo/account-manager.js";
import {
  addProactiveSendCount,
  getProactiveCounter,
  markProactiveCapNoticeSent,
  resetAllProactiveCounters,
} from "./proactive-send-counter-store.js";

// Hàng đợi rải đều toàn cục nằm ở file riêng (proactive-send-queue.ts) - re-export
// để mọi nơi vẫn import qua "proactive-send-guard.js" như trước, không phải sửa call site.
export {
  deliverProactively,
  enqueueProactiveSend,
  resetProactiveSendQueue,
  setQueueElementTimeoutForTest,
} from "./proactive-send-queue.js";

/** Chữ dùng chung với pre-flight của scheduler-loop.ts/run-scheduled-job.ts - cùng 1 điều kiện, cùng 1 câu */
export const ACCOUNT_NOT_RUNNING_REASON = "Account hiện không chạy (chưa đăng nhập hoặc bị dừng).";

export type PreflightResult = { ok: true } | { ok: false; reason: string };

/**
 * Phần KHÔNG phụ thuộc nội dung của guard - account đang chạy + thread hợp
 * lệ. Tách riêng để `scheduler-loop.ts` kiểm được NGAY TRONG TICK, TRƯỚC khi
 * clear-before-dispatch: job chặn ở đây thì tick chưa hề đụng vào
 * `next_run_at`/`run_count` của nó, tick sau tự thử lại - job không "chết"
 * chỉ vì account rớt phiên đúng lúc đến hạn (ca hoàn toàn bình thường của
 * zca-js, không phải sự cố hiếm).
 */
export function checkAccountAndThreadReady(accountId: string, threadId: string): PreflightResult {
  if (!isAccountRunning(accountId)) {
    return { ok: false, reason: ACCOUNT_NOT_RUNNING_REASON };
  }
  const thread = findThreadStatus(accountId, threadId);
  if (!thread) {
    return { ok: false, reason: "Cuộc trò chuyện chưa từng ghi nhận trong hệ thống - không nhắn chủ động được." };
  }
  if (!thread.botEnabled) {
    return { ok: false, reason: "Bot đang tắt cho cuộc trò chuyện này." };
  }
  return { ok: true };
}

export type GuardResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      /**
       * true nghĩa là CHƯA báo trần hôm nay - caller (đã thật sự gửi được
       * thông báo) phải tự gọi `markProactiveCapNotified` sau khi gửi xong.
       * Hàm "check" này THUẦN ĐỌC, không tự ghi gì - trang "Chạy thử ngay"
       * (phase 05) có thể gọi kiểm rồi không gửi, tự ghi ở đây sẽ làm mất
       * thông báo thật của lần chạm trần kế tiếp trong cùng ngày.
       */
      notifyCapHitOnce: boolean;
    };

/** Số ngày giữ lại bộ đếm - trần chỉ cần biết ĐÚNG HÔM NAY nên không cần giữ lâu */
const COUNTER_RETENTION_DAYS = 3;

function keepSinceDayKey(timeZone: string, now: Date): string {
  const cutoff = new Date(now.getTime() - COUNTER_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  return todayKey(timeZone, cutoff);
}

export function checkProactiveSendGuard(
  accountId: string,
  threadId: string,
  timeZone: string,
  now: Date = new Date(),
): GuardResult {
  const preflight = checkAccountAndThreadReady(accountId, threadId);
  if (!preflight.ok) return { ok: false, reason: preflight.reason, notifyCapHitOnce: false };

  const dayKey = todayKey(timeZone, now);
  const counter = getProactiveCounter(accountId, threadId, dayKey);
  const max = getTuning("SCHEDULER_MAX_PROACTIVE_PER_DAY");

  if (counter.count >= max) {
    return {
      ok: false,
      reason: `Đã chạm trần ${max} tin chủ động/ngày cho cuộc trò chuyện này (tính theo ngày ${timeZone}).`,
      notifyCapHitOnce: !counter.noticeSent,
    };
  }

  return { ok: true };
}

/** Đánh dấu ĐÃ báo trần hôm nay - chỉ gọi SAU KHI thông báo chạm trần thật sự gửi được */
export function markProactiveCapNotified(
  accountId: string,
  threadId: string,
  timeZone: string,
  now: Date = new Date(),
): void {
  markProactiveCapNoticeSent(accountId, threadId, todayKey(timeZone, now));
}

/**
 * Ghi nhận `count` TIN chủ động ĐÃ GỬI THÀNH CÔNG - gọi SAU khi gửi, với số
 * tin THẬT SỰ đã ra (`reply.sentParts`, không phải cố định 1/lượt - 1 câu trả
 * lời dài có thể bị `sendReplyInParts` cắt thành nhiều tin).
 */
export function recordProactiveSend(
  accountId: string,
  threadId: string,
  timeZone: string,
  count: number,
  now: Date = new Date(),
): void {
  addProactiveSendCount(accountId, threadId, todayKey(timeZone, now), count, keepSinceDayKey(timeZone, now));
}

/** Chỉ dùng cho test - đưa bộ đếm trần về 0 để mỗi ca test bắt đầu sạch */
export function resetProactiveSendCounters(): void {
  resetAllProactiveCounters();
}
