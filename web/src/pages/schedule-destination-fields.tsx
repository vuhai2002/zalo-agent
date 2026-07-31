import { useEffect, useState } from "react";
import type { AccountInfo, ThreadItem } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { SelectMenu } from "../shared/select-menu";

const KIND_JOB_OPTIONS = [
  { value: "message", label: "Nhắn tin (không tốn lượt LLM)" },
  { value: "agent", label: "Chạy agent (có thể dùng tool)" },
];

/**
 * Ô chọn account + cuộc trò chuyện + loại job - CHỈ dùng lúc TẠO MỚI (job đã
 * tồn tại thì đích gửi + loại job đã ghim, không sửa được nữa - brief "sửa
 * được lịch và nội dung chứ không sửa được nơi gửi"). Tách khỏi
 * `schedule-edit-drawer.tsx` để file đó không vượt ngưỡng 200 dòng.
 */
export function ScheduleDestinationFields({
  accounts,
  accountId,
  threadId,
  kind,
  onChange,
}: {
  accounts: AccountInfo[];
  accountId: string;
  threadId: string;
  kind: string;
  onChange: (patch: { accountId?: string; threadId?: string; threadType?: number; kind?: "message" | "agent" }) => void;
}) {
  const [threads, setThreads] = useState<ThreadItem[]>([]);

  useEffect(() => {
    if (!accountId) return;
    api
      .threads(accountId, "", 0)
      .then((d) => setThreads(d.items))
      .catch(() => setThreads([]));
  }, [accountId]);

  const threadOptions = threads.map((t) => ({ value: t.threadId, label: t.displayName || t.threadId }));

  return (
    <>
      <div>
        <label htmlFor="sch-account" className="mb-1.5 block text-[13px] font-medium text-ink">
          Account
        </label>
        <SelectMenu
          id="sch-account"
          value={accountId}
          options={accounts.map((a) => ({ value: a.id, label: a.label }))}
          onChange={(v) => onChange({ accountId: v, threadId: "" })}
        />
      </div>
      <div>
        <label htmlFor="sch-thread" className="mb-1.5 block text-[13px] font-medium text-ink">
          Cuộc trò chuyện <span className="font-normal text-ink-soft">(đích gửi, không đổi được sau khi tạo)</span>
        </label>
        {threadOptions.length === 0 ? (
          <p className="text-[12px] leading-[1.6] text-ink-soft">
            Account này chưa có cuộc trò chuyện nào ghi nhận - phải có ít nhất 1 tin đến trước.
          </p>
        ) : (
          <SelectMenu
            id="sch-thread"
            value={threadId}
            options={threadOptions}
            onChange={(v) =>
              onChange({ threadId: v, threadType: threads.find((t) => t.threadId === v)?.threadType ?? 0 })
            }
          />
        )}
      </div>
      <div>
        <label htmlFor="sch-kind" className="mb-1.5 block text-[13px] font-medium text-ink">
          Loại job
        </label>
        <SelectMenu
          id="sch-kind"
          value={kind}
          options={KIND_JOB_OPTIONS}
          onChange={(v) => onChange({ kind: v as "message" | "agent" })}
        />
      </div>
    </>
  );
}
