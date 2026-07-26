import { useState } from "react";
import type { VisionSettings } from "../dashboard-api-client";
import { api, ApiError } from "../dashboard-api-client";
import { SecretInput } from "../shared/secret-input";
import { ChainStep, modalButton, ToolModalShell } from "./tool-settings-modal-shell";

/**
 * Modal cấu hình đọc ảnh, mở từ nút Settings trên dòng tool "Nhìn kỹ ảnh".
 *
 * Đọc ảnh cũng là một CHUỖI nên trình bày y hệt web_search/web_fetch:
 *   #1 model chính tự đọc pixel (nếu nó có vision)
 *   #2 model sidecar mô tả ảnh thành chữ (đỡ khi bậc 1 không đọc được)
 * Trước đây phần này là card riêng ở trang Providers - user phản hồi 2 nơi
 * khó hiểu, gom về đúng 1 chỗ cùng các tool khác.
 */

const MODE_LABEL: Record<VisionSettings["mode"], string> = {
  auto: "Tự phát hiện (hỏi router qua /models)",
  on: "Có - luôn gửi ảnh cho model",
  off: "Không - đừng gửi ảnh cho model",
};

export function VisionSettingsModal({
  vision,
  onClose,
  onSaved,
}: {
  vision: VisionSettings;
  onClose: () => void;
  onSaved: (next: VisionSettings) => void;
}) {
  const [mode, setMode] = useState<VisionSettings["mode"]>(vision.mode);
  const [baseUrl, setBaseUrl] = useState(vision.sidecar.baseUrl);
  const [model, setModel] = useState(vision.sidecar.model);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: "green" | "red"; text: string } | null>(null);

  const hasSomethingToClear = vision.sidecar.hasApiKey || vision.sidecar.baseUrl || vision.sidecar.model;

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await api.updateVision({
        mode,
        sidecarBaseUrl: baseUrl,
        sidecarModel: model,
        // Bỏ trống = giữ key hiện tại (xóa key dùng nút riêng bên dưới)
        sidecarApiKey: apiKey || undefined,
      });
      onSaved(res);
      onClose();
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

  async function clearSidecar() {
    // Mất key thật (phải xin lại từ nhà cung cấp) nên hỏi trước - cùng nếp với
    // xóa account/agent
    if (!window.confirm("Xóa cấu hình sidecar (gồm cả API key)? Bot sẽ không đọc được ảnh nữa."))
      return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await api.clearVisionSidecar();
      onSaved(res);
      onClose();
    } catch (err) {
      setStatus({ tone: "red", text: err instanceof ApiError ? err.message : "Xóa thất bại" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ToolModalShell
      title="Đọc ảnh - chuỗi nguồn"
      subtitle="Model chính đọc pixel trước; không đọc được thì model sidecar mô tả ảnh thành chữ."
      onClose={onClose}
      footer={
        <>
          {hasSomethingToClear && (
            <button
              type="button"
              onClick={clearSidecar}
              disabled={busy}
              className={`mr-auto ${modalButton.danger}`}
            >
              Xóa cấu hình sidecar
            </button>
          )}
          <button
            type="button"
            onClick={testSidecar}
            disabled={busy || !vision.sidecar.configured}
            title={vision.sidecar.configured ? undefined : "Cần đủ base URL + model + API key"}
            className={modalButton.secondary}
          >
            Test sidecar
          </button>
          <button type="button" onClick={onClose} className={modalButton.cancel}>
            Hủy
          </button>
          <button type="button" onClick={save} disabled={busy} className={modalButton.primary}>
            {busy ? "Đang lưu..." : "Lưu"}
          </button>
        </>
      }
    >
      <ChainStep
        index={1}
        title="Model chính tự đọc ảnh"
        description="Model trả lời cũng nhìn thẳng pixel - luôn tốt nhất khi nó có vision."
        enabled
      >
        <label className="block text-[13px] font-medium text-ink" htmlFor="vision-mode">
          Model chính có đọc được ảnh không?
        </label>
        <select
          id="vision-mode"
          className="gc-input mt-1.5 w-full"
          value={mode}
          onChange={(e) => setMode(e.target.value as VisionSettings["mode"])}
        >
          {(["auto", "on", "off"] as const).map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-ink-soft">
          Tự phát hiện chỉ chính xác với 9Router; endpoint khác không báo capability thì được coi
          là đọc được - chọn "Không" nếu model thật sự không có vision.
        </p>
      </ChainStep>

      <ChainStep
        index={2}
        title="Model sidecar mô tả ảnh"
        description="Đọc ảnh thuê rồi trả về chữ cho model chính. Cũng là thứ cấp sức cho chính tool này khi cần soi kỹ (đếm, đọc chữ nhỏ)."
        enabled={vision.sidecar.configured}
        locked={vision.sidecar.configured}
      >
        <div className="space-y-2.5">
          <input
            className="gc-input w-full"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://generativelanguage.googleapis.com/v1beta/openai"
          />
          <input
            className="gc-input w-full"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gemini-3.5-flash-lite"
          />
          <SecretInput
            value={apiKey}
            onChange={setApiKey}
            placeholder={
              vision.sidecar.hasApiKey
                ? `API key (hiện tại: ${vision.sidecar.apiKeyMasked} - bỏ trống để giữ)`
                : "API key sidecar"
            }
          />
        </div>
        <p className="mt-1.5 text-xs text-ink-soft">
          Gemini free là lựa chọn tiêu chuẩn (~500 lượt/ngày với flash-lite đời mới). Key được mã
          hóa trước khi lưu, không bao giờ hiện lại đầy đủ.
        </p>
      </ChainStep>

      {status && (
        <div
          className={`rounded-xl border px-4 py-2.5 text-[13px] ${
            status.tone === "green"
              ? "border-emerald-100 bg-emerald-50 text-emerald-700"
              : "border-red-100 bg-red-50 text-red-700"
          }`}
        >
          {status.text}
        </div>
      )}
    </ToolModalShell>
  );
}
