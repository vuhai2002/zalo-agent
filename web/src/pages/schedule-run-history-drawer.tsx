import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ScheduledJobItem, ScheduledJobRunItem } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { useChotNen } from "../shared/backdrop-close-guard";
import { formatBotTime } from "../shared/format-bot-time";
import { Badge } from "../shared/ui-bits";

function runTone(status: ScheduledJobRunItem["status"]): "blue" | "gray" | "green" | "red" | "amber" {
  if (status === "ok") return "green";
  if (status === "silent") return "blue";
  if (status === "skipped" || status === "interrupted" || status === "running") return "amber";
  return "red"; // error
}

/**
 * Drawer lịch sử chạy của 1 job - khác `scheduled_jobs.last_status` (chỉ nói
 * lần CUỐI), đây là TỪNG lần đã xảy ra gì, kể cả lý do khi `skipped` (chạm
 * trần ngày, bỏ lượt vì trễ quá grace...). Job kind='agent' có `turnId` thì
 * bấm thẳng sang trang Trace - tận dụng đúng thứ dự án đã đầu tư nhiều nhất.
 */
export function ScheduleRunHistoryDrawer({
  job,
  timezone,
  onClose,
}: {
  job: ScheduledJobItem;
  timezone: string;
  onClose: () => void;
}) {
  const [runs, setRuns] = useState<ScheduledJobRunItem[]>([]);
  const [loading, setLoading] = useState(true);
  const nen = useChotNen(onClose);

  useEffect(() => {
    api.schedule
      .runs(job.id, job.accountId, job.threadId)
      .then((r) => setRuns(r.runs))
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
  }, [job.id, job.accountId, job.threadId]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/25 backdrop-blur-[2px]" {...nen}>
      <div className="flex h-full w-full max-w-lg flex-col border-l border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <div className="font-semibold text-ink">Lịch sử chạy - {job.name}</div>
            <div className="text-[12px] text-ink-soft">{runs.length} lần gần nhất</div>
          </div>
          <button onClick={onClose} className="rounded-lg border border-line px-3 py-1 text-[13px] text-ink-soft hover:bg-tile">
            Đóng
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto bg-canvas px-5 py-4">
          {loading && <p className="text-[13px] text-ink-soft">Đang tải...</p>}
          {!loading && runs.length === 0 && (
            <p className="py-10 text-center text-[13px] leading-relaxed text-ink-soft/60">Chưa có lần chạy nào</p>
          )}
          {runs.map((run) => (
            <div key={run.id} className="gc-tile space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={runTone(run.status)}>{run.status}</Badge>
                <span className="text-[12px] text-ink-soft">{formatBotTime(run.startedAt, timezone)}</span>
                {job.kind === "agent" && run.turnId && (
                  <Link
                    to={`/trace?turnId=${run.turnId}`}
                    className="text-[12px] font-medium text-zalo-600 hover:underline"
                  >
                    Xem trace
                  </Link>
                )}
              </div>
              {run.detail && <p className="text-[12px] leading-[1.6] text-ink-soft">{run.detail}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
