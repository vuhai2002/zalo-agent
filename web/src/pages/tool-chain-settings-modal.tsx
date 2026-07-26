import { useState } from "react";
import type { FetchSettings, SearchSettings, ToolCatalogItem } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { ToggleKnob } from "../shared/ui-bits";

/**
 * Modal cấu hình chuỗi nguồn của 1 tool, theo mẫu "Extractor Chain" của GoClaw:
 * liệt kê các bậc theo thứ tự thử, mỗi bậc có toggle + cấu hình riêng.
 *
 * Bậc CUỐI của mỗi chuỗi khoá cứng (không có toggle) - đó là thứ bảo đảm tool
 * không bao giờ rơi vào trạng thái "chưa cấu hình": web_search luôn còn
 * DuckDuckGo, web_fetch luôn còn tầng tự tải.
 */

function ChainStep({
  index,
  title,
  description,
  enabled,
  locked,
  onToggle,
  children,
}: {
  index: number;
  title: string;
  description: string;
  enabled: boolean;
  /** Bậc bắt buộc - hiện nhãn thay cho toggle */
  locked?: boolean;
  onToggle?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-tile px-1.5 py-0.5 text-[11px] font-medium text-ink-soft">
              #{index}
            </span>
            <span className="text-[14px] font-medium text-ink">{title}</span>
          </div>
          <p className="mt-1 text-[12.5px] text-ink-soft">{description}</p>
        </div>
        {locked ? (
          <span className="shrink-0 whitespace-nowrap rounded-full bg-tile px-2.5 py-1 text-[11px] font-medium text-ink-soft">
            Luôn bật
          </span>
        ) : (
          // shrink-0 bắt buộc: thiếu nó flex bóp nút về width 0 và toggle biến
          // mất hẳn dù ToggleKnob bên trong vẫn giữ 36px
          <button type="button" onClick={onToggle} aria-label={`Bật tắt ${title}`} className="shrink-0">
            <ToggleKnob on={enabled} />
          </button>
        )}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

export function ToolChainSettingsModal({
  tool,
  search,
  fetchSettings,
  onClose,
  onSaved,
}: {
  tool: ToolCatalogItem;
  search: SearchSettings;
  fetchSettings: FetchSettings;
  onClose: () => void;
  onSaved: (next: { search?: SearchSettings; fetch?: FetchSettings }) => void;
}) {
  const isSearch = tool.key === "web_search";

  const [braveOn, setBraveOn] = useState(search.provider === "brave");
  const [apiKey, setApiKey] = useState("");
  const [jinaOn, setJinaOn] = useState(fetchSettings.fallbackEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const keyAvailable = search.hasBraveApiKey || apiKey.trim().length > 0;
  const blocked = isSearch && braveOn && !keyAvailable;

  async function save() {
    if (blocked || saving) return;
    setSaving(true);
    setError("");
    try {
      if (isSearch) {
        const res = await api.updateSearchSettings({
          provider: braveOn ? "brave" : "duckduckgo",
          ...(apiKey.trim() ? { braveApiKey: apiKey.trim() } : {}),
        });
        onSaved({ search: res.search });
      } else {
        const res = await api.updateFetchSettings({ fallbackEnabled: jinaOn });
        onSaved({ fetch: res.fetch });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[17px] font-semibold text-ink">
          {tool.label} - chuỗi nguồn
        </h2>
        <p className="mt-1 text-[13px] text-ink-soft">
          Thử lần lượt từ trên xuống, dừng ở bậc đầu tiên cho kết quả dùng được.
        </p>

        <div className="mt-4 space-y-3">
          {isSearch ? (
            <>
              <ChainStep
                index={1}
                title="Brave Search"
                description="Kết quả tốt hơn, cần API key. Hết quota hoặc lỗi thì tự rơi xuống bậc dưới."
                enabled={braveOn}
                onToggle={() => setBraveOn((v) => !v)}
              >
                <label className="block text-[13px] font-medium text-ink" htmlFor="brave-key">
                  API key
                  <span className="ml-2 font-normal text-ink-soft">
                    (hiện tại: {search.braveApiKeyMasked})
                  </span>
                </label>
                <input
                  id="brave-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={search.hasBraveApiKey ? "Để trống nếu giữ key cũ" : "Dán key vào đây"}
                  autoComplete="off"
                  className="gc-input mt-1.5 w-full"
                />
                <p className="mt-1.5 text-xs text-ink-soft">
                  Lấy key miễn phí tại{" "}
                  <a
                    href="https://brave.com/search/api/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-zalo-600 hover:underline"
                  >
                    brave.com/search/api
                  </a>
                  . Key được mã hóa trước khi lưu, không bao giờ hiện lại đầy đủ.
                </p>
              </ChainStep>

              <ChainStep
                index={2}
                title="DuckDuckGo"
                description="Miễn phí, không cần key. Là bậc cuối nên web search không bao giờ thiếu nguồn."
                enabled
                locked
              />
            </>
          ) : (
            <>
              <ChainStep
                index={1}
                title="Tự tải trực tiếp"
                description="Nhanh, riêng tư, đã chặn IP nội bộ chống SSRF. Không đọc được trang render bằng JavaScript."
                enabled
                locked
              />
              <ChainStep
                index={2}
                title="Jina Reader (r.jina.ai)"
                description="Dùng khi bậc 1 hỏng hoặc ra quá ít chữ: render được trang JavaScript, qua được một phần chặn bot. Chậm hơn nhiều và URL đi qua dịch vụ bên thứ ba."
                enabled={jinaOn}
                onToggle={() => setJinaOn((v) => !v)}
              />
            </>
          )}
        </div>

        {blocked && (
          <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-800">
            Nhập API key Brave trước rồi mới bật được bậc này.
          </div>
        )}
        {error && (
          <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-[13px] text-red-700">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-4 py-2 text-[14px] font-medium text-ink-soft hover:bg-tile"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={save}
            disabled={blocked || saving}
            className="rounded-lg bg-zalo-500 px-4 py-2 text-[14px] font-medium text-white hover:bg-zalo-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Đang lưu..." : "Lưu"}
          </button>
        </div>
      </div>
    </div>
  );
}
