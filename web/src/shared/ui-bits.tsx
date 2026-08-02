import type { ReactNode, SVGProps } from "react";
import { IconSearch } from "./dashboard-icons";

/** Mảnh UI dùng chung theo mẫu GoClaw: badge chấm màu, stat card + sparkline, tile, bảng */

/**
 * Núm gạt bật/tắt - phần hình của mọi toggle (drawer account, trang Tools).
 *
 * `inline-block` là bắt buộc: span mặc định là display:inline, mà width/height
 * KHÔNG áp dụng cho inline element - núm chỉ có kích thước khi cha tình cờ là
 * flex container, đặt trong nút thường thì co về 0 và biến mất hẳn.
 */
export function ToggleKnob({ on }: { on: boolean }) {
  return (
    <span
      className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-zalo-500" : "bg-slate-300 dark:bg-slate-600"}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${on ? "left-[18px]" : "left-0.5"}`}
      />
    </span>
  );
}

export function Badge({
  tone,
  dot = true,
  children,
}: {
  tone: "blue" | "gray" | "green" | "red" | "amber";
  dot?: boolean;
  children: ReactNode;
}) {
  const tones = {
    blue: { chip: "bg-zalo-50 text-zalo-700 border-zalo-100", dot: "bg-zalo-500" },
    gray: { chip: "bg-tile text-ink-soft border-line", dot: "bg-slate-400 dark:bg-slate-500" },
    green: { chip: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-900/50", dot: "bg-emerald-500" },
    red: { chip: "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-100 dark:border-red-900/50", dot: "bg-red-500" },
    amber: { chip: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-900/50", dot: "bg-amber-500" },
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${tones.chip}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${tones.dot}`} />}
      {children}
    </span>
  );
}

/** Sparkline SVG thuần từ 1 dãy số - đường mảnh + fill nhạt như mẫu */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const w = 120;
  const h = 28;
  if (values.length < 2 || values.every((v) => v === 0)) {
    return (
      <svg viewBox={`0 0 ${w} ${h}`} className={className} preserveAspectRatio="none">
        <line x1="0" y1={h - 1} x2={w} y2={h - 1} stroke="currentColor" strokeOpacity="0.25" />
      </svg>
    );
  }
  const max = Math.max(...values);
  const pts = values.map((v, i) => ({
    x: (i / (values.length - 1)) * w,
    y: h - 2 - (v / max) * (h - 6),
  }));
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} preserveAspectRatio="none">
      <path d={`${line} L${w},${h} L0,${h} Z`} fill="currentColor" fillOpacity="0.1" stroke="none" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/** Stat card theo mẫu: icon box 32px góc trên, label nhỏ, số to, sparkline đáy */
export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  series,
}: {
  icon: (p: SVGProps<SVGSVGElement> & { size?: number }) => ReactNode;
  label: string;
  value: string;
  sub?: ReactNode;
  series?: number[];
}) {
  return (
    <div className="gc-card flex flex-col p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-tile text-ink">
          <Icon size={17} />
        </span>
        <div className="min-w-0">
          <div className="text-[13px] leading-tight text-ink-soft">{label}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-[26px] font-semibold leading-none text-ink">{value}</span>
            {sub}
          </div>
        </div>
      </div>
      {series && <Sparkline values={series} className="mt-4 h-7 w-full text-zalo-500" />}
    </div>
  );
}

/** Panel lớn có header icon + title (+ subtitle) + slot phải */
export function SectionCard({
  icon: Icon,
  title,
  subtitle,
  aside,
  children,
}: {
  icon?: (p: SVGProps<SVGSVGElement> & { size?: number }) => ReactNode;
  title: string;
  /** Câu phụ dưới tiêu đề - nói panel này đang cho xem cái gì */
  subtitle?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="gc-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {Icon && (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zalo-50 text-zalo-500">
              <Icon size={19} />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[13px] text-ink-soft">{subtitle}</p>}
          </div>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * Tile nhỏ trong panel: icon + label + value (+ mô tả phụ).
 *
 * Giá trị đứng TRÊN mô tả: đọc lướt một bảng số thì mắt bắt số trước, câu giải
 * thích chỉ cần khi người ta dừng lại ở đúng ô đó.
 */
export function InfoTile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: (p: SVGProps<SVGSVGElement> & { size?: number }) => ReactNode;
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="gc-tile flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface text-zalo-500">
        <Icon size={17} />
      </span>
      <div className="min-w-0">
        <div className="text-[12px] text-ink-soft">{label}</div>
        <div className="truncate text-[15px] font-semibold text-ink">{value}</div>
        {hint && <div className="truncate text-[11px] text-ink-soft/80">{hint}</div>}
      </div>
    </div>
  );
}

export function Pager({
  page,
  hasMore,
  onPage,
}: {
  page: number;
  hasMore: boolean;
  onPage: (p: number) => void;
}) {
  const btn =
    "rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] font-medium text-ink disabled:opacity-40 hover:bg-tile";
  return (
    <div className="flex items-center gap-2">
      <button className={btn} disabled={page === 0} onClick={() => onPage(page - 1)}>
        Trước
      </button>
      <span className="text-[13px] text-ink-soft">Trang {page + 1}</span>
      <button className={btn} disabled={!hasMore} onClick={() => onPage(page + 1)}>
        Sau
      </button>
    </div>
  );
}

/**
 * Bảng cuộn ngang trên màn hẹp thay vì bóp cột cho vỡ chữ.
 * minWidth đặt theo số cột để mobile luôn có thanh cuộn thay vì wrap xấu.
 */
export function TableShell({
  headers,
  minWidth = 720,
  children,
}: {
  headers: string[];
  minWidth?: number;
  children: ReactNode;
}) {
  return (
    <div className="gc-card overflow-x-auto">
      <table className="w-full text-left text-[14px]" style={{ minWidth }}>
        <thead>
          <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-soft">
            {headers.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-4 py-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** Thanh công cụ trên bảng: tìm kiếm + bộ lọc (vd account) + phân trang */
export function ListToolbar({
  query,
  onQuery,
  placeholder,
  filter,
  page,
  hasMore,
  onPage,
}: {
  query: string;
  onQuery: (v: string) => void;
  placeholder: string;
  /** Slot bộ lọc cạnh ô search - pattern GoClaw: lọc ở đâu, hiệu lực ở đó */
  filter?: ReactNode;
  page: number;
  hasMore: boolean;
  onPage: (p: number) => void;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:w-72">
          <IconSearch
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft/60"
          />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={placeholder}
            className="gc-input w-full pl-9"
          />
        </div>
        {filter && <div className="w-full sm:w-56">{filter}</div>}
      </div>
      <Pager page={page} hasMore={hasMore} onPage={onPage} />
    </div>
  );
}

export function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center text-[14px] text-ink-soft/60">
        {text}
      </td>
    </tr>
  );
}

/** Avatar tròn chữ cái đầu - màu sinh từ tên để ổn định */
export function InitialAvatar({ name }: { name: string }) {
  const palette = ["bg-zalo-500", "bg-sky-500", "bg-indigo-500", "bg-teal-500", "bg-rose-500", "bg-amber-500"];
  const hash = [...name].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white ${palette[hash % palette.length]}`}
    >
      {initial}
    </span>
  );
}

/** "25/07 14:30" từ ISO UTC - hiển thị theo giờ máy người xem */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString("vi-VN");
}

/** "120d 1h 48m" từ giây */
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${seconds % 60}s`;
}
