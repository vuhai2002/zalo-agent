/**
 * Guardrail trước MỌI lần gửi CHỦ ĐỘNG của scheduler (không phải trả lời tin
 * tới): account đang chạy -> thread còn hợp lệ (tồn tại trong bảng `threads`
 * VÀ `bot_enabled = 1` - tắt bot cho 1 thread trên dashboard tắt luôn mọi job
 * nhắm vào đó, một công tắc chứ không phải hai) -> chưa chạm trần ngày. Hỏng
 * bất kỳ điều nào thì trả lý do dạng chữ để ghi vào `scheduled_job_runs.detail`.
 *
 * Kèm hàng đợi rải đều TOÀN CỤC (`SCHEDULER_SEND_GAP_MS`) - khác
 * `middleware/rate-limiter.ts` hiện có vốn chỉ xếp hàng TRONG một thread.
 */

import { getTuning } from "../config/runtime-tuning-settings.js";
import { findThreadStatus } from "../conversation/thread-store.js";
import { todayKey } from "../shared/zone-time.js";
import { isAccountRunning } from "../zalo/account-manager.js";

/** Chữ dùng chung với pre-flight của run-scheduled-job.ts - cùng 1 điều kiện, cùng 1 câu */
export const ACCOUNT_NOT_RUNNING_REASON = "Account hiện không chạy (chưa đăng nhập hoặc bị dừng).";

/**
 * Đếm tin chủ động + đánh dấu đã báo trần, giữ TRONG BỘ NHỚ theo
 * (accountId, threadId, ngày VN). `messages` không có cột phân biệt "scheduler
 * tự bắn" hay "trả lời hội thoại thường" (thêm cột là sửa schema DB, ngoài
 * phạm vi phase này), nên không đếm đáng tin cậy bằng SQL được - giữ bộ nhớ là
 * lựa chọn còn lại.
 *
 * Nhược điểm CHẤP NHẬN ĐƯỢC: bot restart giữa ngày thì đếm lại từ 0 (thêm tối
 * đa `SCHEDULER_MAX_PROACTIVE_PER_DAY` tin trong đúng ngày đó). Đây là LƯỚI ĐỠ
 * CUỐI - lưới đỡ ĐẦU (chặn `every`/`cron` quá dày ngay lúc TẠO job, xem
 * `schedule-parser.ts`) độc lập với bộ đếm này và không hề bị ảnh hưởng bởi
 * restart.
 */
type DayCounter = { dayKey: string; count: number; capNoticeSent: boolean };
const countersByThread = new Map<string, DayCounter>();

function counterFor(key: string, dayKey: string): DayCounter {
  const existing = countersByThread.get(key);
  if (existing && existing.dayKey === dayKey) return existing;
  // Ngày mới (hoặc thread lần đầu gặp) - bộ đếm reset về 0, tự nhiên đúng lịch
  const fresh: DayCounter = { dayKey, count: 0, capNoticeSent: false };
  countersByThread.set(key, fresh);
  return fresh;
}

export type GuardResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      /**
       * true đúng 1 LẦN/ngày/thread khi job đầu tiên chạm trần - caller nên
       * nhắn đúng MỘT câu cho biết vì sao job im, không thì user không hiểu
       * vì sao lời nhắc "biến mất". Các lần chạm trần SAU trong CÙNG ngày trả
       * false - im lặng bỏ lượt, tránh việc chính câu thông báo lại thành spam.
       */
      notifyCapHitOnce: boolean;
    };

export function checkProactiveSendGuard(
  accountId: string,
  threadId: string,
  timeZone: string,
  now: Date = new Date(),
): GuardResult {
  if (!isAccountRunning(accountId)) {
    return { ok: false, reason: ACCOUNT_NOT_RUNNING_REASON, notifyCapHitOnce: false };
  }

  const thread = findThreadStatus(accountId, threadId);
  if (!thread) {
    return {
      ok: false,
      reason: "Cuộc trò chuyện chưa từng ghi nhận trong hệ thống - không nhắn chủ động được.",
      notifyCapHitOnce: false,
    };
  }
  if (!thread.botEnabled) {
    return { ok: false, reason: "Bot đang tắt cho cuộc trò chuyện này.", notifyCapHitOnce: false };
  }

  const key = `${accountId}:${threadId}`;
  const dayKey = todayKey(timeZone, now);
  const counter = counterFor(key, dayKey);
  const max = getTuning("SCHEDULER_MAX_PROACTIVE_PER_DAY");

  if (counter.count >= max) {
    const notify = !counter.capNoticeSent;
    counter.capNoticeSent = true;
    return {
      ok: false,
      reason: `Đã chạm trần ${max} tin chủ động/ngày cho cuộc trò chuyện này (tính theo ngày ${timeZone}).`,
      notifyCapHitOnce: notify,
    };
  }

  return { ok: true };
}

/** Ghi nhận 1 tin chủ động ĐÃ GỬI THÀNH CÔNG - gọi SAU khi gửi xong, không phải lúc kiểm */
export function recordProactiveSend(
  accountId: string,
  threadId: string,
  timeZone: string,
  now: Date = new Date(),
): void {
  counterFor(`${accountId}:${threadId}`, todayKey(timeZone, now)).count++;
}

/** Chỉ dùng cho test - dọn sạch bộ đếm trong bộ nhớ để mỗi ca test bắt đầu từ 0 */
export function resetProactiveSendCounters(): void {
  countersByThread.clear();
}

// ===== Rải đều TOÀN CỤC giữa các tin chủ động =====

let queueTail: Promise<unknown> = Promise.resolve();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Xếp 1 lần gửi chủ động vào hàng đợi TOÀN CỤC (khác `rate-limiter.ts` vốn chỉ
 * xếp hàng TRONG 1 thread): 2 job ở 2 thread khác nhau tới hạn CÙNG LÚC vẫn bị
 * cách nhau `SCHEDULER_SEND_GAP_MS`. Độ trễ đứng TRƯỚC task (cùng nếp
 * `rate-limiter.ts`) nên tin chủ động ĐẦU TIÊN của cả quá trình cũng bị delay -
 * không phải lỗi, cùng triết lý "không trông như máy" của `SEND_DELAY_MIN/MAX_MS`.
 */
export function enqueueProactiveSend<T>(task: () => Promise<T>): Promise<T> {
  const run = queueTail.then(async () => {
    await sleep(getTuning("SCHEDULER_SEND_GAP_MS"));
    return task();
  });
  // Giữ hàng đợi sống dù task lỗi hay thành công - lỗi của task này vẫn trả
  // đúng ra cho caller qua `run`, chỉ riêng "đuôi hàng đợi" không được vỡ theo.
  queueTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Chỉ dùng cho test - đưa hàng đợi rải đều về trạng thái sạch giữa các ca test */
export function resetProactiveSendQueue(): void {
  queueTail = Promise.resolve();
}
