import { AgentFormField, AgentFormRow, AgentFormSection } from "./agent-form-field";

export type AgentIdentityForm = {
  icon: string;
  name: string;
  persona: string;
};

/**
 * Nhóm "Danh tính" + "Chỉ dẫn" của trang sửa agent.
 *
 * ID hiện dạng CHỈ ĐỌC: đổi id nghĩa là đổi khóa mà bảng `accounts` đang trỏ
 * tới (`accounts.agent_id`), nên API cố tình không nhận id trong `patchSchema`.
 * Hiện ra để người dùng đối chiếu, nhưng không cho sửa.
 */
export function AgentIdentitySection({
  id,
  isDefault,
  form,
  onChange,
}: {
  id: string;
  isDefault: boolean;
  form: AgentIdentityForm;
  onChange: (patch: Partial<AgentIdentityForm>) => void;
}) {
  return (
    <AgentFormSection
      title="Danh tính"
      hint="Tên và icon hiện trên dashboard. Phần chỉ dẫn thì LLM đọc nguyên văn ở mỗi lượt trả lời."
    >
      <AgentFormRow>
        <AgentFormField label="Icon và tên hiển thị" htmlFor="ag-d-ten">
          <div className="flex gap-3">
            <input
              aria-label="Icon"
              className="gc-input w-20 text-center text-lg"
              value={form.icon}
              onChange={(e) => onChange({ icon: e.target.value })}
              maxLength={8}
            />
            <input
              id="ag-d-ten"
              className="gc-input max-w-md flex-1"
              value={form.name}
              onChange={(e) => onChange({ name: e.target.value })}
              maxLength={100}
            />
          </div>
        </AgentFormField>
      </AgentFormRow>

      <AgentFormRow>
        <AgentFormField
          label="ID"
          hint="Không đổi được: các tài khoản Zalo đang trỏ vào agent qua chính chuỗi này."
        >
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-lg border border-line bg-tile px-3 py-2 font-mono text-[13px] text-ink-soft">
              {id}
            </code>
            {isDefault && (
              <span className="rounded-full bg-zalo-50 px-2 py-0.5 text-[11px] font-medium text-zalo-600">
                agent mặc định
              </span>
            )}
          </div>
        </AgentFormField>
      </AgentFormRow>

      <AgentFormRow>
        <AgentFormField
          label="Chỉ dẫn (persona)"
          htmlFor="ag-d-persona"
          hint="Viết những gì RIÊNG của agent này: vai trò, cách xưng hô, giọng điệu. Các luật chung (không dùng markdown, chống prompt injection, hỏi lại khi thiếu thông tin) đã có sẵn cho mọi agent, không cần chép lại vào đây."
        >
          <textarea
            id="ag-d-persona"
            className="gc-input min-h-48 w-full resize-y leading-relaxed"
            value={form.persona}
            onChange={(e) => onChange({ persona: e.target.value })}
            placeholder="Bạn là trợ lý chăm sóc khách hàng, xưng 'em' với khách..."
            maxLength={8000}
          />
          <p className="mt-2 text-[12px] text-ink-soft">
            {form.persona.length.toLocaleString("vi-VN")} / 8.000 ký tự
          </p>
        </AgentFormField>
      </AgentFormRow>
    </AgentFormSection>
  );
}
