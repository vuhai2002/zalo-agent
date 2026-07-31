import type { ScheduleKind, ScheduledJobItem } from "../dashboard-api-client";
import { formatBotTime } from "../shared/format-bot-time";
import { SelectMenu } from "../shared/select-menu";

const KIND_OPTIONS = [
  { value: "once", label: "Một lần" },
  { value: "every", label: "Lặp lại mỗi X phút" },
  { value: "cron", label: "Biểu thức cron" },
];

export type ScheduleFieldsPatch = Partial<{
  scheduleKind: ScheduleKind;
  onceDate: string;
  onceTime: string;
  everyMinutes: string;
  cronExpr: string;
}>;

/**
 * Ô nhập lịch: chọn KIỂU trước rồi mới hiện ô tương ứng (đúng bố cục brief
 * yêu cầu). Ngày/giờ của "once" là giờ TƯỜNG theo `timezone` (BOT_TIMEZONE) -
 * `<input type="date/time">` không tự mang zone, server hiểu đúng chuỗi này
 * theo `timeZone` truyền kèm (`zonedWallClockToUtc`) nên KHÔNG cần quy đổi gì
 * ở đây, chỉ cần nói rõ cho người nhập biết đây là giờ nào.
 */
export function ScheduleFieldsSection({
  job,
  timezone,
  scheduleKind,
  onceDate,
  onceTime,
  everyMinutes,
  cronExpr,
  onChange,
}: {
  /** null = đang tạo mới, chưa có mốc kế nào để hiện */
  job: ScheduledJobItem | null;
  timezone: string;
  scheduleKind: ScheduleKind;
  onceDate: string;
  onceTime: string;
  everyMinutes: string;
  cronExpr: string;
  onChange: (patch: ScheduleFieldsPatch) => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-line p-4">
      <div>
        <label htmlFor="sch-schedule-kind" className="mb-1.5 block text-[13px] font-medium text-ink">
          Kiểu lịch
        </label>
        <SelectMenu
          id="sch-schedule-kind"
          value={scheduleKind}
          options={KIND_OPTIONS}
          onChange={(v) => onChange({ scheduleKind: v as ScheduleKind })}
        />
      </div>

      {scheduleKind === "once" && (
        <div className="flex gap-3">
          <div className="flex-1">
            <label htmlFor="sch-once-date" className="mb-1.5 block text-[13px] font-medium text-ink">
              Ngày <span className="font-normal text-ink-soft">(giờ {timezone})</span>
            </label>
            <input
              id="sch-once-date"
              type="date"
              className="gc-input w-full"
              value={onceDate}
              onChange={(e) => onChange({ onceDate: e.target.value })}
            />
          </div>
          <div className="flex-1">
            <label htmlFor="sch-once-time" className="mb-1.5 block text-[13px] font-medium text-ink">
              Giờ <span className="font-normal text-ink-soft">(giờ {timezone})</span>
            </label>
            <input
              id="sch-once-time"
              type="time"
              className="gc-input w-full"
              value={onceTime}
              onChange={(e) => onChange({ onceTime: e.target.value })}
            />
          </div>
        </div>
      )}

      {scheduleKind === "every" && (
        <div>
          <label htmlFor="sch-every-minutes" className="mb-1.5 block text-[13px] font-medium text-ink">
            Lặp lại mỗi (phút)
          </label>
          <input
            id="sch-every-minutes"
            type="number"
            min={1}
            className="gc-input w-full"
            value={everyMinutes}
            onChange={(e) => onChange({ everyMinutes: e.target.value })}
          />
        </div>
      )}

      {scheduleKind === "cron" && (
        <div>
          <label htmlFor="sch-cron-expr" className="mb-1.5 block text-[13px] font-medium text-ink">
            Biểu thức cron <span className="font-normal text-ink-soft">(giờ {timezone})</span>
          </label>
          <input
            id="sch-cron-expr"
            className="gc-input w-full font-mono"
            value={cronExpr}
            onChange={(e) => onChange({ cronExpr: e.target.value })}
            placeholder='0 7 * * * (7h sáng mỗi ngày)'
          />
          {job && job.scheduleKind === "cron" && (
            <p className="mt-1.5 text-[12px] leading-[1.6] text-ink-soft">
              Lần kế tiếp hiện tại (theo lịch đang lưu): {formatBotTime(job.nextRunAt, timezone)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
