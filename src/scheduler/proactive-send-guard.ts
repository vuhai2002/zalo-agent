/**
 * Guardrail trước MỌI lần gửi CHỦ ĐỘNG của scheduler (không phải trả lời tin
 * tới): account đang chạy -> thread còn hợp lệ (tồn tại trong bảng `threads`
 * VÀ `bot_enabled = 1`) -> chưa chạm trần ngày (đếm THEO TIN, bền qua restart
 * - xem `proactive-send-counter-store.ts`). Hỏng bất kỳ điều nào thì trả lý
 * do dạng chữ để ghi vào `scheduled_job_runs.detail`.
 *
 * Trần ngày có 2 điểm kiểm KHÁC NHAU: `checkProactiveDailyCap` (THUẦN ĐỌC,
 * lọc SỚM ở tick trước khi chạy agent - tránh đốt LLM, nhưng không giữ chỗ
 * nên không chặn được race) và `reserveProactiveSlot` (NGUYÊN TỬ, dùng ngay
 * sát lúc gửi thật ở `scheduled-job-send.ts` - giành 1 suất bằng 1 câu UPDATE
 * có điều kiện, chặn đúng race đó).
 *
 * Kèm hàng đợi rải đều TOÀN CỤC (`SCHEDULER_SEND_GAP_MS`, xem
 * `proactive-send-queue.ts`) - khác `middleware/rate-limiter.ts` chỉ xếp
 * hàng TRONG một thread.
 */

import { getTuning } from "../config/runtime-tuning-settings.js";
import { findThreadStatus } from "../conversation/thread-store.js";
import { todayKey } from "../shared/zone-time.js";
import { isAccountRunning } from "../zalo/account-manager.js";
import {
  addProactiveSendCount,
  getProactiveCounter,
  markProactiveCapNoticeSent,
  refundProactiveSlot as refundProactiveSlotRow,
  resetAllProactiveCounters,
  revertCapNotice as revertCapNoticeRow,
  tryReserveCapNotice,
  tryReserveProactiveSlot,
} from "./proactive-send-counter-store.js";

// Hàng đợi rải đều toàn cục nằm ở file riêng (proactive-send-queue.ts) - re-export
// để mọi nơi vẫn import qua "proactive-send-guard.js" như trước, không phải sửa call site.
export { deliverProactively, enqueueProactiveSend, resetProactiveSendQueue } from "./proactive-send-queue.js";

/** Chữ dùng chung với pre-flight của scheduler-loop.ts/run-scheduled-job.ts - cùng 1 điều kiện, cùng 1 câu */
export const ACCOUNT_NOT_RUNNING_REASON = "Account hiện không chạy (chưa đăng nhập hoặc bị dừng).";

export type PreflightResult = { ok: true } | { ok: false; reason: string };

/**
 * Phần KHÔNG phụ thuộc nội dung của guard - account đang chạy + thread hợp
 * lệ. Tách riêng để `scheduler-loop.ts` kiểm được NGAY TRONG TICK, TRƯỚC khi
 * clear-before-dispatch: job chặn ở đây thì tick chưa hề đụng
 * `next_run_at`/`run_count`, tick sau tự thử lại - job không "chết" chỉ vì
 * account rớt phiên đúng lúc đến hạn (ca bình thường của zca-js).
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
       * true nghĩa là CHƯA báo trần hôm nay - caller phải tự giành quyền báo
       * (`reserveCapNotice`) rồi mới gửi. Các hàm kiểm trần ở file này THUẦN
       * ĐỌC hoặc chỉ GIỮ CHỖ, không tự gửi gì.
       */
      notifyCapHitOnce: boolean;
    };

/**
 * `now` là THAM SỐ BẮT BUỘC ở MỌI hàm trong file này - cố ý bỏ hết
 * `= new Date()`.
 *
 * Đây là lỗi đã trả giá: `recordProactiveSend` từng có mặc định `new Date()`,
 * và `sendCapNotice` quên truyền `now`. Hệ quả kép, cả hai đều âm thầm:
 *
 * 1. Bộ đếm cộng vào day-key của giờ THẬT thay vì ngày lượt đang xử lý.
 * 2. `keepSinceDayKey` dọn bảng bằng mốc của giờ thật, XÓA luôn dòng của ngày
 *    vừa ghi (retention 3 ngày).
 *
 * Nặng nhất là ca nửa đêm: `reserveProactiveSlot` giành suất ngày D, gửi mất
 * 20 giây (`SCHEDULER_SEND_GAP_MS`) rồi hỏng, `refundProactiveSlot` trả suất
 * cho ngày D+1 - ngày D giữ suất vĩnh viễn không ai đòi lại được, mà đây là
 * lá chắn chống khóa nick.
 *
 * BẤT BIẾN: một lượt xử lý job = MỘT mốc thời gian, chốt ở đầu tick rồi luồn
 * đi khắp nơi. Để mặc định là mở lại đúng cái bẫy đó cho người sửa sau.
 */

/** Số ngày giữ lại bộ đếm - trần chỉ cần biết ĐÚNG HÔM NAY nên không cần giữ lâu */
const COUNTER_RETENTION_DAYS = 3;

