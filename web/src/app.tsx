import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
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
import { IconMenu } from "./shared/dashboard-icons";

/** Khung chính sau đăng nhập: sidebar + account đang chọn + nội dung trang */
function DashboardShell() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [checked, setChecked] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    api
      .overview()
      .then((data) => {
        setAccounts(data.accounts);
        setSelectedAccountId((prev) => prev || data.accounts[0]?.id || "");
        setChecked(true);
      })
      .catch(() => navigate("/login"));
  }, [navigate]);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    navigate("/login");
  }, [navigate]);

  if (!checked) return null;

  const currentAccount = accounts.find((a) => a.id === selectedAccountId);

  return (
    <div className="flex min-h-[100dvh] bg-canvas">
      <SidebarNav
        accounts={accounts}
        selectedAccountId={selectedAccountId}
        onSelectAccount={setSelectedAccountId}
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
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zalo-500 text-[13px] font-bold text-white">
            Z
          </span>
          <span className="truncate text-[15px] font-semibold text-ink">
            {currentAccount?.label ?? "zalo-agent"}
          </span>
        </header>

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:overflow-y-auto lg:px-8 lg:py-7">
          <Routes>
            <Route path="/" element={<OverviewPage selectedAccountId={selectedAccountId} />} />
            <Route path="/sessions" element={<SessionsPage selectedAccountId={selectedAccountId} />} />
            <Route path="/contacts" element={<ContactsPage selectedAccountId={selectedAccountId} />} />
            <Route path="/memory" element={<MemoryPage selectedAccountId={selectedAccountId} />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/agents" element={<AgentsPage />} />
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
