import { NavLink } from "react-router-dom";
import type { AccountInfo } from "../dashboard-api-client";

/** Sidebar theo bố cục GoClaw: logo + section + item, tone xanh Zalo */

const SECTIONS: { title: string; items: { to: string; label: string }[] }[] = [
  { title: "Tổng quan", items: [{ to: "/", label: "Overview" }] },
  {
    title: "Hội thoại",
    items: [
      { to: "/sessions", label: "Sessions" },
      { to: "/contacts", label: "Contacts" },
    ],
  },
  { title: "Dữ liệu", items: [{ to: "/memory", label: "Memory" }] },
  { title: "Hệ thống", items: [{ to: "/providers", label: "Providers" }] },
];

export function SidebarNav({
  accounts,
  selectedAccountId,
  onSelectAccount,
  onLogout,
}: {
  accounts: AccountInfo[];
  selectedAccountId: string;
  onSelectAccount: (id: string) => void;
  onLogout: () => void;
}) {
  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center gap-2 px-5 py-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-zalo-500 font-bold text-white">
          Z
        </span>
        <span className="text-lg font-semibold text-slate-900">zalo-agent</span>
      </div>

      <div className="px-4 pb-2">
        <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Account</label>
        <select
          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
          value={selectedAccountId}
          onChange={(e) => onSelectAccount(e.target.value)}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label} {a.online ? "(online)" : "(offline)"}
            </option>
          ))}
        </select>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {SECTIONS.map((section) => (
          <div key={section.title} className="mb-4">
            <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {section.title}
            </div>
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `block rounded-lg px-3 py-2 text-sm ${
                    isActive
                      ? "bg-zalo-50 font-medium text-zalo-700"
                      : "text-slate-600 hover:bg-slate-50"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <button
        onClick={onLogout}
        className="mx-4 mb-4 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
      >
        Đăng xuất
      </button>
    </aside>
  );
}
