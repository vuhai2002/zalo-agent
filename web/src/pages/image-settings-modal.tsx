import { useState } from "react";
import type { ImageGenSettings } from "../dashboard-api-client";
import { api, ApiError } from "../dashboard-api-client";
import { useConfirmDialog } from "../shared/confirm-dialog";
import { SecretInput } from "../shared/secret-input";
import { ModalField, modalButton, ToolModalShell } from "./tool-settings-modal-shell";

/**
 * Modal cấu hình vẽ ảnh, mở từ nút Settings trên dòng tool "Vẽ ảnh AI".
 *
 * Không trình bày dạng chuỗi nhiều bậc như web_search/vision vì đây chỉ có MỘT
 * nguồn: không có bậc dự phòng nào để rơi xuống khi provider vẽ ảnh hỏng.
 *
 * Nút Test ở đây khác nút Test của sidecar: nó vẽ THẬT một ảnh nên mất khoảng 1
 * phút và tốn tiền. Phải làm vậy vì /v1/models của router chỉ liệt kê model
 * chat - không có cách nào đối chiếu tên model vẽ ảnh ngoài việc gọi thử.
 */

export function ImageSettingsModal({
  settings,
  onClose,
  onSaved,
}: {
  settings: ImageGenSettings;
  onClose: () => void;
  onSaved: (next: ImageGenSettings) => void;
}) {
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [model, setModel] = useState(settings.model);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: "green" | "red" | "blue"; text: string } | null>(null);
  const { confirm, confirmDialog } = useConfirmDialog();

  const hasSomethingToClear = settings.hasApiKey || settings.baseUrl || settings.model;

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await api.updateImageGen({
        baseUrl,
        model,
        // Bỏ trống = giữ key hiện tại (xóa key dùng nút riêng bên dưới)
        apiKey: apiKey || undefined,
      });
      onSaved(res);
      onClose();
    } catch (err) {
      setStatus({ tone: "red", text: err instanceof ApiError ? err.message : "Lưu thất bại" });
    } finally {
      setBusy(false);
    }
  }

  async function testGenerate() {
    setBusy(true);
    setStatus({ tone: "blue", text: "Đang vẽ ảnh test, mất khoảng 1 phút..." });
    const result = await api.testImageGen().catch((err) => ({
      ok: false as const,
      error: err instanceof ApiError ? err.message : "Không gọi được",
      kb: undefined,
    }));
    setStatus(
      result.ok
        ? { tone: "green", text: `Vẽ ảnh ok - nhận về ảnh ${result.kb} KB` }
        : { tone: "red", text: `Vẽ ảnh lỗi: ${result.error}` },
    );
    setBusy(false);
  }

  async function clearSettings() {
    // Mất key thật (phải xin lại từ nhà cung cấp) nên hỏi trước - cùng nếp với
    // xóa cấu hình sidecar
    const ok = await confirm({
      title: "Xóa cấu hình vẽ ảnh?",
      message: "Cả API key cũng bị xóa. Bot sẽ không vẽ được ảnh cho tới khi bạn cấu hình lại.",
    });
    if (!ok) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await api.clearImageGen();
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
        title="Vẽ ảnh AI"
        subtitle="Endpoint OpenAI-compatible /v1/images/generations - vẽ mới hoặc sửa ảnh người dùng gửi."
        onClose={onClose}
        footer={
          <>
            {hasSomethingToClear && (
              <button
                type="button"
                onClick={clearSettings}
                disabled={busy}
                className={`mr-auto ${modalButton.danger}`}
              >
                Xóa cấu hình
              </button>
            )}
            <button
              type="button"
              onClick={testGenerate}
              disabled={busy || !settings.configured}
              title={
                settings.configured
                  ? "Vẽ thật 1 ảnh - mất khoảng 1 phút và tính phí như một lần vẽ bình thường"
                  : "Cần đủ base URL + model + API key (lưu trước rồi mới test được)"
              }
              className={modalButton.secondary}
            >
              Vẽ thử 1 ảnh
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
        <div className="space-y-3">
          <ModalField
            id="image-base-url"
            label="Base URL"
            hint="Chỉ phần gốc, không kèm /v1/images/generations - bot tự nối."
          >
            <input
              id="image-base-url"
              className="gc-input w-full"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com"
            />
          </ModalField>

          <ModalField
            id="image-model"
            label="Model"
            hint='Không có danh sách để chọn - bấm "Vẽ thử 1 ảnh" để kiểm tra tên.'
          >
            <input
              id="image-model"
              className="gc-input w-full"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gpt-5.5-image"
            />
          </ModalField>

          <ModalField id="image-api-key" label="API key">
            <SecretInput
              id="image-api-key"
              value={apiKey}
              onChange={setApiKey}
              placeholder={
                settings.hasApiKey
                  ? `Hiện tại ${settings.apiKeyMasked} - bỏ trống để giữ`
                  : "Dán API key vào đây"
              }
            />
          </ModalField>
        </div>

        <div className="rounded-xl border border-amber-100 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/40 px-4 py-2.5 text-[12px] leading-[1.6] text-amber-800 dark:text-amber-200">
          Mỗi ảnh mất khoảng 1 phút và tốn phí của nhà cung cấp.
        </div>

        {status && (
          <div
            className={`rounded-xl border px-4 py-2.5 text-[13px] ${
              status.tone === "green"
                ? "border-emerald-100 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
                : status.tone === "blue"
                  ? "border-sky-100 dark:border-sky-900/50 bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300"
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
