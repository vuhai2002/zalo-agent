import type { ProviderSettings, ReasoningEffort } from "../dashboard-api-client";
import { AgentFormField, AgentFormRow, AgentFormSection } from "./agent-form-field";

export type AgentModelForm = {
  /** "" = theo Providers chung */
  modelProvider: "" | "openai-compatible" | "anthropic";
  /** "" = theo Providers chung */
  modelName: string;
  /** "" = theo Cấu hình chung */
  maxSteps: string;
  /** "" = theo Cấu hình chung */
  reasoningEffort: "" | ReasoningEffort;
};

const MUC_SUY_NGHI: { value: "" | ReasoningEffort; label: string }[] = [
  { value: "", label: "Theo Cấu hình chung" },
  { value: "off", label: "Tắt" },
  { value: "low", label: "Thấp" },
  { value: "medium", label: "Vừa" },
  { value: "high", label: "Cao" },
  { value: "xhigh", label: "Rất cao" },
];

/**
 * Nhóm "Model" của trang sửa agent.
 *
 * Mọi trường ở đây đều mang nghĩa "để trống = theo cấu hình chung", đúng nếp
 * `maxSteps`/`reasoningEffort` đã có từ trước. Nên chỗ nào cũng phải nói được
 * "chung" ĐANG là gì - `chung` truyền vào chính là để hiện con số thật thay vì
 * bắt người dùng mở tab Providers ra đối chiếu.
 *
 * Trường Model cố ý vẫn là ô gõ tự do: trang Providers không giữ danh sách model
 * nào (cũng là một ô text), nên dựng dropdown ở đây sẽ là danh sách bịa. Thay vào
 * đó lấy model chung làm placeholder - vừa thật vừa trả lời đúng câu người dùng
 * hay hỏi ("bỏ trống thì nó chạy model gì?").
 */
export function AgentModelSection({
  form,
  chung,
  onChange,
}: {
  form: AgentModelForm;
  /** Cấu hình Providers đang hiệu lực; null khi chưa tải được */
  chung: ProviderSettings | null;
  onChange: (patch: Partial<AgentModelForm>) => void;
}) {
  const nhanChung = chung ? `${chung.provider} / ${chung.model}` : "theo trang Providers";

  return (
    <AgentFormSection
      title="Model"
      hint="Để trống mọi ô ở đây thì agent chạy đúng cấu hình chung. Chỉ đặt riêng khi agent này cần model hoặc mức suy nghĩ khác phần còn lại."
    >
      <AgentFormRow>
        <AgentFormField
          label="Nhà cung cấp"
          htmlFor="ag-d-provider"
          hint="Chọn riêng khi muốn agent này gọi thẳng Anthropic trong lúc phần còn lại đi qua router."
        >
          <select
            id="ag-d-provider"
            className="gc-input w-full max-w-sm cursor-pointer"
            value={form.modelProvider}
            onChange={(e) => onChange({ modelProvider: e.target.value as AgentModelForm["modelProvider"] })}
          >
            <option value="">Theo Providers chung{chung ? ` (${chung.provider})` : ""}</option>
            <option value="openai-compatible">openai-compatible (router)</option>
            <option value="anthropic">anthropic (gọi thẳng)</option>
          </select>
        </AgentFormField>
      </AgentFormRow>

      <AgentFormRow>
        <AgentFormField
          label="Model"
          htmlFor="ag-d-model"
          hint="Tên model gửi cho nhà cung cấp. Bỏ trống là dùng model ở trang Providers."
        >
          <input
            id="ag-d-model"
            className="gc-input w-full max-w-sm"
            value={form.modelName}
            onChange={(e) => onChange({ modelName: e.target.value })}
            placeholder={nhanChung}
          />
        </AgentFormField>
      </AgentFormRow>

      <AgentFormRow>
        <AgentFormField
          label="Số bước tối đa"
          htmlFor="ag-d-steps"
          hint="Một bước là một lần bot nói chuyện với model, có thể gọi nhiều công cụ cùng lúc. Bỏ trống là theo trang Cấu hình."
        >
          <div className="flex items-center gap-2">
            <input
              id="ag-d-steps"
              type="number"
              min={1}
              max={30}
              className="gc-input w-40"
              value={form.maxSteps}
              onChange={(e) => onChange({ maxSteps: e.target.value })}
              placeholder="theo Cấu hình"
            />
            <span className="text-[13px] text-ink-soft">bước</span>
            <span className="text-[12px] text-ink-soft/70">(1 - 30)</span>
          </div>
        </AgentFormField>
      </AgentFormRow>

      <AgentFormRow>
        <AgentFormField
          label="Mức suy nghĩ"
          htmlFor="ag-d-effort"
          hint="Nghĩ càng kỹ thì trả lời càng chắc nhưng chậm hơn và tốn token hơn. Việc đối chiếu số liệu, dò bảng nên để mức cao; trò chuyện thường để vừa là đủ."
        >
          <select
            id="ag-d-effort"
            className="gc-input w-full max-w-sm cursor-pointer"
            value={form.reasoningEffort}
            onChange={(e) => onChange({ reasoningEffort: e.target.value as AgentModelForm["reasoningEffort"] })}
          >
            {MUC_SUY_NGHI.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </AgentFormField>
      </AgentFormRow>
    </AgentFormSection>
  );
}
