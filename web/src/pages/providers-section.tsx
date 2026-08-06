import { SecretInput } from "../shared/secret-input";
import { SelectMenu } from "../shared/select-menu";
import { BASE_URL_PRESETS, laUrlGemini, timPreset, TU_NHAP } from "./llm-base-url-presets";
import { useProviderForm } from "./use-provider-form";

/**
 * Form nhà cung cấp LLM. Trước đây là một trang riêng trên sidebar; giờ là nội
 * dung của nhóm "providers" trong trang Cấu hình - mọi cấu hình về một chỗ.
 *
 * Vẫn là form có nút Lưu chứ không tách thành từng tham số tự-lưu như các ô
 * bên cạnh: bốn giá trị này phải đi cùng nhau. Lưu Base URL mới trong khi Model
 * còn của nhà cũ là bot gọi sai suốt quãng giữa.
 */
export function ProvidersSection() {
  const { settings, form, setForm, doiProvider, status, busy, save, test, reset, confirmDialog } =
    useProviderForm();

  if (!settings) return <p className="text-[13px] text-ink-soft">Đang tải...</p>;

  return (
    <div className="max-w-2xl">
      {/* Không còn khối viền bọc ngoài: từ khi nằm trong panel của trang Cấu
          hình thì card lồng trong card là "khối lồng khối", cùng lý do các ô
          tham số bên cạnh cũng phẳng. Nhãn nhóm và mô tả đã do panel in ra.
          Cũng bỏ badge "Đang dùng override" - tiếng lóng lập trình, mà từ khi
          .env hết gánh cấu hình LLM thì nó gần như luôn bật, không nói thêm gì. */}
      <div className="space-y-4">
        <div>
          {/* "Kiểu kết nối" chứ không phải "Provider": ô này chọn GIAO THỨC,
              không chọn hãng. Mọi hãng nói giao thức OpenAI (DeepSeek, Kimi,
              Qwen, OpenRouter, Ollama...) đều đi nhánh đầu; hai nhánh dưới dành
              cho API GỐC của Anthropic và Google, vốn khác hình dạng.

              Gemini phải đi nhánh riêng chứ không đi lớp giả OpenAI của Google:
              lớp giả làm rơi `thought_signature` nên mọi lượt gọi tool ăn 400.
              Xem `llm-base-url-presets.ts`. */}
          <label className="mb-1.5 block text-[13px] font-medium text-ink" htmlFor="pv-provider">
            Kiểu kết nối
          </label>
          <SelectMenu
            id="pv-provider"
            size="md"
            value={form.provider}
            options={[
              { value: "openai-compatible", label: "OpenAI-compatible" },
              { value: "anthropic", label: "Anthropic" },
              { value: "google", label: "Google (Gemini)" },
            ]}
            onChange={doiProvider}
          />
          {form.provider === "openai-compatible" && laUrlGemini(form.baseUrl) && (
            <p className="mt-1.5 text-[13px] text-amber-600 dark:text-amber-500">
              Base URL này là lớp giả OpenAI của Google. Chat chay chạy được, nhưng mọi lượt bot
              gọi công cụ sẽ lỗi. Đổi Kiểu kết nối sang <strong>Google (Gemini)</strong> - key và
              tên model giữ nguyên.
            </p>
          )}
        </div>

        {form.provider === "openai-compatible" && (
          <>
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-ink" htmlFor="pv-preset">
                Chọn nhanh
              </label>
              {/* Chỉ ĐIỀN HỘ base URL rồi thôi - không đụng model hay key, vì
                  mỗi hãng một bộ tên model và người dùng vẫn phải tự dán key.
                  Base URL đang nhập khớp mục nào thì danh sách hiện đúng mục đó,
                  không khớp thì về "Tự nhập" (trường hợp router riêng). */}
              <SelectMenu
                id="pv-preset"
                size="md"
                value={timPreset(form.baseUrl)}
                placeholder="Tự nhập"
                options={[
                  { value: TU_NHAP, label: "Tự nhập" },
                  ...BASE_URL_PRESETS.map((p) => ({ value: p.baseUrl, label: p.label, hint: p.baseUrl })),
                ]}
                onChange={(baseUrl) => baseUrl && setForm({ ...form, baseUrl })}
              />
            </div>

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
          </>
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
