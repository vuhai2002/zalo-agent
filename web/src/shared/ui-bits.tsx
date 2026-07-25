import type { ReactNode } from "react";

/** Mảnh UI nhỏ dùng chung: badge, nút phân trang, khung bảng, trạng thái rỗng */

export function Badge({ tone, children }: { tone: "blue" | "gray" | "green" | "red"; children: ReactNode }) {
  const tones = {
    blue: "bg-zalo-100 text-zalo-700",
    gray: "bg-slate-100 text-slate-600",
    green: "bg-emerald-100 text-emerald-700",
    red: "bg-red-100 text-red-700",
  };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
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
    "rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-slate-50";
  return (
    <div className="flex items-center gap-2">
      <button className={btn} disabled={page === 0} onClick={() => onPage(page - 1)}>
        Trước
      </button>
      <span className="text-sm text-slate-500">Trang {page + 1}</span>
      <button className={btn} disabled={!hasMore} onClick={() => onPage(page + 1)}>
        Sau
      </button>
    </div>
  );
}

export function TableShell({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            {headers.map((h) => (
              <th key={h} className="px-4 py-3 font-medium">
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

export function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-slate-400">
        {text}
      </td>
    </tr>
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
