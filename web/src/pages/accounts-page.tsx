import { useCallback, useEffect, useState } from "react";
import type { ManagedAccount, ManagedAgent } from "../dashboard-api-client";
import { api, ApiError } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { IconSignal } from "../shared/dashboard-icons";
import { useConfirmDialog } from "../shared/confirm-dialog";
import { Badge, InitialAvatar } from "../shared/ui-bits";
import { AccountEditDrawer } from "./account-edit-drawer";
import { QrLoginModal } from "./qr-login-modal";

/** Trang Accounts: tài khoản Zalo (kênh) - thêm, đổi tên, bật/tắt, gắn não, login QR */
export function AccountsPage() {
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [agents, setAgents] = useState<ManagedAgent[]>([]);
  const [editing, setEditing] = useState<ManagedAccount | null>(null);
  const [creating, setCreating] = useState(false);
  const [qrAccount, setQrAccount] = useState<ManagedAccount | null>(null);
  const [notice, setNotice] = useState<{ tone: "red" | "amber"; text: string } | null>(null);
  const { confirm, confirmDialog } = useConfirmDialog();

  const reload = useCallback(async () => {
    const [accs, ags] = await Promise.all([api.accountsAdmin.list(), api.agentsAdmin.list()]);
    setAccounts(accs.items);
    setAgents(ags.items);
  }, []);

  useEffect(() => {
    reload().catch(() => setNotice({ tone: "red", text: "Không tải được danh sách" }));
  }, [reload]);

  async function toggleEnabled(acc: ManagedAccount) {
    setNotice(null);
    const result = await api.accountsAdmin.update(acc.id, { enabled: !acc.enabled });
    if (result.warning) setNotice({ tone: "amber", text: result.warning });
    await reload();
  }

  async function remove(acc: ManagedAccount) {
    const ok = await confirm({
      title: `Xóa account "${acc.label}"?`,
      message: "Credentials đăng nhập Zalo sẽ bị xóa, lịch sử hội thoại vẫn giữ lại.",
    });
    if (!ok) return;
    setNotice(null);
    try {
      await api.accountsAdmin.remove(acc.id);
      await reload();
    } catch (err) {
      setNotice({ tone: "red", text: err instanceof ApiError ? err.message : "Xóa thất bại" });
    }
  }

  const agentName = (id: string) => agents.find((a) => a.id === id);

  return (
    <div>
      <PageHeader
        icon={IconSignal}
        title="Accounts"
        subtitle="Tài khoản Zalo của bot - mỗi account gắn một agent (não) và có policies riêng"
        aside={
          <button
            onClick={() => setCreating(true)}
            className="rounded-lg bg-zalo-500 px-4 py-2 text-[14px] font-medium text-white hover:bg-zalo-600"
          >
            Thêm account
          </button>
        }
      />

      {notice && (
        <p className={`mb-4 text-[13px] ${notice.tone === "red" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>
          {notice.text}
        </p>
      )}

      <div className="space-y-3">
        {accounts.length === 0 && (
          <div className="gc-card px-5 py-10 text-center text-ink-soft">
            Chưa có account nào - bấm "Thêm account" rồi quét QR để bot lên sóng
          </div>
        )}
        {accounts.map((acc) => {
          const agent = agentName(acc.agentId);
          return (
            <div key={acc.id} className="gc-card flex flex-wrap items-center gap-4 px-5 py-4">
              <InitialAvatar name={acc.label} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink">{acc.label}</span>
                  {acc.running ? (
                    <Badge tone="green">Đang chạy</Badge>
                  ) : acc.hasCredentials ? (
                    <Badge tone="gray">Đã login, chưa chạy</Badge>
                  ) : (
                    <Badge tone="amber">Chưa login QR</Badge>
                  )}
                </div>
                <div className="mt-0.5 text-[12px] text-ink-soft">
                  {acc.id} · não: {agent ? `${agent.icon} ${agent.name}` : acc.agentId}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleEnabled(acc)}
                  className={`relative h-5 w-9 rounded-full transition-colors ${
                    acc.enabled ? "bg-zalo-500" : "bg-slate-300 dark:bg-slate-600"
                  }`}
                  title={acc.enabled ? "Đang bật - bấm để tắt" : "Đang tắt - bấm để bật"}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${
                      acc.enabled ? "left-[18px]" : "left-0.5"
                    }`}
                  />
                </button>
                <button
                  onClick={() => setQrAccount(acc)}
                  className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-zalo-600 hover:bg-zalo-50"
                >
                  Login QR
                </button>
                <button
                  onClick={() => setEditing(acc)}
                  className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-tile"
                >
                  Sửa
                </button>
                <button
                  onClick={() => remove(acc)}
                  className="rounded-lg px-3 py-1.5 text-[13px] text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                >
                  Xóa
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {(editing || creating) && (
        <AccountEditDrawer
          account={editing}
          agents={agents}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            setEditing(null);
            setCreating(false);
            void reload();
          }}
        />
      )}

      {qrAccount && (
        <QrLoginModal
          account={qrAccount}
          onClose={() => {
            setQrAccount(null);
            void reload();
          }}
        />
      )}

      {confirmDialog}
    </div>
  );
}
