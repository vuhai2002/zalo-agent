import { useState } from "react";
import type { LogEntry } from "../dashboard-api-client";

/**
 * Một dòng log trên trang Logs: giờ, mức, scope, nội dung, và nút mở phần
 * trường phụ (threadId, accountId, err...).
 *
 * Tách khỏi `logs-page.tsx` để file kia còn đúng phần nạp dữ liệu và phân
 * trang - đây là phần trình bày thuần, không dính state của trang.
 */

/** Nhãn + màu theo mức pino (10 trace, 20 debug, 30 info, 40 warn, 50 error) */
function nhanMuc(level: number): { text: string; lop: string } {
  if (level >= 50) return { text: "ERROR", lop: "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-100 dark:border-red-900/50" };
  if (level >= 40) return { text: "WARN", lop: "bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 border-amber-100 dark:border-amber-900/50" };
  if (level >= 30) return { text: "INFO", lop: "bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-100 dark:border-sky-900/50" };
  return { text: "DEBUG", lop: "bg-tile text-ink-soft border-line" };
}

function gioPhut(time: number): string {
  if (!time) return "";
  const d = new Date(time);
  return d.toLocaleTimeString("vi-VN", { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
}

export function DongLog({ e }: { e: LogEntry }) {
  const [mo, setMo] = useState(false);
  const muc = nhanMuc(e.level);
  const coTruongPhu = Object.keys(e.fields).length > 0;

  return (
    <div className="border-b border-line/70 px-4 py-2 last:border-0 hover:bg-tile/50">
      <div className="flex items-start gap-2.5">
        <span className="shrink-0 pt-0.5 font-mono text-[11px] text-ink-soft/60">{gioPhut(e.time)}</span>
        <span
          className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${muc.lop}`}
        >
          {muc.text}
        </span>
        <span className="shrink-0 rounded bg-tile px-1.5 py-0.5 text-[11px] text-ink-soft">
          {e.scope}
        </span>
        <span className="min-w-0 flex-1 break-words text-[13px] text-ink">{e.msg}</span>
        {coTruongPhu && (
          <button
            type="button"
            onClick={() => setMo((v) => !v)}
            className="shrink-0 text-[11px] text-ink-soft hover:text-ink"
          >
            {mo ? "Thu gọn" : "Chi tiết"}
          </button>
        )}
      </div>
      {mo && coTruongPhu && (
        <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-tile px-3 py-2 text-[11px] leading-relaxed text-ink-soft">
          {JSON.stringify(e.fields, null, 2)}
        </pre>
      )}
    </div>
  );
}
