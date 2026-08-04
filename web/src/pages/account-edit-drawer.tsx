import { useEffect, useState } from "react";
import type { ManagedAccount, ManagedAgent, ReactionIcon } from "../dashboard-api-client";
import { api, ApiError } from "../dashboard-api-client";
import { useChotNen } from "../shared/backdrop-close-guard";
import { SelectMenu } from "../shared/select-menu";
import { ToggleKnob } from "../shared/ui-bits";

function Toggle({ value, onChange, label, hint }: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button type="button" onClick={() => onChange(!value)} className="flex w-full items-center justify-between gap-3 py-1 text-left">
      <span>
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        {hint && <span className="block text-[12px] leading-[1.6] text-ink-soft">{hint}</span>}
      </span>
      <ToggleKnob on={value} />
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
    autoReactEnabled: account?.autoReactEnabled ?? true,
    autoReactIcon: account?.autoReactIcon ?? "heart",
    typingIndicatorEnabled: account?.typingIndicatorEnabled ?? true,
    allowlistMode: account?.allowlist.mode ?? "all",
    allowlistIds: (account?.allowlist.userIds ?? []).join("\n"),
  });
  const [reactionIcons, setReactionIcons] = useState<ReactionIcon[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nen = useChotNen(onClose);

  useEffect(() => {
    api.accountsAdmin
      .reactionIcons()
      .then((d) => setReactionIcons(d.items))
      .catch(() => setReactionIcons([]));
  }, []);

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
      autoReactEnabled: form.autoReactEnabled,
      autoReactIcon: form.autoReactIcon,
      typingIndicatorEnabled: form.typingIndicatorEnabled,
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
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/25 backdrop-blur-[2px]" {...nen}>
      <div className="flex h-full w-full max-w-md flex-col border-l border-line bg-surface">
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
                placeholder="vd: acc-cham-soc"
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-ink">Tên hiển thị</label>
            <input
              className="gc-input w-full"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="vd: Nick chăm sóc khách hàng"
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
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
              Phản hồi tức thì
            </div>
            <Toggle
              value={form.typingIndicatorEnabled}
              onChange={(v) => setForm({ ...form, typingIndicatorEnabled: v })}
              label='Hiện "đang nhập" khi bot xử lý'
              hint="Giống người thật đang gõ, tự tắt khi gửi xong"
            />
            <Toggle
              value={form.autoReactEnabled}
              onChange={(v) => setForm({ ...form, autoReactEnabled: v })}
              label="Thả cảm xúc khi nhận tin"
              hint="Báo cho người nhắn biết bot đã thấy tin"
            />
            {form.autoReactEnabled && reactionIcons.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {reactionIcons.map((icon) => (
                  <button
                    key={icon.key}
                    type="button"
                    title={icon.label}
                    onClick={() => setForm({ ...form, autoReactIcon: icon.key })}
                    className={`flex h-9 w-9 items-center justify-center rounded-lg border text-lg transition-colors ${
                      form.autoReactIcon === icon.key
                        ? "border-zalo-500 bg-zalo-50 ring-2 ring-zalo-100"
                        : "border-line hover:bg-tile"
                    }`}
                  >
                    {icon.emoji}
                  </button>
                ))}
              </div>
            )}
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
                placeholder={"Mỗi dòng 1 user ID\n1234567890123456789"}
              />
            )}
          </div>

          {error && <p className="text-[13px] text-red-600 dark:text-red-400">{error}</p>}
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
