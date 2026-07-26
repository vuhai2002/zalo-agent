import { useEffect, useState } from "react";
import type { ProviderSettings } from "../dashboard-api-client";
import { api, ApiError } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { Badge } from "../shared/ui-bits";
import { VisionSettingsCard } from "./vision-settings-card";

export function ProvidersPage() {
  const [settings, setSettings] = useState<ProviderSettings | null>(null);
  const [form, setForm] = useState({ provider: "openai-compatible", baseUrl: "", model: "", apiKey: "" });
  const [status, setStatus] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
    await api.clearProvider();
    await load();
    setStatus({ tone: "green", text: "Đã xóa override - quay về cấu hình trong .env" });
    setBusy(false);
  }

  if (!settings) return <p className="text-ink-soft">Đang tải...</p>;

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Providers"
        subtitle="Cấu hình LLM runtime - đè lên .env, áp dụng ngay không cần restart bot"
        aside={settings.hasOverride ? <Badge tone="blue">Đang dùng override</Badge> : undefined}
      />

      <div className="gc-card space-y-4 p-6">
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-ink">Provider</label>
          <select
            className="gc-input w-full"
            value={form.provider}
            onChange={(e) => setForm({ ...form, provider: e.target.value })}
          >
            <option value="openai-compatible">OpenAI-compatible (router proxy)</option>
            <option value="anthropic">Anthropic (gọi thẳng)</option>
          </select>
        </div>

        {form.provider === "openai-compatible" && (
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-ink">Base URL</label>
            <input
              className="gc-input w-full"
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder="https://router.example.com/v1"
            />
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-ink">Model</label>
          <input
            className="gc-input w-full"
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-ink">
            API key <span className="font-normal text-ink-soft">(hiện tại: {settings.apiKeyMasked})</span>
          </label>
          <input
            type="password"
            className="gc-input w-full"
            value={form.apiKey}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            placeholder="Bỏ trống để giữ key hiện tại"
          />
          <p className="mt-1.5 text-xs text-ink-soft/80">
            Key mới được mã hóa AES-256-GCM khi lưu; server không bao giờ trả lại key đầy đủ.
          </p>
        </div>

        {status && (
          <p className={`text-[13px] ${status.tone === "green" ? "text-emerald-600" : "text-red-600"}`}>
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
            className="rounded-lg border border-line bg-white px-4 py-2 text-[14px] font-medium text-ink hover:bg-tile disabled:opacity-50"
          >
            Test kết nối
          </button>
          {settings.hasOverride && (
            <button
              onClick={reset}
              disabled={busy}
              className="ml-auto rounded-lg px-4 py-2 text-[14px] text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Xóa override (về .env)
            </button>
          )}
        </div>
      </div>

      <VisionSettingsCard />
    </div>
  );
}
