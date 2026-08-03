import type { ReasoningEffort } from "../dashboard-api-client";
import { kiemSoBuoc, kiemTranContext } from "./agent-field-validators";
import { SelectMenu } from "../shared/select-menu";
import { AgentFormField, AgentFormRow, AgentFormSection } from "./agent-form-field";

export type AgentModelForm = {
  /** "" = theo Cấu hình chung */
  maxSteps: string;
  /** "" = theo Cấu hình chung */
  reasoningEffort: "" | ReasoningEffort;
  /** "" = theo Cấu hình chung */
  contextWindow: string;
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
 * Cả ba trường đều mang nghĩa "để trống = theo cấu hình chung", nên placeholder
 * của mỗi ô ghi thẳng "theo Cấu hình" thay vì để trống trơn - nhìn ô rỗng mà
 * không biết nó đang chạy theo cái gì là câu hỏi hay gặp nhất ở màn này.
 *
 * Nhà cung cấp và tên model KHÔNG còn đặt riêng được ở đây - xem lý do ở khối
 * chú thích trong phần thân.
 */
export function AgentModelSection({
  form,
  onChange,
}: {
  form: AgentModelForm;
  onChange: (patch: Partial<AgentModelForm>) => void;
}) {
  const loiSoBuoc = kiemSoBuoc(form.maxSteps);
  const loiTran = kiemTranContext(form.contextWindow);
  return (
    <AgentFormSection
      title="Model"
      hint="Để trống mọi ô ở đây thì agent chạy đúng cấu hình chung. Chỉ đặt riêng khi agent này cần giới hạn hoặc mức suy nghĩ khác phần còn lại. Nhà cung cấp và tên model luôn lấy từ trang Cấu hình."
    >
      {/*
        Đã BỎ hai ô "Nhà cung cấp" và "Model".

        Nhà cung cấp: mọi lựa chọn khác cấu hình chung đều bị khóa (đổi được thì
        mới có nghĩa khi agent có API key riêng, mà chưa có) - một ô chọn chỉ
        chọn được đúng thứ nó đang là thì chỉ tổ chiếm chỗ.

        Model: bỏ theo luôn cho khỏi nửa vời - đặt tên model riêng trong khi nhà
        cung cấp buộc phải theo chung là đường dễ ra 400 hơn là hữu ích.

        Giá trị cũ trong DB được `thanhPatch` dọn: nó luôn gửi null cho hai cột
        này, nên lần Lưu kế tiếp là sạch. Trang danh sách agent vẫn hiện badge
        tên model nếu còn sót, đó là chỗ duy nhất thấy được.
      */}
      <AgentFormRow>
        <AgentFormField
          ngang
          label="Số bước tối đa"
          htmlFor="ag-d-steps"
          hint="Một bước là một lần bot nói chuyện với model, có thể gọi nhiều công cụ cùng lúc. Bỏ trống là theo trang Cấu hình."
        >
          {/*
            CỐ Ý dùng type="text" + inputMode numeric chứ không phải type="number".
            Với type="number", trình duyệt tự nuốt ký tự rác thành chuỗi rỗng
            (`e.target.value === ""`), mà rỗng ở đây MANG NGHĨA "theo Cấu hình
            chung" - nên gõ nhầm một chữ là âm thầm xoá mất giới hạn bước của
            agent, trong khi ô vẫn hiện chữ vừa gõ. Đổi sang text thì chữ rác ở
            lại đúng chỗ và `loiSoBuoc` bắt được.
          */}
          {/* Đơn vị cùng dòng với ô nhập, khoảng giá trị xuống dòng dưới -
              đúng nhịp của `TuningFieldControl` bên trang Cấu hình */}
          <div className="flex items-center gap-2">
            <input
              id="ag-d-steps"
              type="text"
              inputMode="numeric"
              className="gc-input w-32 shrink-0"
              value={form.maxSteps}
              onChange={(e) => onChange({ maxSteps: e.target.value })}
              placeholder="theo Cấu hình"
              aria-invalid={loiSoBuoc !== ""}
            />
            <span className="whitespace-nowrap text-[13px] text-ink-soft">bước</span>
          </div>
          <div className="mt-1 whitespace-nowrap text-[11px] text-ink-soft/70">(1 - 30)</div>
          {loiSoBuoc && <p className="mt-2 text-[12px] text-red-600 dark:text-red-400">{loiSoBuoc}</p>}
        </AgentFormField>
      </AgentFormRow>

      <AgentFormRow>
        <AgentFormField
          ngang
          label="Trần token mỗi lần gọi"
          htmlFor="ag-d-ctx"
          hint="Ngữ cảnh vượt mức này thì bot tự bỏ bớt ảnh cũ trước, rồi mới bỏ tin cũ - phần bỏ đi vẫn còn trong bản tóm tắt. Đặt riêng khi agent này chạy model có cửa sổ khác. Bỏ trống là theo trang Cấu hình."
        >
          <div className="flex items-center gap-2">
            <input
              id="ag-d-ctx"
              type="text"
              inputMode="numeric"
              className="gc-input w-32 shrink-0"
              value={form.contextWindow}
              onChange={(e) => onChange({ contextWindow: e.target.value })}
              placeholder="theo Cấu hình"
              aria-invalid={loiTran !== ""}
            />
            <span className="whitespace-nowrap text-[13px] text-ink-soft">token</span>
          </div>
          <div className="mt-1 whitespace-nowrap text-[11px] text-ink-soft/70">(4.000 - 2.000.000)</div>
          {loiTran && <p className="mt-2 text-[12px] text-red-600 dark:text-red-400">{loiTran}</p>}
        </AgentFormField>
      </AgentFormRow>

      <AgentFormRow>
        <AgentFormField
          ngang
          label="Mức suy nghĩ"
          htmlFor="ag-d-effort"
          hint="Nghĩ càng kỹ thì trả lời càng chắc nhưng chậm hơn và tốn token hơn. Việc đối chiếu số liệu, dò bảng nên để mức cao; trò chuyện thường để vừa là đủ."
        >
          <div className="w-full">
            <SelectMenu
              id="ag-d-effort"
              size="md"
              value={form.reasoningEffort}
              options={MUC_SUY_NGHI.map((m) => ({ value: m.value, label: m.label }))}
              onChange={(v) => onChange({ reasoningEffort: v as AgentModelForm["reasoningEffort"] })}
            />
          </div>
        </AgentFormField>
      </AgentFormRow>
    </AgentFormSection>
  );
}
