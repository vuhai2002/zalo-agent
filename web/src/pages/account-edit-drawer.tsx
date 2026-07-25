import { useState } from "react";
import type { ManagedAccount, ManagedAgent } from "../dashboard-api-client";
import { api, ApiError } from "../dashboard-api-client";
import { SelectMenu } from "../shared/select-menu";

function Toggle({ value, onChange, label, hint }: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button type="button" onClick={() => onChange(!value)} className="flex w-full items-center justify-between gap-3 py-1 text-left">
      <span>
        <span className="block text-[13.5px] font-medium text-ink">{label}</span>
        {hint && <span className="block text-xs text-ink-soft">{hint}</span>}
      </span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${value ? "bg-zalo-500" : "bg-slate-300"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${value ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

/** Drawer tạo/sửa account: tên, não, policies. account=null nghĩa là tạo mới. */
export function AccountEditDrawer({
  account,
  agents,
  onClose,
  onSaved,
}: {
  account: ManagedAccount | null;
  agents: ManagedAgent[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    id: account?.id ?? "",
    label: account?.label ?? "",
    agentId: account?.agentId ?? agents.find((a) => a.isDefault)?.id ?? agents[0]?.id ?? "",
    groupRequireMention: account?.groupRequireMention ?? true,
    respondToGroups: account?.respondToGroups ?? true,
    groupPassiveListen: account?.groupPassiveListen ?? true,
    allowlistMode: account?.allowlist.mode ?? "all",
    allowlistIds: (account?.allowlist.userIds ?? []).join("\n"),
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const agentOptions = agents.map((a) => ({
    value: a.id,
    label: `${a.icon} ${a.name}`,
    hint: a.isDefault ? "mặc định" : undefined,
  }));

  async function save() {
    setBusy(true);
    setError("");
    const patch = {
      label: form.label,
      agentId: form.agentId,
      groupRequireMention: form.groupRequireMention,
      respondToGroups: form.respondToGroups,
      groupPassiveListen: form.groupPassiveListen,
      allowlist: {
        mode: form.allowlistMode as "all" | "list",
        userIds: form.allowlistIds.split("\n").map((s) => s.trim()).filter(Boolean),
      },
    };
    try {
      if (account) {
        await api.accountsAdmin.update(account.id, patch);
      } else {
        await api.accountsAdmin.create({ id: form.id, label: form.label, agentId: form.agentId });
        await api.accountsAdmin.update(form.id, patch);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Lưu thất bại");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/25 backdrop-blur-[2px]" onClick={onClose}>
      <div className="flex h-full w-full max-w-md flex-col border-l border-line bg-white" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="font-semibold text-ink">{account ? `Sửa: ${account.label}` : "Thêm account Zalo"}</div>
          <button onClick={onClose} className="rounded-lg border border-line px-3 py-1 text-[13px] text-ink-soft hover:bg-tile">
            Đóng
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {!account && (
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-ink">
                ID <span className="font-normal text-ink-soft">(kebab-case, dùng làm thư mục data)</span>
              </label>
              <input
                className="gc-input w-full"
                value={form.id}
                onChange={(e) => setForm({ ...form, id: e.target.value })}
                placeholder="vd: acc-tu-van"
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-ink">Tên hiển thị</label>
            <input
              className="gc-input w-full"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="vd: Nick tư vấn CES"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-ink">Agent (não)</label>
            <SelectMenu
              value={form.agentId}
              options={agentOptions}
              onChange={(agentId) => setForm({ ...form, agentId })}
            />
          </div>

          <div className="space-y-2 rounded-xl border border-line p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">Policies</div>
            <Toggle
              value={form.respondToGroups}
              onChange={(v) => setForm({ ...form, respondToGroups: v })}
              label="Trả lời trong nhóm"
            />
            <Toggle
              value={form.groupRequireMention}
              onChange={(v) => setForm({ ...form, groupRequireMention: v })}
              label="Nhóm phải @mention mới trả lời"
            />
            <Toggle
              value={form.groupPassiveListen}
              onChange={(v) => setForm({ ...form, groupPassiveListen: v })}
              label="Nghe passive trong nhóm"
              hint="Tin không @mention vẫn ghi vào ngữ cảnh, không tốn LLM"
            />
          </div>

          <div className="space-y-2 rounded-xl border border-line p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">Allowlist</div>
            <SelectMenu
              value={form.allowlistMode}
              options={[
                { value: "all", label: "Trả lời tất cả mọi người" },
                { value: "list", label: "Chỉ trả lời user ID trong danh sách" },
              ]}
              onChange={(allowlistMode) => setForm({ ...form, allowlistMode: allowlistMode as "all" | "list" })}
            />
            {form.allowlistMode === "list" && (
              <textarea
                className="gc-input min-h-24 w-full resize-y"
                value={form.allowlistIds}
                onChange={(e) => setForm({ ...form, allowlistIds: e.target.value })}
                placeholder={"Mỗi dòng 1 user ID\n8771577400486544398"}
              />
            )}
          </div>

          {error && <p className="text-[13px] text-red-600">{error}</p>}
        </div>

        <div className="border-t border-line px-5 py-4">
          <button
            onClick={save}
            disabled={busy || !form.label || (!account && !form.id)}
            className="w-full rounded-lg bg-zalo-500 py-2.5 text-[14px] font-medium text-white hover:bg-zalo-600 disabled:opacity-50"
          >
            {busy ? "Đang lưu..." : account ? "Lưu thay đổi" : "Tạo account"}
          </button>
        </div>
      </div>
    </div>
  );
}
