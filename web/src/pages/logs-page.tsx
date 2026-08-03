import { useEffect, useState } from "react";
import type { LogEntry } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { IconDatabase } from "../shared/dashboard-icons";
import { SelectMenu } from "../shared/select-menu";

/**
 * Log toàn hệ thống, đọc từ file `data/logs/bot.<ngày>.log`.
 *
 * Khác trang Trace: Trace chỉ có lượt agent, còn đây là MỌI thứ - kết nối Zalo,
 * login QR, định tuyến tin, lỗi của 30 scope trong hệ thống.
 *
 * File ghi cả mức debug bất kể LOG_LEVEL của terminal, nên xem ở đây luôn đầy
 * đủ hơn nhìn terminal.
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

function DongLog({ e }: { e: LogEntry }) {
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

const MUC_LOC = [
  { value: "", label: "Mọi mức" },
  { value: "debug", label: "Debug trở lên" },
  { value: "info", label: "Info trở lên" },
  { value: "warn", label: "Warn trở lên" },
  { value: "error", label: "Chỉ Error" },
];

export function LogsPage() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [scopes, setScopes] = useState<string[]>([]);
  const [tat, setTat] = useState(false);
  const [goiY, setGoiY] = useState("");
  const [level, setLevel] = useState("");
  const [scope, setScope] = useState("");
  const [search, setSearch] = useState("");
  const [dangTai, setDangTai] = useState(true);
  const [loi, setLoi] = useState("");

  async function nap() {
    setDangTai(true);
    setLoi("");
    try {
      const r = await api.logs({ level, scope, search, limit: 300 });
      setEntries(r.entries);
      // Danh sách scope chỉ nạp khi CHƯA lọc, không thì lọc xong ô chọn rỗng dần
      if (!scope && !search) setScopes(r.scopes);
      setTat(r.disabled);
      setGoiY(r.hint ?? "");
    } catch (e) {
      setLoi(e instanceof Error ? e.message : String(e));
    } finally {
      setDangTai(false);
    }
  }

  useEffect(() => {
    void nap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, scope]);

  return (
    <>
      <PageHeader
        icon={IconDatabase}
        title="Logs"
        subtitle="Log toàn hệ thống đọc từ file. File ghi cả mức debug nên đầy đủ hơn nhìn terminal."
      />

      {tat && (
        <div className="mb-4 rounded-xl border border-amber-100 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/40 px-4 py-2.5 text-[13px] text-amber-800 dark:text-amber-200">
          {goiY || "Ghi log ra file đang tắt"}
        </div>
      )}
      {loi && (
        <div className="mb-4 rounded-xl border border-red-100 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-[13px] text-red-700 dark:text-red-300">
          {loi}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="min-w-[150px]">
          <SelectMenu value={level} onChange={setLevel} options={MUC_LOC} ariaLabel="Lọc theo mức" />
        </div>
        <div className="min-w-[170px]">
          <SelectMenu
            value={scope}
            onChange={setScope}
            options={[
              { value: "", label: "Mọi scope" },
              ...scopes.map((s) => ({ value: s, label: s })),
            ]}
            ariaLabel="Lọc theo scope"
          />
        </div>
        <input
          className="gc-input min-w-[200px] flex-1"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void nap()}
          placeholder="Tìm trong log rồi Enter..."
        />
        <button
          type="button"
          onClick={() => void nap()}
          disabled={dangTai}
          className="rounded-lg border border-line bg-surface px-4 py-2 text-[13px] font-medium text-ink hover:bg-tile disabled:opacity-50"
        >
          {dangTai ? "Đang tải..." : "Tải lại"}
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        {entries.map((e, i) => (
          <DongLog key={i} e={e} />
        ))}
        {entries.length === 0 && !dangTai && !tat && (
          <p className="py-10 text-center text-[13px] text-ink-soft/60">
            Không có dòng log nào khớp.
          </p>
        )}
      </div>
    </>
  );
}
