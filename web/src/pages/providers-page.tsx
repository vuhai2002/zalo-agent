import { useEffect, useState } from "react";
import type { ProviderSettings } from "../dashboard-api-client";
import { api, ApiError } from "../dashboard-api-client";
import { Badge } from "../shared/ui-bits";

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-zalo-500 focus:ring-2 focus:ring-zalo-100";

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

  if (!settings) return <p className="text-slate-400">Đang tải...</p>;

  return (
    <div className="max-w-2xl">
      <div className="mb-1 flex items-center gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Providers</h1>
        {settings.hasOverride && <Badge tone="blue">Đang dùng override</Badge>}
      </div>
      <p className="mb-6 text-sm text-slate-500">
        Cấu hình LLM runtime - đè lên .env, áp dụng ngay không cần restart bot
      </p>

      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Provider</label>
          <select
            className={inputCls}
            value={form.provider}
            onChange={(e) => setForm({ ...form, provider: e.target.value })}
          >
            <option value="openai-compatible">OpenAI-compatible (router proxy)</option>
            <option value="anthropic">Anthropic (gọi thẳng)</option>
          </select>
        </div>

        {form.provider === "openai-compatible" && (
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Base URL</label>
            <input
              className={inputCls}
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder="https://router.example.com/v1"
            />
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Model</label>
          <input
            className={inputCls}
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            API key <span className="font-normal text-slate-400">(hiện tại: {settings.apiKeyMasked})</span>
          </label>
          <input
            type="password"
            className={inputCls}
            value={form.apiKey}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            placeholder="Bỏ trống để giữ key hiện tại"
          />
          <p className="mt-1 text-xs text-slate-400">
            Key mới được mã hóa AES-256-GCM khi lưu; server không bao giờ trả lại key đầy đủ.
          </p>
        </div>

        {status && (
          <p className={`text-sm ${status.tone === "green" ? "text-emerald-600" : "text-red-600"}`}>
            {status.text}
          </p>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-zalo-500 px-4 py-2 text-sm font-medium text-white hover:bg-zalo-600 disabled:opacity-50"
          >
            Lưu
          </button>
          <button
            onClick={test}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Test kết nối
          </button>
          {settings.hasOverride && (
            <button
              onClick={reset}
              disabled={busy}
              className="ml-auto rounded-lg px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Xóa override (về .env)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
