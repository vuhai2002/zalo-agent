import { useEffect, useMemo, useState } from "react";
import type {
  FetchSettings,
  ImageGenSettings,
  ManagedAccount,
  SearchSettings,
  ToolCatalogItem,
  VisionSettings,
} from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { IconSliders } from "../shared/dashboard-icons";
import { SelectMenu } from "../shared/select-menu";
import { Badge, ToggleKnob } from "../shared/ui-bits";
import { ImageSettingsModal } from "./image-settings-modal";
import { ToolChainSettingsModal } from "./tool-chain-settings-modal";
import { VisionSettingsModal } from "./vision-settings-modal";

/**
 * Trang Tools theo mẫu Built-in Tools của GoClaw: tool nhóm theo mức rủi ro,
 * mỗi dòng 1 toggle. Trạng thái bật/tắt lưu per account (cột disabled_tools) -
 * chọn account ở góc phải rồi gạt.
 */

const GROUP_META: Record<ToolCatalogItem["group"], { title: string; hint: string }> = {
  read: { title: "Đọc & tra cứu", hint: "Không tác động ra ngoài - an toàn bật mặc định" },
  action: { title: "Hành động", hint: "Gửi/sửa thứ gì đó trên Zalo - cân nhắc theo account" },
};

/** Chế độ ảnh đang hiệu lực - hiện ngay trên dòng read_image cho khỏi phải đoán */
const IMAGE_MODE_BADGE: Record<
  VisionSettings["imageMode"],
  { tone: "green" | "blue" | "amber"; text: string }
> = {
  native: { tone: "green", text: "Model tự đọc ảnh" },
  describe: { tone: "blue", text: "Sidecar mô tả ảnh" },
  hybrid: { tone: "blue", text: "Ảnh + mô tả từ sidecar" },
  blind: { tone: "amber", text: "Bot không đọc được ảnh" },
};

export function ToolsPage() {
  const [tools, setTools] = useState<ToolCatalogItem[]>([]);
  const [search, setSearch] = useState<SearchSettings | null>(null);
  const [fetchSettings, setFetchSettings] = useState<FetchSettings | null>(null);
  const [vision, setVision] = useState<VisionSettings | null>(null);
  const [imageGen, setImageGen] = useState<ImageGenSettings | null>(null);
  const [settingsFor, setSettingsFor] = useState<ToolCatalogItem | null>(null);
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");

  /** Nạp lại catalog: cấu hình sidecar/vẽ ảnh đổi thì `available` của tool đổi theo */
  const reloadTools = () => api.tools().then((res) => setTools(res.items));

  useEffect(() => {
    Promise.all([api.tools(), api.accountsAdmin.list(), api.vision(), api.imageGen()])
      .then(([toolsRes, accountsRes, visionRes, imageRes]) => {
        setTools(toolsRes.items);
        setSearch(toolsRes.search);
        setFetchSettings(toolsRes.fetch);
        setVision(visionRes);
        setImageGen(imageRes);
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
              <span className="text-[12px] text-ink-soft">{GROUP_META[group].hint}</span>
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
                        {tool.key === "read_image" && vision && (
                          <Badge tone={IMAGE_MODE_BADGE[vision.imageMode].tone}>
                            {IMAGE_MODE_BADGE[vision.imageMode].text}
                          </Badge>
                        )}
                        {tool.key === "create_image" && imageGen?.configured && (
                          <Badge tone="blue" dot={false}>
                            {imageGen.model}
                          </Badge>
                        )}
                        {/* Bật mà thiếu hạ tầng thì model KHÔNG nhận được tool -
                            phải nói thẳng, không để người dùng tưởng bot có khả năng đó */}
                        {!tool.available && <Badge tone="amber">Chưa dùng được</Badge>}
                      </div>
                      <p className="mt-0.5 text-[12px] leading-[1.6] text-ink-soft">{tool.description}</p>
                      {!tool.available && tool.unavailableHint && (
                        <p className="mt-1 text-[12px] leading-[1.6] text-amber-700">{tool.unavailableHint}</p>
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

      {settingsFor?.key === "read_image" && vision && (
        <VisionSettingsModal
          vision={vision}
          onClose={() => setSettingsFor(null)}
          onSaved={(next) => {
            setVision(next);
            // Cấu hình sidecar đổi -> read_image available đổi theo
            void reloadTools();
          }}
        />
      )}

      {settingsFor?.key === "create_image" && imageGen && (
        <ImageSettingsModal
          settings={imageGen}
          onClose={() => setSettingsFor(null)}
          onSaved={(next) => {
            setImageGen(next);
            // Cấu hình đổi -> create_image available đổi theo
            void reloadTools();
          }}
        />
      )}

      {/* Danh sách tường minh, KHÔNG dùng "mọi key còn lại": thêm tool có
          settings riêng mà quên loại trừ ở đây là nó mở nhầm modal chuỗi web */}
      {settingsFor &&
        !["read_image", "create_image"].includes(settingsFor.key) &&
        search &&
        fetchSettings && (
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
