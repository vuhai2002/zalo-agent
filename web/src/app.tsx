import { useCallback, useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import type { AccountInfo } from "./dashboard-api-client";
import { api } from "./dashboard-api-client";
import { SidebarNav } from "./layout/sidebar-nav";
import { ContactsPage } from "./pages/contacts-page";
import { LoginPage } from "./pages/login-page";
import { MemoryPage } from "./pages/memory-page";
import { OverviewPage } from "./pages/overview-page";
import { ProvidersPage } from "./pages/providers-page";
import { SessionsPage } from "./pages/sessions-page";

/** Khung chính sau đăng nhập: sidebar + account đang chọn + nội dung trang */
function DashboardShell() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [checked, setChecked] = useState(false);

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

  return (
    <div className="flex min-h-screen">
      <SidebarNav
        accounts={accounts}
        selectedAccountId={selectedAccountId}
        onSelectAccount={setSelectedAccountId}
        onLogout={logout}
      />
      <main className="flex-1 overflow-y-auto px-8 py-6">
        <Routes>
          <Route path="/" element={<OverviewPage selectedAccountId={selectedAccountId} />} />
          <Route path="/sessions" element={<SessionsPage selectedAccountId={selectedAccountId} />} />
          <Route path="/contacts" element={<ContactsPage selectedAccountId={selectedAccountId} />} />
          <Route path="/memory" element={<MemoryPage selectedAccountId={selectedAccountId} />} />
          <Route path="/providers" element={<ProvidersPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/*" element={<DashboardShell />} />
      </Routes>
    </HashRouter>
  );
}
