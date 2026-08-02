import { useState } from "react";
import type { FetchSettings, SearchSettings, ToolCatalogItem } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { useConfirmDialog } from "../shared/confirm-dialog";
import { SecretInput } from "../shared/secret-input";
import { ChainStep, modalButton, ToolModalShell } from "./tool-settings-modal-shell";

/**
 * Modal chuỗi nguồn của web_search / web_fetch.
 *
 * Bậc CUỐI của mỗi chuỗi khoá cứng (không có toggle) - đó là thứ bảo đảm tool
 * không bao giờ rơi vào trạng thái "chưa cấu hình": web_search luôn còn
 * DuckDuckGo, web_fetch luôn còn tầng tự tải.
 */
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
  const { confirm, confirmDialog } = useConfirmDialog();

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

  /**
   * Gỡ hẳn key khỏi DB. Cần hành động riêng vì đường lưu quy ước "ô trống =
   * giữ key cũ" (để đổi cấu hình khác không phải nhập lại key), nên không có
   * cách nào gửi chuỗi rỗng qua nút Lưu.
   */
  async function clearBraveKey() {
    const ok = await confirm({
      title: "Xóa API key Brave?",
      message: "Web search sẽ chỉ còn DuckDuckGo (miễn phí) cho tới khi bạn nhập key mới.",
    });
    if (!ok) return;
    setSaving(true);
    setError("");
    try {
      // Xóa key thì provider tự hạ về duckduckgo ở tầng store
      const res = await api.updateSearchSettings({ braveApiKey: "" });
      setApiKey("");
      setBraveOn(false);
      onSaved({ search: res.search });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
    <ToolModalShell
      title={`${tool.label} - chuỗi nguồn`}
      subtitle="Thử lần lượt từ trên xuống, dừng ở bậc đầu tiên cho kết quả dùng được."
      onClose={onClose}
      footer={
        <>
          {isSearch && search.hasBraveApiKey && (
            <button
              type="button"
              onClick={clearBraveKey}
              disabled={saving}
              className={`mr-auto ${modalButton.danger}`}
            >
              Xóa key Brave
            </button>
          )}
          <button type="button" onClick={onClose} className={modalButton.cancel}>
            Hủy
          </button>
          <button
            type="button"
            onClick={save}
            disabled={blocked || saving}
            className={modalButton.primary}
          >
            {saving ? "Đang lưu..." : "Lưu"}
          </button>
        </>
      }
    >
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
            <SecretInput
              id="brave-key"
              value={apiKey}
              onChange={setApiKey}
              placeholder={search.hasBraveApiKey ? "Để trống nếu giữ key cũ" : "Dán key vào đây"}
              className="mt-1.5"
            />
            <p className="mt-1.5 text-[12px] leading-[1.6] text-ink-soft">
              Lấy key miễn phí tại{" "}
              <a
                href="https://brave.com/search/api/"
                target="_blank"
                rel="noreferrer"
                className="text-zalo-600 hover:underline"
              >
                brave.com/search/api
              </a>
              .
            </p>
          </ChainStep>

          <ChainStep
            index={2}
            title="DuckDuckGo"
            description="Miễn phí, không cần key. Là bậc cuối nên web search không bao giờ thiếu nguồn."
            enabled
            locked
          />

          {blocked && (
            <div className="rounded-xl border border-amber-100 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/40 px-4 py-2.5 text-[13px] text-amber-800 dark:text-amber-200">
              Nhập API key Brave trước rồi mới bật được bậc này.
            </div>
          )}
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

      {error && (
        <div className="rounded-xl border border-red-100 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-[13px] text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
    </ToolModalShell>
    {confirmDialog}
    </>
  );
}
