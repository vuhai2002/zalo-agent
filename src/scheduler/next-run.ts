/**
 * Tính mốc chạy kế tiếp + grace window + quyết định hành động khi job đến hạn.
 * Module THUẦN như `schedule-parser.ts`: không DB, không env, không logger.
 */

import { CronExpressionParser } from "cron-parser";
import type { ParsedSchedule } from "./schedule-parser.js";

const GRACE_MIN_SECONDS = 120;
const GRACE_MAX_SECONDS = 7200;

/**
 * Mốc chạy kế tiếp.
 *
 * `from` là mốc NEO: lúc tạo job thì là "bây giờ"; lúc job vừa đến hạn (vòng
 * tick ghi next_run_at MỚI trước khi dispatch) thì là `next_run_at` CŨ - tức
 * thời điểm job LẼ RA phải chạy, không phải lúc tick thực sự nhặt được nó.
 *
 * `now` mặc định bằng `from` (không có gì trôi) - dùng cho lúc tạo job. Vòng
 * tick truyền `now` THẬT khác `from` để bù trôi lịch (goclaw `executeJobByID`):
 * nếu chỉ cộng `now + interval`, mỗi lượt trễ vài giây do overhead xử lý sẽ
 * cộng dồn qua hàng tuần (7h sáng thành 7h20). Neo vào `from` gốc rồi nhảy
 * đúng số chu kỳ đã trôi qua (`elapsed / interval`) thì mốc mới luôn khớp lưới
 * ban đầu, kể cả sau một lần bù trễ dài (bot tắt vài giờ) - không sinh dồn
 * nhiều lượt liên tiếp.
 */
export function computeNextRun(schedule: ParsedSchedule, from: Date, now: Date = from): string | null {
  if (schedule.kind === "once") return schedule.runAtUtc;
  if (schedule.kind === "every") return computeEveryNext(schedule.minutes, from, now);
  return computeCronNext(schedule.expr, schedule.timeZone, now);
}

function computeEveryNext(minutes: number, from: Date, now: Date): string {
  const intervalMs = minutes * 60_000;
  const scheduledMs = from.getTime();
  // Kẹp 0: `now` sớm hơn `from` không nên xảy ra khi dùng đúng hợp đồng, nhưng
  // âm ở đây sẽ làm `steps` âm và nhảy NGƯỢC thời gian - kẹp cho an toàn.
  const elapsedMs = Math.max(0, now.getTime() - scheduledMs);
  const steps = Math.floor(elapsedMs / intervalMs) + 1;
  return new Date(scheduledMs + steps * intervalMs).toISOString();
}

function computeCronNext(expr: string, timeZone: string, now: Date): string | null {
  // Cron KHÔNG cần công thức neo mốc như `every`: mỗi lần kế tiếp là thời điểm
  // TUYỆT ĐỐI theo lịch (7h sáng luôn là 7h sáng), nên cứ hỏi cron-parser mốc
  // kế tiếp SAU `now` là tự động đúng, không tích luỹ trôi qua thời gian.
  try {
    const interval = CronExpressionParser.parse(expr, { currentDate: now, tz: timeZone });
    return interval.next().toDate().toISOString();
  } catch {
    return null;
  }
}

/** Nửa chu kỳ của biểu thức cron, ước lượng từ 2 mốc kế tiếp SAU `now` */
function cronPeriodSeconds(expr: string, timeZone: string, now: Date): number {
  try {
    const interval = CronExpressionParser.parse(expr, { currentDate: now, tz: timeZone });
    const first = interval.next().toDate();
    const second = interval.next().toDate();
    return (second.getTime() - first.getTime()) / 1000;
  } catch {
    return GRACE_MIN_SECONDS;
  }
}

/**
 * Cửa sổ grace (giây): trễ trong khoảng này vẫn coi là "đúng hạn".
 *
 * `once` dùng thẳng `onceGraceMinutes` (tham số `SCHEDULER_ONCE_GRACE_MINUTES`).
 * `every`/`cron` dùng NỬA CHU KỲ, kẹp `[120, 7200]` giây (công thức
 * `_compute_grace_seconds` của Hermes): job dày (every 5 phút) không nên có
 * grace dài hơn cả chu kỳ của chính nó, job thưa (every 3 ngày) cũng không nên
 * grace tới 1.5 ngày - kẹp trần 2 tiếng là đủ "bot vừa khởi động lại" mà không
 * biến thành "chạy bù sau cả buổi".
 */
export function graceSecondsFor(schedule: ParsedSchedule, onceGraceMinutes: number, now: Date = new Date()): number {
  if (schedule.kind === "once") return onceGraceMinutes * 60;

  const periodSeconds =
    schedule.kind === "every" ? schedule.minutes * 60 : cronPeriodSeconds(schedule.expr, schedule.timeZone, now);

  return Math.min(GRACE_MAX_SECONDS, Math.max(GRACE_MIN_SECONDS, periodSeconds / 2));
}

export type DueJob = {
  schedule: ParsedSchedule;
  /** `next_run_at` hiện có trên row - mốc job LẼ RA phải chạy */
  nextRunAt: Date;
  onceGraceMinutes: number;
};

export type DueAction = "run" | "run-late" | "skip-forward";

/**
 * Job đã ĐẾN HẠN (caller lọc bằng `next_run_at <= now` trước khi gọi đây) -
 * quyết định chạy thế nào. Khớp bảng 4 dòng "bot tắt rồi bật lại":
 *
 * | Tình huống                  | Trả về        |
 * |------------------------------|---------------|
 * | once, trễ trong grace        | run           |
 * | once, trễ quá grace          | run-late      | (vẫn gửi, kèm nhãn "nhắc trễ")
 * | every/cron, trễ trong grace   | run           | (chạy bù 1 lần)
 * | every/cron, trễ quá grace     | skip-forward  | (bỏ lượt, không dồn backlog)
 *
 * `once` không có `skip-forward`: nuốt im lặng một lời NHẮC HẸN là kết cục tệ
 * nhất cho bot cá nhân - trễ bao lâu cũng phải báo, chỉ khác là có kèm nhãn hay
 * không (quyết định cố ý khác Hermes, nơi one-shot quá hạn bị vứt thẳng).
 */
export function decideDueAction(job: DueJob, now: Date): DueAction {
  const graceSeconds = graceSecondsFor(job.schedule, job.onceGraceMinutes, now);
  const lateSeconds = (now.getTime() - job.nextRunAt.getTime()) / 1000;
  const onTime = lateSeconds <= graceSeconds;

  if (job.schedule.kind === "once") return onTime ? "run" : "run-late";
  return onTime ? "run" : "skip-forward";
}
