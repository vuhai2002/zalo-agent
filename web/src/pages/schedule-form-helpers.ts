import type { ScheduleInputPayload, ScheduleKind, ScheduledJobItem } from "../dashboard-api-client";
import { splitBotDateTime } from "../shared/format-bot-time";

/**
 * Logic THUẦN của form sửa/tạo lịch hẹn - tách khỏi `schedule-edit-drawer.tsx`
 * (giữ file đó dưới ngưỡng 200 dòng) để phần "tính toán từ form" độc lập với
 * phần "vẽ UI", dễ test riêng nếu cần.
 */

export function initialOnce(job: ScheduledJobItem | null, timezone: string): { date: string; time: string } {
  if (job?.scheduleKind === "once" && job.runAt) return splitBotDateTime(job.runAt, timezone);
  return { date: "", time: "" };
}

export type ScheduleFormValues = {
  scheduleKind: ScheduleKind;
  onceDate: string;
  onceTime: string;
  everyMinutes: string;
  cronExpr: string;
};

export function buildSchedule(form: ScheduleFormValues): ScheduleInputPayload | null {
  if (form.scheduleKind === "once") {
    if (!form.onceDate || !form.onceTime) return null;
    return { kind: "once", date: form.onceDate, time: form.onceTime };
  }
  if (form.scheduleKind === "every") {
    const minutes = Number(form.everyMinutes);
    if (!Number.isInteger(minutes) || minutes <= 0) return null;
    return { kind: "every", minutes };
  }
  if (!form.cronExpr.trim()) return null;
  return { kind: "cron", expr: form.cronExpr.trim() };
}

/**
 * Lịch có ĐỔI so với job gốc không - PATCH chỉ nên kèm `schedule` khi có đổi
 * thật. Gửi `schedule` không đổi mỗi lần sửa tên/nội dung làm server tính lại
 * `next_run_at` (neo vào `now` cho 'every' - dời hẳn giờ chạy ĐI THẦM LẶNG),
 * và job 'once' đã qua giờ (`runAt` ở quá khứ) sẽ bị `parseSchedule` từ chối
 * dù người dùng chỉ đổi tên.
 */
export function scheduleChanged(
  job: ScheduledJobItem,
  once: { date: string; time: string },
  form: ScheduleFormValues,
): boolean {
  if (form.scheduleKind !== job.scheduleKind) return true;
  if (form.scheduleKind === "once") return form.onceDate !== once.date || form.onceTime !== once.time;
  if (form.scheduleKind === "every") return form.everyMinutes !== String(job.everyMinutes ?? "");
  return form.cronExpr.trim() !== (job.cronExpr ?? "");
}
