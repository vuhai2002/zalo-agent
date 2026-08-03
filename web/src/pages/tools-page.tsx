import { useEffect, useMemo, useState } from "react";
import type {
  FetchSettings,
  ImageGenSettings,
  ManagedAccount,
  ManagedAgent,
  SearchSettings,
  ToolCatalogItem,
  VisionSettings,
} from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import {
  IconBolt,
  IconSliders,
} from "../shared/dashboard-icons";
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
  const [agents, setAgents] = useState<ManagedAgent[]>([]);
  /** Không đọc được danh sách agent -> trang chỉ đang hiện LỚP TÀI KHOẢN */
  const [agentLoi, setAgentLoi] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");

  /** Nạp lại catalog: cấu hình sidecar/vẽ ảnh đổi thì `available` của tool đổi theo */
  const reloadTools = () => api.tools().then((res) => setTools(res.items));

  useEffect(() => {
    Promise.all([
      api.tools(),
      api.accountsAdmin.list(),
      api.vision(),
      api.imageGen(),
      // Tách lỗi riêng: nhãn "agent đang tắt" là thông tin PHỤ, còn
      // /api/agents có ghi DB (ensureDefaultAgent) nên dễ lỗi hơn các endpoint
      // kia. Để nó trong Promise.all chung thì nó hỏng là mất trắng cả trang.
      // Đánh dấu HỎNG thay vì trả mảng rỗng im lặng: mảng rỗng làm nhãn "Agent
      // đang tắt" biến mất, tức trang quay về đúng trạng thái SAI mà lớp tắt
      // theo agent vừa sinh ra để sửa - mà không có dấu hiệu nào.
      api.agentsAdmin.list().catch(() => null),
    ])
      .then(([toolsRes, accountsRes, visionRes, imageRes, agentsRes]) => {
        setTools(toolsRes.items);
        setSearch(toolsRes.search);
        setFetchSettings(toolsRes.fetch);
        setVision(visionRes);
        setImageGen(imageRes);
        setAccounts(accountsRes.items);
        setAgents(agentsRes?.items ?? []);
        setAgentLoi(agentsRes === null);
        if (accountsRes.items[0]) setAccountId(accountsRes.items[0].id);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const account = useMemo(() => accounts.find((a) => a.id === accountId), [accounts, accountId]);

  /**
   * Agent đang gắn vào account này. Cần ở đây vì công tắc trên trang này CHỈ nói
   * lớp account, trong khi bộ tool model thật nhận là phần GIAO với lớp agent -
   * không hiện lớp kia ra thì đây thành nơi báo sai, đúng lúc người dùng vào để
   * tra "sao bot không tra web được".
   */
  const agent = useMemo(
    () => agents.find((a) => a.id === account?.agentId),
    [agents, account],
  );

  async function toggleTool(toolKey: string) {
    if (!account || saving) return;
    const disabled = new Set(account.disabledTools);
    if (disabled.has(toolKey)) disabled.delete(toolKey);
    else disabled.add(toolKey);
    // Lọc theo catalog vừa tải - cùng lý do với `agent-tools-section.tsx`: key
    // tool lạ còn sót trong DB làm mọi lần lưu trả 400 và trang kẹt cứng.
    const hopLe = new Set(tools.map((t) => t.key));
    const disabledTools = [...disabled].filter((k) => hopLe.has(k));

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
      {agentLoi && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-[13px] leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          Chưa đọc được cấu hình agent, nên trang này chỉ đang hiện lớp TÀI KHOẢN.
          Công cụ bị agent tắt sẽ không có nhãn - tải lại trang để xem đầy đủ.
        </div>
      )}
      <PageHeader
        icon={IconBolt}
        title="Tools"
        subtitle="Bật/tắt công cụ cho từng tài khoản. Model chỉ nhận được công cụ mà CẢ tài khoản này LẪN agent của nó cùng bật."
        aside={
          accounts.length > 0 ? (
            <SelectMenu
              value={accountId}
              onChange={setAccountId}
              ariaLabel="Chọn account"
              options={accounts.map((a) => ({
                value: a.id,
                label: a.label,
                dotClass: a.running ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600",
              }))}
            />
          ) : undefined
        }
      />

      {error && (
        <div className="mb-4 rounded-xl border border-red-100 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-[13px] text-red-700 dark:text-red-300">
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
                // Công tắc ở đây chỉ là lớp ACCOUNT. Agent tắt thì model cũng
                // không nhận được tool, dù công tắc này đang bật - phải nói ra,
                // không thì trang này báo ngược với thực tế.
                const agentTat = Boolean(agent?.disabledTools.includes(tool.key));
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
                        {agentTat && <Badge tone="amber">Agent đang tắt</Badge>}
                      </div>
                      <p className="mt-0.5 text-[12px] leading-[1.6] text-ink-soft">{tool.description}</p>
                      {!tool.available && tool.unavailableHint && (
                        <p className="mt-1 text-[12px] leading-[1.6] text-amber-700 dark:text-amber-300">{tool.unavailableHint}</p>
                      )}
                      {/* Bật công tắc này mà agent vẫn tắt thì model KHÔNG nhận
                          được tool - nói rõ và chỉ đường sửa, đừng để người dùng
                          gạt qua gạt lại ở đây mà không hiểu vì sao bot vẫn không làm được */}
                      {agentTat && enabled && (
                        <p className="mt-1 text-[12px] leading-[1.6] text-amber-700 dark:text-amber-300">
                          Công tắc này đang bật nhưng agent "{agent?.name}" đã tắt công cụ, nên model vẫn
                          không nhận được. Bật lại ở trang Agents.
                        </p>
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
