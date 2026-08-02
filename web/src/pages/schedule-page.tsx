import { useCallback, useEffect, useState } from "react";
import type { AccountInfo, ScheduledJobItem } from "../dashboard-api-client";
import { api, ApiError } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { IconClock } from "../shared/dashboard-icons";
import { AccountFilter, accountLabel } from "../shared/account-filter";
import { useConfirmDialog } from "../shared/confirm-dialog";
import { ScheduleEditDrawer } from "./schedule-edit-drawer";
import { ScheduleJobRow } from "./schedule-job-row";
import { ScheduleRunHistoryDrawer } from "./schedule-run-history-drawer";

/**
 * Trang Lịch hẹn: bot tự nhắn theo lịch (nhắc hẹn hoặc chạy 1 lượt agent).
 * Mọi mốc giờ hiển thị pin theo `timezone` server trả về (BOT_TIMEZONE),
 * không tự suy từ giờ trình duyệt - xem `shared/format-bot-time.ts`.
 */
export function SchedulePage({ accounts }: { accounts: AccountInfo[] }) {
  const [jobs, setJobs] = useState<ScheduledJobItem[]>([]);
  const [timezone, setTimezone] = useState("UTC");
  const [threadNames, setThreadNames] = useState<Map<string, string>>(new Map());
  const [accountFilter, setAccountFilter] = useState("");
  const [editing, setEditing] = useState<ScheduledJobItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [historyJob, setHistoryJob] = useState<ScheduledJobItem | null>(null);
  const [notice, setNotice] = useState<{ tone: "red" | "amber"; text: string } | null>(null);
  const { confirm, confirmDialog } = useConfirmDialog();

  const reload = useCallback(async () => {
    const [jobsRes, threadsRes] = await Promise.all([api.schedule.list(accountFilter), api.threads(accountFilter, "", 0)]);
    setJobs(jobsRes.items);
    setTimezone(jobsRes.timezone);
    setThreadNames(
      new Map(threadsRes.items.map((t) => [`${t.accountId}:${t.threadId}`, t.displayName || t.threadId])),
    );
  }, [accountFilter]);

  useEffect(() => {
    reload().catch(() => setNotice({ tone: "red", text: "Không tải được danh sách lịch hẹn" }));
  }, [reload]);

  async function toggleEnabled(job: ScheduledJobItem) {
    setNotice(null);
    try {
      await api.schedule.update(job.id, job.accountId, job.threadId, { enabled: !job.enabled });
      await reload();
    } catch (err) {
      setNotice({ tone: "red", text: err instanceof ApiError ? err.message : "Không đổi được trạng thái" });
    }
  }

  async function remove(job: ScheduledJobItem) {
    const ok = await confirm({
      title: `Xóa lịch hẹn "${job.name}"?`,
      message: "Lịch sử chạy của lịch hẹn này cũng sẽ bị xóa theo, không khôi phục được.",
    });
    if (!ok) return;
    setNotice(null);
    try {
      await api.schedule.remove(job.id, job.accountId, job.threadId);
      await reload();
    } catch (err) {
      setNotice({ tone: "red", text: err instanceof ApiError ? err.message : "Xóa thất bại" });
    }
  }

  async function runTrial(job: ScheduledJobItem) {
    const res = await api.schedule.run(job.id, job.accountId, job.threadId);
    await reload();
    return res.run;
  }

  return (
    <div>
      <PageHeader
        icon={IconClock}
        title="Lịch hẹn"
        subtitle="Bot tự nhắn theo lịch: nhắc hẹn hoặc chạy 1 lượt agent - xem, sửa, chạy thử ngay không cần chat"
        aside={
          <button
            onClick={() => setCreating(true)}
            className="rounded-lg bg-zalo-500 px-4 py-2 text-[14px] font-medium text-white hover:bg-zalo-600"
          >
            Thêm lịch hẹn
          </button>
        }
      />

      {accounts.length > 1 && (
        <div className="mb-4 w-full sm:w-56">
          <AccountFilter accounts={accounts} value={accountFilter} onChange={setAccountFilter} />
        </div>
      )}

      {notice && (
        <p className={`mb-4 text-[13px] ${notice.tone === "red" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>{notice.text}</p>
      )}

      <div className="space-y-3">
        {jobs.length === 0 && (
          <div className="gc-card px-5 py-10 text-center text-ink-soft">
            Chưa có lịch hẹn nào - bấm "Thêm lịch hẹn" hoặc nhờ bot đặt lịch qua chat
          </div>
        )}
        {jobs.map((job) => (
          <ScheduleJobRow
            key={job.id}
            job={job}
            accountName={accounts.length > 1 ? accountLabel(accounts, job.accountId) : undefined}
            threadName={threadNames.get(`${job.accountId}:${job.threadId}`) ?? job.threadId}
            timezone={timezone}
            onToggle={() => toggleEnabled(job)}
            onRun={() => runTrial(job)}
            onEdit={() => setEditing(job)}
            onHistory={() => setHistoryJob(job)}
            onDelete={() => remove(job)}
          />
        ))}
      </div>

      {(editing || creating) && (
        <ScheduleEditDrawer
          job={editing}
          accounts={accounts}
          timezone={timezone}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            setEditing(null);
            setCreating(false);
            void reload();
          }}
        />
      )}

      {historyJob && (
        <ScheduleRunHistoryDrawer job={historyJob} timezone={timezone} onClose={() => setHistoryJob(null)} />
      )}

      {confirmDialog}
    </div>
  );
}
