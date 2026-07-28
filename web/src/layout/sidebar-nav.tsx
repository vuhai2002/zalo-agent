import type { ReactNode, SVGProps } from "react";
import { NavLink } from "react-router-dom";
import {
  IconBolt,
  IconCpu,
  IconDatabase,
  IconBot,
  IconBrain,
  IconChat,
  IconClose,
  IconGrid,
  IconLogout,
  IconSignal,
  IconSliders,
  IconUsers,
} from "../shared/dashboard-icons";

/**
 * Sidebar theo mẫu GoClaw. Từ lg trở lên: cột cố định trong layout.
 * Dưới lg: drawer trượt từ trái, mở bằng nút hamburger ở topbar mobile.
 */

type IconFn = (p: SVGProps<SVGSVGElement> & { size?: number }) => ReactNode;

const SECTIONS: { title: string; items: { to: string; label: string; icon: IconFn }[] }[] = [
  { title: "Core", items: [{ to: "/", label: "Overview", icon: IconGrid }] },
  {
    title: "Hội thoại",
    items: [
      { to: "/sessions", label: "Sessions", icon: IconChat },
      { to: "/contacts", label: "Contacts", icon: IconUsers },
    ],
  },
  { title: "Dữ liệu", items: [{ to: "/memory", label: "Memory", icon: IconBrain }] },
  {
    title: "Hệ thống",
    items: [
      { to: "/accounts", label: "Accounts", icon: IconSignal },
      { to: "/agents", label: "Agents", icon: IconBot },
      { to: "/tools", label: "Tools", icon: IconBolt },
      { to: "/trace", label: "Trace agent", icon: IconCpu },
      { to: "/logs", label: "Logs", icon: IconDatabase },
      { to: "/providers", label: "Providers", icon: IconSliders },
    ],
  },
];

export function SidebarNav({
  online,
  onLogout,
  mobileOpen,
  onCloseMobile,
}: {
  /** Có ít nhất 1 account Zalo đang chạy - cho chấm trạng thái ở footer */
  online: boolean;
  onLogout: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  return (
    <>
      {/* Backdrop chỉ tồn tại ở mobile khi drawer mở */}
      {mobileOpen && (
        <button
          aria-label="Đóng menu"
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-[2px] lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-line bg-white transition-transform duration-200 lg:static lg:z-auto lg:w-60 lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
          <NavLink
            to="/"
            onClick={onCloseMobile}
            className="flex items-center gap-2.5"
            title="Về trang chính"
          >
            <img
              src="/zalo-agent-icon.webp"
              alt="Zalo Agent"
              width={128}
              height={128}
              className="h-9 w-9"
            />
            <span className="text-[17px] font-bold tracking-tight text-ink">Zalo Agent</span>
          </NavLink>
          <button
            onClick={onCloseMobile}
            aria-label="Đóng menu"
            className="ml-auto rounded-lg p-1.5 text-ink-soft hover:bg-tile lg:hidden"
          >
            <IconClose size={17} />
          </button>
        </div>

        <nav className="mt-1 flex-1 overflow-y-auto px-3">
          {SECTIONS.map((section) => (
            <div key={section.title} className="mb-5">
              <div className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-soft/70">
                {section.title}
              </div>
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  onClick={onCloseMobile}
                  className={({ isActive }) =>
                    `mb-0.5 flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[14px] transition-colors ${
                      isActive
                        ? "bg-zalo-50 font-medium text-zalo-700"
                        : "text-ink-soft hover:bg-tile hover:text-ink"
                    }`
                  }
                >
                  <item.icon size={17} />
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="flex items-center justify-between border-t border-line px-4 py-3">
          <span className="flex items-center gap-2 text-[12px] text-ink-soft">
            <span className={`h-2 w-2 rounded-full ${online ? "bg-emerald-500" : "bg-slate-300"}`} />
            {online ? "Connected" : "Offline"} · v0.1.0
          </span>
          <button
            onClick={onLogout}
            title="Đăng xuất"
            className="rounded-lg p-1.5 text-ink-soft hover:bg-tile hover:text-ink"
          >
            <IconLogout size={16} />
          </button>
        </div>
      </aside>
    </>
  );
}
