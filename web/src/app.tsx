import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import type { AccountInfo } from "./dashboard-api-client";
import { api } from "./dashboard-api-client";
import { SidebarNav } from "./layout/sidebar-nav";
import { AccountsPage } from "./pages/accounts-page";
import { AgentsPage } from "./pages/agents-page";
import { ContactsPage } from "./pages/contacts-page";
import { LoginPage } from "./pages/login-page";
import { MemoryPage } from "./pages/memory-page";
import { OverviewPage } from "./pages/overview-page";
import { ProvidersPage } from "./pages/providers-page";
import { SessionsPage } from "./pages/sessions-page";
import { ToolsPage } from "./pages/tools-page";
import { IconMenu } from "./shared/dashboard-icons";

/**
 * Khung chính sau đăng nhập. Không có "account đang chọn" toàn cục - các trang
 * dữ liệu mặc định xem trộn mọi account, lọc bằng dropdown ngay trong trang
 * (theo pattern GoClaw); sidebar chỉ còn điều hướng.
 */
function DashboardShell() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [checked, setChecked] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    api
      .overview()
      .then((data) => {
        setAccounts(data.accounts);
        setChecked(true);
      })
      .catch(() => navigate("/login"));
  }, [navigate]);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    navigate("/login");
  }, [navigate]);

  if (!checked) return null;

  return (
    <div className="flex min-h-[100dvh] bg-canvas">
      <SidebarNav
        online={accounts.some((a) => a.online)}
        onLogout={logout}
        mobileOpen={menuOpen}
        onCloseMobile={() => setMenuOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col lg:h-screen lg:overflow-hidden">
        {/* Topbar chỉ ở mobile - desktop đã có sidebar cố định */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Mở menu"
            className="rounded-lg p-1.5 text-ink-soft hover:bg-tile hover:text-ink"
          >
            <IconMenu size={20} />
          </button>
          <Link to="/" className="flex items-center gap-2" title="Về trang chính">
            <img
              src="/zalo-agent-icon.webp"
              alt="Zalo Agent"
              width={128}
              height={128}
              className="h-7 w-7"
            />
            <span className="truncate text-[15px] font-semibold text-ink">Zalo Agent</span>
          </Link>
        </header>

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:overflow-y-auto lg:px-8 lg:py-7">
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/sessions" element={<SessionsPage accounts={accounts} />} />
            <Route path="/contacts" element={<ContactsPage accounts={accounts} />} />
            <Route path="/memory" element={<MemoryPage accounts={accounts} />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/tools" element={<ToolsPage />} />
            <Route path="/providers" element={<ProvidersPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/*" element={<DashboardShell />} />
      </Routes>
    </BrowserRouter>
  );
}
