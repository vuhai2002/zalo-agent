import { useEffect, useMemo, useState } from "react";
import type { ManagedAccount, ToolCatalogItem } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { SelectMenu } from "../shared/select-menu";
import { Badge, ToggleKnob } from "../shared/ui-bits";

/**
 * Trang Tools theo mẫu Built-in Tools của GoClaw: tool nhóm theo mức rủi ro,
 * mỗi dòng 1 toggle. Trạng thái bật/tắt lưu per account (cột disabled_tools) -
 * chọn account ở góc phải rồi gạt.
 */

const GROUP_META: Record<ToolCatalogItem["group"], { title: string; hint: string }> = {
  read: { title: "Đọc & tra cứu", hint: "Không tác động ra ngoài - an toàn bật mặc định" },
  action: { title: "Hành động", hint: "Gửi/sửa thứ gì đó trên Zalo - cân nhắc theo account" },
};

export function ToolsPage() {
  const [tools, setTools] = useState<ToolCatalogItem[]>([]);
  const [webSearchProvider, setWebSearchProvider] = useState("");
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.tools(), api.accountsAdmin.list()])
      .then(([toolsRes, accountsRes]) => {
        setTools(toolsRes.items);
        setWebSearchProvider(toolsRes.webSearchProvider);
        setAccounts(accountsRes.items);
        if (accountsRes.items[0]) setAccountId(accountsRes.items[0].id);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const account = useMemo(() => accounts.find((a) => a.id === accountId), [accounts, accountId]);

  async function toggleTool(toolKey: string) {
    if (!account || saving) return;
    const disabled = new Set(account.disabledTools);
    if (disabled.has(toolKey)) disabled.delete(toolKey);
    else disabled.add(toolKey);
    const disabledTools = [...disabled];

    setSaving(toolKey);
    setError("");
    try {
      const res = await api.accountsAdmin.update(account.id, { disabledTools });
      setAccounts((prev) => prev.map((a) => (a.id === account.id ? res.account : a)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  const groups = (["read", "action"] as const).map((g) => ({
    group: g,
    items: tools.filter((t) => t.group === g),
  }));

  return (
    <>
      <PageHeader
        title="Tools"
        subtitle="Bật/tắt khả năng của bot cho từng account - tool tắt sẽ không xuất hiện với model"
        aside={
          accounts.length > 0 ? (
            <SelectMenu
              value={accountId}
              onChange={setAccountId}
              ariaLabel="Chọn account"
              options={accounts.map((a) => ({
                value: a.id,
                label: a.label,
                dotClass: a.running ? "bg-emerald-500" : "bg-slate-300",
              }))}
            />
          ) : undefined
        }
      />

      {error && (
        <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-[13px] text-red-700">
          {error}
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="gc-card px-5 py-10 text-center text-[14px] text-ink-soft">
          Chưa có account nào - tạo account ở trang Accounts trước.
        </div>
      ) : (
        groups.map(({ group, items }) => (
          <section key={group} className="mb-6">
            {/* Mobile: hint xuống dòng riêng - đứng cạnh sẽ bóp tiêu đề wrap giữa chữ */}
            <div className="mb-2 flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2.5">
              <h2 className="text-[15px] font-semibold text-ink">{GROUP_META[group].title}</h2>
              <span className="text-xs text-ink-soft">{GROUP_META[group].hint}</span>
            </div>

            <div className="gc-card divide-y divide-line">
              {items.map((tool) => {
                const enabled = !account?.disabledTools.includes(tool.key);
                return (
                  <button
                    key={tool.key}
                    type="button"
                    disabled={saving !== null}
                    onClick={() => toggleTool(tool.key)}
                    className="flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left transition-colors hover:bg-tile/50 disabled:cursor-wait"
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[14px] font-medium text-ink">{tool.label}</span>
                        <code className="rounded bg-tile px-1.5 py-0.5 text-[11px] text-ink-soft">
                          {tool.key}
                        </code>
                        {tool.key === "web_search" && webSearchProvider && (
                          <Badge tone="blue" dot={false}>
                            {webSearchProvider}
                          </Badge>
                        )}
                      </span>
                      <span className="mt-0.5 block text-[12.5px] text-ink-soft">
                        {tool.description}
                      </span>
                    </span>
                    <ToggleKnob on={enabled} />
                  </button>
                );
              })}
            </div>
          </section>
        ))
      )}
    </>
  );
}
