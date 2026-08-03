import { useState } from "react";
import type { VisionSettings } from "../dashboard-api-client";
import { api, ApiError } from "../dashboard-api-client";
import { useConfirmDialog } from "../shared/confirm-dialog";
import { SecretInput } from "../shared/secret-input";
import { SelectMenu } from "../shared/select-menu";
import { ChainStep, ModalField, modalButton, ToolModalShell } from "./tool-settings-modal-shell";

/**
 * Modal cấu hình đọc ảnh, mở từ nút Settings trên dòng tool "Nhìn kỹ ảnh".
 *
 * Đọc ảnh cũng là một CHUỖI nên trình bày y hệt web_search/web_fetch:
 *   1. model chính tự đọc pixel (nếu nó có vision)
 *   2. model sidecar mô tả ảnh thành chữ (đỡ khi bậc 1 không đọc được)
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
  const { confirm, confirmDialog } = useConfirmDialog();

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
    const ok = await confirm({
      title: "Xóa cấu hình?",
      message: "Cả API key cũng bị xóa. Bot sẽ không đọc được ảnh cho tới khi bạn cấu hình lại.",
    });
    if (!ok) return;
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
    <>
    <ToolModalShell
      title="Đọc ảnh - chuỗi nguồn"
      subtitle="Model chính đọc pixel trước; không đọc được thì sidecar mô tả ảnh thành chữ."
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
        enabled
      >
        {/* Nhãn ngắn: tiêu đề mục ngay trên đã nói "Model chính tự đọc ảnh",
            để lại nguyên câu hỏi ở đây là nói cùng một điều hai lần */}
        <ModalField
          id="vision-mode"
          label="Chế độ"
          hint='Tự phát hiện cần endpoint khai báo capabilities.vision ở /models. Endpoint OpenAI chuẩn không có field này, nên hãy tự chọn "Có"/"Không".'
        >
          <SelectMenu
            id="vision-mode"
            size="md"
            value={mode}
            options={(["auto", "on", "off"] as const).map((m) => ({ value: m, label: MODE_LABEL[m] }))}
            onChange={(v) => setMode(v as VisionSettings["mode"])}
          />
        </ModalField>
      </ChainStep>

      <ChainStep
        index={2}
        title="Model sidecar mô tả ảnh"
        enabled={vision.sidecar.configured}
        locked={vision.sidecar.configured}
      >
        <>
          <ModalField id="sidecar-url" label="Base URL">
            <input
              id="sidecar-url"
              className="gc-input w-full"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://generativelanguage.googleapis.com/v1beta/openai"
            />
          </ModalField>
          <ModalField
            id="sidecar-model"
            label="Model"
            hint="Gemini free cho khoảng 500 lượt/ngày."
          >
            <input
              id="sidecar-model"
              className="gc-input w-full"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gemini-3.5-flash-lite"
            />
          </ModalField>
          <ModalField id="sidecar-key" label="API key">
            <SecretInput
              id="sidecar-key"
              value={apiKey}
              onChange={setApiKey}
              placeholder={
                vision.sidecar.hasApiKey
                  ? `Hiện tại ${vision.sidecar.apiKeyMasked} - bỏ trống để giữ`
                  : "Dán API key vào đây"
              }
            />
          </ModalField>
        </>
      </ChainStep>

      {status && (
        <div
          className={`rounded-xl border px-4 py-2.5 text-[13px] ${
            status.tone === "green"
              ? "border-emerald-100 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
              : "border-red-100 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300"
          }`}
        >
          {status.text}
        </div>
      )}
    </ToolModalShell>
    {confirmDialog}
    </>
  );
}
