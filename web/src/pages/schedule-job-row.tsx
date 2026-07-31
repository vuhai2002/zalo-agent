import { useState } from "react";
import type { ScheduledJobItem, ScheduledJobRunItem } from "../dashboard-api-client";
import { formatBotTime } from "../shared/format-bot-time";
import { Badge } from "../shared/ui-bits";

/** Nhãn kiểu lịch đọc được, không phải mã kỹ thuật */
function scheduleLabel(job: ScheduledJobItem): string {
  if (job.scheduleKind === "once") return "Một lần";
  if (job.scheduleKind === "every") return `Mỗi ${job.everyMinutes} phút`;
  return `Cron: ${job.cronExpr}`;
}

/**
 * Badge trạng thái lần chạy cuối. `blocked` (job bị chặn ở preflight - account
 * rớt phiên, bot tắt cho thread) là đường DUY NHẤT người dùng biết job đang
 * hỏng vì job lỗi cố ý không nhắn gì - PHẢI hiện rõ, không phải trang trí.
 */
function statusBadge(status: string | null): { tone: "blue" | "gray" | "green" | "red" | "amber"; text: string } {
  switch (status) {
    case "ok":
      return { tone: "green", text: "Thành công" };
    case "silent":
      return { tone: "blue", text: "Im lặng (agent chọn không báo)" };
    case "skipped":
      return { tone: "amber", text: "Bị bỏ lượt" };
    case "error":
      return { tone: "red", text: "Lỗi" };
    case "interrupted":
      return { tone: "amber", text: "Bị ngắt giữa chừng" };
    case "blocked":
      return { tone: "red", text: "Đang bị chặn" };
    default:
      return { tone: "gray", text: "Chưa chạy lần nào" };
  }
}

export function ScheduleJobRow({
  job,
  accountName,
  threadName,
  timezone,
  onToggle,
  onRun,
  onEdit,
  onHistory,
  onDelete,
}: {
  job: ScheduledJobItem;
  accountName?: string;
  threadName: string;
  timezone: string;
  onToggle: () => void;
  onRun: () => Promise<ScheduledJobRunItem | null>;
  onEdit: () => void;
  onHistory: () => void;
  onDelete: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);
  const status = statusBadge(job.lastStatus);
  const canShowError = (job.lastStatus === "error" || job.lastStatus === "blocked") && job.lastError;

  async function handleRun() {
    setRunning(true);
    setRunResult(null);
    try {
      const run = await onRun();
      setRunResult(run ? `Kết quả chạy thử: ${run.status} - ${run.detail || "(không có mô tả)"}` : "Không ghi nhận được kết quả");
    } catch {
      setRunResult("Chạy thử thất bại - xem log để biết chi tiết");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="gc-card space-y-2.5 bg-tile/30 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-semibold text-ink">{job.name}</span>
        <Badge tone={job.kind === "agent" ? "blue" : "gray"} dot={false}>
          {job.kind === "agent" ? "Agent" : "Nhắn tin"}
        </Badge>
        <Badge tone="gray" dot={false}>
          {scheduleLabel(job)}
        </Badge>
        <Badge tone={status.tone}>{status.text}</Badge>
        {!job.enabled && (
          <Badge tone="gray" dot={false}>
            Đã tắt
          </Badge>
        )}
      </div>

      <div className="text-[12px] leading-[1.6] text-ink-soft">
        {accountName && <>{accountName} · </>}
        {threadName} · Lần kế tiếp: {job.enabled ? formatBotTime(job.nextRunAt, timezone) : "-"}
        {job.lastRunAt && <> · Chạy gần nhất: {formatBotTime(job.lastRunAt, timezone)}</>}
      </div>

      {canShowError && (
        <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[12px] leading-[1.6] text-red-700">
          {job.lastError}
        </div>
      )}

      {runResult && (
        <div className="rounded-lg border border-line bg-white px-3 py-2 text-[12px] leading-[1.6] text-ink-soft">
          {runResult}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          onClick={onToggle}
          className={`relative h-5 w-9 rounded-full transition-colors ${job.enabled ? "bg-zalo-500" : "bg-slate-300"}`}
          title={job.enabled ? "Đang bật - bấm để tắt" : "Đang tắt - bấm để bật"}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${job.enabled ? "left-[18px]" : "left-0.5"}`}
          />
        </button>
        <button
          onClick={handleRun}
          disabled={running}
          className="rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] font-medium text-zalo-600 hover:bg-zalo-50 disabled:opacity-50"
        >
          {running ? "Đang chạy..." : "Chạy thử ngay"}
        </button>
        <button
          onClick={onHistory}
          className="rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-tile"
        >
          Lịch sử
        </button>
        <button
          onClick={onEdit}
          className="rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-tile"
        >
          Sửa
        </button>
        <button onClick={onDelete} className="rounded-lg px-3 py-1.5 text-[13px] text-red-600 hover:bg-red-50">
          Xóa
        </button>
      </div>
    </div>
  );
}