function keepSinceDayKey(timeZone: string, now: Date): string {
  const cutoff = new Date(now.getTime() - COUNTER_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  return todayKey(timeZone, cutoff);
}

function capReason(max: number, timeZone: string): string {
  return `Đã chạm trần ${max} tin chủ động/ngày cho cuộc trò chuyện này (tính theo ngày ${timeZone}).`;
}

/**
 * THUẦN ĐỌC, KHÔNG giữ chỗ - dùng lọc SỚM ở tick (`scheduler-loop.ts`), TRƯỚC
 * khi chạy agent: tránh đốt LLM cho 1 job chắc chắn không gửi được. KHÔNG
 * atomic nên KHÔNG dùng để quyết định "có được gửi hay không" ngay sát lúc
 * gửi thật - xem `reserveProactiveSlot`.
 */
export function checkProactiveDailyCap(
  accountId: string,
  threadId: string,
  timeZone: string,
  now: Date,
): GuardResult {
  const dayKey = todayKey(timeZone, now);
  const counter = getProactiveCounter(accountId, threadId, dayKey);
  const max = getTuning("SCHEDULER_MAX_PROACTIVE_PER_DAY");
  if (counter.count >= max) {
    return { ok: false, reason: capReason(max, timeZone), notifyCapHitOnce: !counter.noticeSent };
  }
  return { ok: true };
}

/**
 * NGUYÊN TỬ - giành ĐÚNG 1 suất nếu còn chỗ (1 câu UPDATE có điều kiện, xem
 * `tryReserveProactiveSlot`). Dùng NGAY SÁT lúc gửi thật - điểm CHẶN RACE
 * giữa nhiều job cùng thread cùng đến hạn (`checkProactiveDailyCap` ở trên
 * chỉ lọc sớm, không giữ chỗ). Gọi `recordProactiveSend` sau đó để cộng nốt
 * phần CÒN LẠI khi `sentParts` > 1, hoặc `refundProactiveSlot` nếu cuối cùng
 * không gửi được gì.
 */
export function reserveProactiveSlot(
  accountId: string,
  threadId: string,
  timeZone: string,
  now: Date,
): GuardResult {
  const dayKey = todayKey(timeZone, now);
  const max = getTuning("SCHEDULER_MAX_PROACTIVE_PER_DAY");
  if (!tryReserveProactiveSlot(accountId, threadId, dayKey, max)) {
    const counter = getProactiveCounter(accountId, threadId, dayKey);
    return { ok: false, reason: capReason(max, timeZone), notifyCapHitOnce: !counter.noticeSent };
  }
  return { ok: true };
}

/** Hoàn lại ĐÚNG 1 suất đã `reserveProactiveSlot` giành nhưng cuối cùng không gửi được gì */
export function refundProactiveSlot(accountId: string, threadId: string, timeZone: string, now: Date): void {
  refundProactiveSlotRow(accountId, threadId, todayKey(timeZone, now));
}

/** Kết hợp cả 3 điều kiện, THUẦN ĐỌC - tiện cho chỗ chỉ cần biết "có bị chặn không" mà không cần giành chỗ (vd trang xem trước) */
export function checkProactiveSendGuard(
  accountId: string,
  threadId: string,
  timeZone: string,
  now: Date,
): GuardResult {
  const preflight = checkAccountAndThreadReady(accountId, threadId);
  if (!preflight.ok) return { ok: false, reason: preflight.reason, notifyCapHitOnce: false };
  return checkProactiveDailyCap(accountId, threadId, timeZone, now);
}

/**
 * Đánh dấu ĐÃ báo trần hôm nay - hàm GHI ĐÈ vô điều kiện, giữ lại cho chỗ đã
 * tự chắc chắn (vd trang "Chạy thử ngay" phase 05, không có race nhiều job).
 * Đường gửi thông báo THẬT của scheduler dùng
 * `reserveCapNotice`/`revertCapNotice` NGUYÊN TỬ bên dưới thay vì hàm này.
 */
export function markProactiveCapNotified(
  accountId: string,
  threadId: string,
  timeZone: string,
  now: Date,
): void {
  markProactiveCapNoticeSent(accountId, threadId, todayKey(timeZone, now));
}

/**
 * NGUYÊN TỬ - giành QUYỀN gửi thông báo chạm trần (xem `tryReserveCapNotice`).
 * Gọi NGAY TRƯỚC khi thật sự gửi - điểm CHẶN RACE khi N job cùng thread cùng
 * bị chặn trong 1 tick, khác `markProactiveCapNotified` (ghi SAU khi gửi
 * xong, quá muộn để chặn race).
 */
export function reserveCapNotice(accountId: string, threadId: string, timeZone: string, now: Date): boolean {
  return tryReserveCapNotice(accountId, threadId, todayKey(timeZone, now));
}

/** Trả lại quyền đã giành ở `reserveCapNotice` nhưng cuối cùng gửi hỏng - job/tick sau còn cơ hội thử lại */
export function revertCapNotice(accountId: string, threadId: string, timeZone: string, now: Date): void {
  revertCapNoticeRow(accountId, threadId, todayKey(timeZone, now));
}

/**
 * Ghi nhận thêm `count` TIN chủ động ĐÃ GỬI THÀNH CÔNG - gọi SAU khi gửi, với
 * PHẦN CÒN LẠI của số tin THẬT SỰ đã ra (`reply.sentParts - 1`, vì 1 suất đã
 * được `reserveProactiveSlot` giành trước đó rồi) - 1 câu trả lời dài có thể
 * bị `sendReplyInParts` cắt thành nhiều tin.
 */
export function recordProactiveSend(
  accountId: string,
  threadId: string,
  timeZone: string,
  count: number,
  now: Date,
): void {
  addProactiveSendCount(accountId, threadId, todayKey(timeZone, now), count, keepSinceDayKey(timeZone, now));
}

/** Chỉ dùng cho test - đưa bộ đếm trần về 0 để mỗi ca test bắt đầu sạch */
export function resetProactiveSendCounters(): void {
  resetAllProactiveCounters();
}
