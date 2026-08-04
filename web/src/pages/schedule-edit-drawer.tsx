import { useState } from "react";
import type { AccountInfo, ScheduleKind, ScheduledJobItem } from "../dashboard-api-client";
import { api, ApiError } from "../dashboard-api-client";
import { useChotNen } from "../shared/backdrop-close-guard";
import { ScheduleDestinationFields } from "./schedule-destination-fields";
import { ScheduleFieldsSection } from "./schedule-fields-section";
import { buildSchedule, initialOnce, scheduleChanged } from "./schedule-form-helpers";

/**
 * Drawer tạo/sửa 1 lịch hẹn. `job=null` nghĩa là tạo mới - lúc đó mới cho
 * chọn account/thread/kind (xem `ScheduleDestinationFields` vì sao chỉ tạo
 * mới mới sửa được các ô này). Bố cục vay `account-edit-drawer.tsx`.
 */
export function ScheduleEditDrawer({
  job,
  accounts,
  timezone,
  onClose,
  onSaved,
}: {
  job: ScheduledJobItem | null;
  accounts: AccountInfo[];
  timezone: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const once = initialOnce(job, timezone);
  const [form, setForm] = useState({
    accountId: job?.accountId ?? accounts[0]?.id ?? "",
    threadId: job?.threadId ?? "",
    threadType: job?.threadType ?? 0,
    kind: job?.kind ?? "message",
    name: job?.name ?? "",
    payload: job?.payload ?? "",
    scheduleKind: (job?.scheduleKind ?? "once") as ScheduleKind,
    onceDate: once.date,
    onceTime: once.time,
    everyMinutes: job?.everyMinutes ? String(job.everyMinutes) : "60",
    cronExpr: job?.cronExpr ?? "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nen = useChotNen(onClose);

  async function save() {
    const schedule = buildSchedule(form);
    if (!schedule) {
      setError("Điền đủ thông tin lịch (ngày/giờ, số phút, hoặc biểu thức cron).");
      return;
    }
    if (!job && !form.threadId) {
      setError("Chọn cuộc trò chuyện để gửi lịch hẹn tới.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      if (job) {
        await api.schedule.update(job.id, job.accountId, job.threadId, {
          name: form.name,
          payload: form.payload,
          schedule: scheduleChanged(job, once, form) ? schedule : undefined,
        });
      } else {
        await api.schedule.create({
          accountId: form.accountId,
          threadId: form.threadId,
          threadType: form.threadType,
          name: form.name,
          kind: form.kind as "message" | "agent",
          payload: form.payload,
          schedule,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Lưu thất bại");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/25 backdrop-blur-[2px]" {...nen}>
      <div className="flex h-full w-full max-w-md flex-col border-l border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="font-semibold text-ink">{job ? `Sửa: ${job.name}` : "Thêm lịch hẹn"}</div>
          <button onClick={onClose} className="rounded-lg border border-line px-3 py-1 text-[13px] text-ink-soft hover:bg-tile">
            Đóng
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {!job && (
            <ScheduleDestinationFields
              accounts={accounts}
              accountId={form.accountId}
              threadId={form.threadId}
              kind={form.kind}
              onChange={(patch) => setForm({ ...form, ...patch })}
            />
          )}

          <div>
            <label htmlFor="sch-name" className="mb-1.5 block text-[13px] font-medium text-ink">
              Tên
            </label>
            <input
              id="sch-name"
              className="gc-input w-full"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="vd: Nhắc họp 15h"
            />
          </div>

          <div>
            <label htmlFor="sch-payload" className="mb-1.5 block text-[13px] font-medium text-ink">
              {form.kind === "agent" ? "Prompt cho agent" : "Nội dung gửi"}
            </label>
            <textarea
              id="sch-payload"
              className="gc-input min-h-28 w-full resize-y leading-relaxed"
              value={form.payload}
              onChange={(e) => setForm({ ...form, payload: e.target.value })}
              placeholder={
                form.kind === "agent"
                  ? "vd: Tóm tắt tin công nghệ nổi bật hôm nay"
                  : "vd: Nhớ họp với anh Nam lúc 3h chiều nhé"
              }
            />
          </div>

          <ScheduleFieldsSection
            job={job}
            timezone={timezone}
            scheduleKind={form.scheduleKind}
            onceDate={form.onceDate}
            onceTime={form.onceTime}
            everyMinutes={form.everyMinutes}
            cronExpr={form.cronExpr}
            onChange={(patch) => setForm({ ...form, ...patch })}
          />

          {error && <p className="text-[13px] text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="border-t border-line px-5 py-4">
          <button
            onClick={save}
            disabled={busy || !form.name || !form.payload}
            className="w-full rounded-lg bg-zalo-500 py-2.5 text-[14px] font-medium text-white hover:bg-zalo-600 disabled:opacity-50"
          >
            {busy ? "Đang lưu..." : job ? "Lưu thay đổi" : "Tạo lịch hẹn"}
          </button>
        </div>
      </div>
    </div>
  );
}
