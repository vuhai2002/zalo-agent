import { useEffect, useMemo, useState } from "react";
import type {
  FetchSettings,
  ManagedAccount,
  SearchSettings,
  ToolCatalogItem,
} from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { IconSliders } from "../shared/dashboard-icons";
import { SelectMenu } from "../shared/select-menu";
import { Badge, ToggleKnob } from "../shared/ui-bits";
import { ToolChainSettingsModal } from "./tool-chain-settings-modal";

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
  const [search, setSearch] = useState<SearchSettings | null>(null);
  const [fetchSettings, setFetchSettings] = useState<FetchSettings | null>(null);
  const [settingsFor, setSettingsFor] = useState<ToolCatalogItem | null>(null);
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.tools(), api.accountsAdmin.list()])
      .then(([toolsRes, accountsRes]) => {
        setTools(toolsRes.items);
        setSearch(toolsRes.search);
        setFetchSettings(toolsRes.fetch);
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
                  // Không lồng button trong button (HTML không hợp lệ) nên hàng
                  // là div, Settings và toggle là 2 nút riêng - đúng bố cục GoClaw
                  <div
                    key={tool.key}
                    className="flex w-full items-center justify-between gap-4 px-5 py-3.5"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[14px] font-medium text-ink">{tool.label}</span>
                        <code className="rounded bg-tile px-1.5 py-0.5 text-[11px] text-ink-soft">
                          {tool.key}
                        </code>
                        {tool.key === "web_search" && search && (
                          <Badge tone="blue" dot={false}>
                            {search.provider === "brave"
                              ? "Brave + DuckDuckGo"
                              : "DuckDuckGo (miễn phí)"}
                          </Badge>
                        )}
                        {/* Bật mà thiếu hạ tầng thì model KHÔNG nhận được tool -
                            phải nói thẳng, không để người dùng tưởng bot có khả năng đó */}
                        {!tool.available && <Badge tone="amber">Chưa dùng được</Badge>}
                      </div>
                      <p className="mt-0.5 text-[12.5px] text-ink-soft">{tool.description}</p>
                      {!tool.available && tool.unavailableHint && (
                        <p className="mt-1 text-[12.5px] text-amber-700">{tool.unavailableHint}</p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2.5">
                      {tool.hasSettings && (
                        <button
                          type="button"
                          onClick={() => setSettingsFor(tool)}
                          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-ink-soft transition-colors hover:bg-tile hover:text-ink"
                        >
                          <IconSliders size={15} />
                          Settings
                        </button>
                      )}
                      {/* Vẫn bấm được khi chưa dùng được (đặt sẵn cho account là
                          hợp lệ) nhưng làm mờ để báo "cài đặt này chưa có hiệu lực" */}
                      <button
                        type="button"
                        disabled={saving !== null}
                        onClick={() => toggleTool(tool.key)}
                        aria-label={`Bật tắt ${tool.label}`}
                        title={tool.available ? undefined : tool.unavailableHint}
                        className={`disabled:cursor-wait ${tool.available ? "" : "opacity-50"}`}
                      >
                        <ToggleKnob on={enabled} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}

      {settingsFor && search && fetchSettings && (
        <ToolChainSettingsModal
          tool={settingsFor}
          search={search}
          fetchSettings={fetchSettings}
          onClose={() => setSettingsFor(null)}
          onSaved={(next) => {
            if (next.search) setSearch(next.search);
            if (next.fetch) setFetchSettings(next.fetch);
          }}
        />
      )}
    </>
  );
}
