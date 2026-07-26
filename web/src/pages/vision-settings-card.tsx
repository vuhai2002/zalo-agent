import { useEffect, useState } from "react";
import type { VisionSettings } from "../dashboard-api-client";
import { api, ApiError } from "../dashboard-api-client";
import { SecretInput } from "../shared/secret-input";
import { Badge } from "../shared/ui-bits";

/**
 * Card "Đọc ảnh (Vision)" trên trang Providers: model chính có đọc được ảnh
 * không (auto = tự hỏi router) + cấu hình model sidecar "đọc ảnh thuê" khi
 * model chính không có vision.
 */

const IMAGE_MODE_BADGE = {
  native: { tone: "green" as const, text: "Model tự đọc ảnh" },
  describe: { tone: "blue" as const, text: "Sidecar mô tả ảnh cho model" },
  hybrid: { tone: "blue" as const, text: "Combo: gửi ảnh + kèm mô tả từ sidecar" },
  blind: { tone: "amber" as const, text: "Bot KHÔNG đọc được ảnh" },
};

export function VisionSettingsCard() {
  const [settings, setSettings] = useState<VisionSettings | null>(null);
  const [form, setForm] = useState({ mode: "auto", baseUrl: "", model: "", apiKey: "" });
  const [status, setStatus] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.vision().then((s) => {
      setSettings(s);
      setForm({ mode: s.mode, baseUrl: s.sidecar.baseUrl, model: s.sidecar.model, apiKey: "" });
    });

  useEffect(() => {
    load().catch(() => setSettings(null));
  }, []);

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      await api.updateVision({
        mode: form.mode as VisionSettings["mode"],
        sidecarBaseUrl: form.baseUrl,
        sidecarModel: form.model,
        // Bỏ trống = giữ key hiện tại (xóa key thì xóa cả base URL/model là đủ tắt sidecar)
        sidecarApiKey: form.apiKey || undefined,
      });
      await load();
      setStatus({ tone: "green", text: "Đã lưu - áp dụng từ lượt agent kế tiếp" });
    } catch (err) {
      setStatus({ tone: "red", text: err instanceof ApiError ? err.message : "Lưu thất bại" });
    } finally {
      setBusy(false);
    }
  }

  async function testSidecar() {
    setBusy(true);
    setStatus(null);
    const result = await api.testVisionSidecar().catch((err) => ({
      ok: false as const,
      error: err instanceof ApiError ? err.message : "Không gọi được",
      reply: undefined,
    }));
    setStatus(
      result.ok
        ? { tone: "green", text: "Sidecar đọc ảnh ok - đã mô tả được ảnh test" }
        : { tone: "red", text: `Sidecar lỗi: ${result.error}` },
    );
    setBusy(false);
  }

  if (!settings) return null;

  const badge = IMAGE_MODE_BADGE[settings.imageMode];

  return (
    <div className="gc-card mt-6 space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Đọc ảnh (Vision)</h2>
          <p className="mt-0.5 text-[13px] text-ink-soft">
            Model chính không đọc được ảnh thì model sidecar mô tả ảnh thành chữ thay
          </p>
        </div>
        <Badge tone={badge.tone}>{badge.text}</Badge>
      </div>

      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-ink">
          Model chính có đọc được ảnh không?
        </label>
        <select
          className="gc-input w-full"
          value={form.mode}
          onChange={(e) => setForm({ ...form, mode: e.target.value })}
        >
          <option value="auto">Tự phát hiện (hỏi router qua /models)</option>
          <option value="on">Có - luôn gửi ảnh cho model</option>
          <option value="off">Không - đừng gửi ảnh cho model</option>
        </select>
        <p className="mt-1.5 text-xs text-ink-soft/80">
          Tự phát hiện chỉ chính xác với 9Router; endpoint khác không báo capability thì
          được coi là đọc được - chọn "Không" nếu model thật sự không có vision.
        </p>
      </div>

      <div className="border-t border-line pt-4">
        <p className="mb-3 text-[13px] font-medium text-ink">
          Model sidecar đọc ảnh thuê
          <span className="ml-2 font-normal text-ink-soft">
            (Gemini free là lựa chọn tiêu chuẩn - ~500 lượt/ngày với flash-lite đời mới)
          </span>
        </p>
        <div className="space-y-3">
          <input
            className="gc-input w-full"
            value={form.baseUrl}
            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            placeholder="https://generativelanguage.googleapis.com/v1beta/openai"
          />
          <input
            className="gc-input w-full"
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
            placeholder="gemini-3.5-flash-lite"
          />
          <SecretInput
            value={form.apiKey}
            onChange={(apiKey) => setForm({ ...form, apiKey })}
            placeholder={
              settings.sidecar.apiKeyMasked
                ? `API key (hiện tại: ${settings.sidecar.apiKeyMasked} - bỏ trống để giữ)`
                : "API key sidecar"
            }
          />
        </div>
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
          onClick={testSidecar}
          disabled={busy || !settings.sidecar.configured}
          title={settings.sidecar.configured ? undefined : "Cần đủ base URL + model + API key"}
          className="rounded-lg border border-line bg-white px-4 py-2 text-[14px] font-medium text-ink hover:bg-tile disabled:opacity-50"
        >
          Test sidecar
        </button>
      </div>
    </div>
  );
}
