import { useEffect, useState } from "react";
import type { ProviderSettings } from "../dashboard-api-client";
import { api, ApiError } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { IconSliders } from "../shared/dashboard-icons";
import { SecretInput } from "../shared/secret-input";
import { SelectMenu } from "../shared/select-menu";
import { useConfirmDialog } from "../shared/confirm-dialog";
import { Badge } from "../shared/ui-bits";

export function ProvidersPage() {
  const [settings, setSettings] = useState<ProviderSettings | null>(null);
  const [form, setForm] = useState({ provider: "openai-compatible", baseUrl: "", model: "", apiKey: "" });
  const [status, setStatus] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm, confirmDialog } = useConfirmDialog();

  const load = () =>
    api.provider().then((s) => {
      setSettings(s);
      setForm({ provider: s.provider, baseUrl: s.baseUrl, model: s.model, apiKey: "" });
    });

  useEffect(() => {
    load().catch(() => setSettings(null));
  }, []);

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      await api.updateProvider({
        provider: form.provider as ProviderSettings["provider"],
        baseUrl: form.baseUrl || undefined,
        model: form.model,
        apiKey: form.apiKey || undefined,
      });
      await load();
      setStatus({ tone: "green", text: "Đã lưu - áp dụng từ lượt agent kế tiếp, không cần restart" });
    } catch (err) {
      setStatus({ tone: "red", text: err instanceof ApiError ? err.message : "Lưu thất bại" });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setStatus(null);
    const result = await api.testProvider().catch((err) => ({
      ok: false as const,
      error: err instanceof ApiError ? err.message : "Không gọi được",
      reply: undefined,
    }));
    setStatus(
      result.ok
        ? { tone: "green", text: `Kết nối ok - model trả lời: "${result.reply}"` }
        : { tone: "red", text: `Kết nối lỗi: ${result.error}` },
    );
    setBusy(false);
  }

  async function reset() {
    // Hành động PHÁ HỦY: `clearLlmSettings` xóa cả API key. Từ khi .env rút còn
    // 9 biến, phần LLM ở đó thường trống - nên không có bản dự phòng nào để
    // "quay về", bấm nhầm là bot câm ngay lượt sau. Mọi hành động phá hủy khác
    // trong dashboard đều hỏi trước; chỗ này trước đó thì không.
    const ok = await confirm({
      title: "Xóa toàn bộ cấu hình LLM?",
      message:
        "API key, base URL và tên model đã lưu sẽ bị xóa. Nếu máy chủ không đặt sẵn cấu hình LLM bằng biến môi trường thì bot ngừng trả lời cho tới khi bạn nhập lại.",
    });
    if (!ok) return;

    setBusy(true);
    try {
      await api.clearProvider();
      await load();
      setStatus({ tone: "green", text: "Đã xóa cấu hình LLM đã lưu" });
    } catch (err) {
      // Thiếu `finally` là lỗi cũ ở đúng hàm này: request hỏng thì `busy` kẹt
      // `true` và cả ba nút Lưu/Test/Xóa không bấm được nữa cho tới khi F5
      setStatus({ tone: "red", text: err instanceof ApiError ? err.message : "Xóa thất bại" });
    } finally {
      setBusy(false);
    }
  }

  if (!settings) return <p className="text-ink-soft">Đang tải...</p>;

  return (
    <div className="max-w-2xl">
      <PageHeader
        icon={IconSliders}
        title="Providers"
        subtitle="Nguồn cấu hình LLM chính - áp dụng ngay, không cần khởi động lại bot"
        aside={settings.hasOverride ? <Badge tone="blue">Đang dùng override</Badge> : undefined}
      />

      <div className="gc-card space-y-4 p-6">
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-ink" htmlFor="pv-provider">Provider</label>
          <SelectMenu
            id="pv-provider"
            size="md"
            value={form.provider}
            options={[
              { value: "openai-compatible", label: "OpenAI-compatible (router proxy)" },
              { value: "anthropic", label: "Anthropic (gọi thẳng)" },
            ]}
            onChange={(provider) => setForm({ ...form, provider })}
          />
        </div>

        {form.provider === "openai-compatible" && (
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-ink" htmlFor="pv-base-url">Base URL</label>
            <input
              id="pv-base-url"
              className="gc-input w-full"
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder="https://api.example.com/v1"
            />
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-ink" htmlFor="pv-model">Model</label>
          <input
            id="pv-model"
            className="gc-input w-full"
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-ink" htmlFor="pv-api-key">
            API key <span className="font-normal text-ink-soft">(hiện tại: {settings.apiKeyMasked})</span>
          </label>
          <SecretInput
            id="pv-api-key"
            value={form.apiKey}
            onChange={(apiKey) => setForm({ ...form, apiKey })}
            placeholder="Bỏ trống để giữ key hiện tại"
          />
          <p className="mt-1.5 text-[12px] leading-[1.6] text-ink-soft">
            Key được mã hóa AES-256-GCM khi lưu, không bao giờ trả lại đầy đủ.
          </p>
        </div>

        {status && (
          <p className={`text-[13px] ${status.tone === "green" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
            {status.text}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-zalo-500 px-4 py-2 text-[14px] font-medium text-white hover:bg-zalo-600 disabled:opacity-50"
          >
            Lưu
          </button>
          <button
            onClick={test}
            disabled={busy}
            className="rounded-lg border border-line bg-surface px-4 py-2 text-[14px] font-medium text-ink hover:bg-tile disabled:opacity-50"
          >
            Test kết nối
          </button>
          {settings.hasOverride && (
            <button
              onClick={reset}
              disabled={busy}
              className="ml-auto rounded-lg px-4 py-2 text-[14px] text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50"
            >
              Xóa cấu hình LLM
            </button>
          )}
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
