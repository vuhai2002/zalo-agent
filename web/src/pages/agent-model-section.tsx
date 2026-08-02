import type { ProviderSettings, ReasoningEffort } from "../dashboard-api-client";
import { kiemSoBuoc, kiemTranContext } from "./agent-field-validators";
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
  /** "" = theo Cấu hình chung */
  contextWindow: string;
};

const NHA_CUNG_CAP = [
  { value: "openai-compatible" as const, label: "openai-compatible (router)" },
  { value: "anthropic" as const, label: "anthropic (gọi thẳng)" },
];

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
  // `chung.model` rỗng khi chưa cấu hình gì (hợp lệ từ khi .env hết bắt buộc)
  // - ghép thẳng cho ra placeholder cụt kiểu "openai-compatible / "
  const nhanChung = chung?.model ? `${chung.provider} / ${chung.model}` : "theo trang Providers";
  const loiSoBuoc = kiemSoBuoc(form.maxSteps);
  const loiTran = kiemTranContext(form.contextWindow);
  // Giá trị đang lưu không nằm trong danh sách hợp lệ (và không phải rỗng)
  const laGiaTriLa =
    form.modelProvider !== "" && !NHA_CUNG_CAP.some((p) => p.value === form.modelProvider);

  return (
    <AgentFormSection
      title="Model"
      hint="Để trống mọi ô ở đây thì agent chạy đúng cấu hình chung. Chỉ đặt riêng khi agent này cần model hoặc mức suy nghĩ khác phần còn lại."
    >
      <AgentFormRow>
        <AgentFormField
          label="Nhà cung cấp"
          htmlFor="ag-d-provider"
          hint="Đổi được nhà cung cấp thì mới có ý nghĩa khi agent có API key riêng - hiện chưa có, key và base URL vẫn lấy từ trang Providers cho mọi agent."
        >
          <select
            id="ag-d-provider"
            className="gc-input w-full max-w-sm cursor-pointer"
            value={form.modelProvider}
            onChange={(e) => onChange({ modelProvider: e.target.value as AgentModelForm["modelProvider"] })}
          >
            <option value="">Theo Providers chung{chung ? ` (${chung.provider})` : ""}</option>
            {/*
              Khóa mọi lựa chọn KHÁC nhà cung cấp chung. `resolveLanguageModel`
              (llm-provider.ts) chỉ override `provider` và `model`, còn `apiKey`
              luôn lấy từ cấu hình chung - chọn lệch nghĩa là gửi key của router
              thẳng sang api.anthropic.com. Vừa rò credential sang bên thứ ba
              vừa làm bot câm (401 -> mọi lượt trả câu xin lỗi chung).

              Vẫn hiện ra chứ không ẩn, để người dùng thấy được và xoá được một
              giá trị cũ lỡ nằm sẵn trong DB.
            */}
            {NHA_CUNG_CAP.map((p) => (
              <option key={p.value} value={p.value} disabled={chung !== null && chung.provider !== p.value}>
                {p.label}
                {chung !== null && chung.provider !== p.value ? " - cần API key riêng" : ""}
              </option>
            ))}
            {/* Giá trị lạ nằm sẵn trong DB (ai đó sửa tay từ trước) phải có một
                option khớp, nếu không `<select>` render TRỐNG: người dùng thấy ô
                rỗng, `coDoi` vẫn false nên không sửa được, mà sửa ô khác rồi Lưu
                thì giá trị lạ bị gửi lại và server trả 400 - kẹt hẳn, không lưu
                được gì cho tới khi sửa DB tay. */}
            {laGiaTriLa && (
              <option value={form.modelProvider}>{form.modelProvider} - giá trị lạ, nên đổi lại</option>
            )}
          </select>
          {chung && form.modelProvider !== "" && form.modelProvider !== chung.provider && (
            <p className="mt-2 max-w-3xl text-[12px] leading-[1.6] text-amber-600 dark:text-amber-400">
              Agent này đang đặt nhà cung cấp khác cấu hình chung, mà API key vẫn là key chung. Bot sẽ BỎ QUA
              lựa chọn này và chạy bằng cấu hình chung - đặt ở đây không có tác dụng. Chọn "Theo Providers
              chung" cho khỏi hiểu nhầm.
            </p>
          )}
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
          {/*
            CỐ Ý dùng type="text" + inputMode numeric chứ không phải type="number".
            Với type="number", trình duyệt tự nuốt ký tự rác thành chuỗi rỗng
            (`e.target.value === ""`), mà rỗng ở đây MANG NGHĨA "theo Cấu hình
            chung" - nên gõ nhầm một chữ là âm thầm xoá mất giới hạn bước của
            agent, trong khi ô vẫn hiện chữ vừa gõ. Đổi sang text thì chữ rác ở
            lại đúng chỗ và `loiSoBuoc` bắt được.
          */}
          <div className="flex items-center gap-2">
            <input
              id="ag-d-steps"
              type="text"
              inputMode="numeric"
              className="gc-input w-40"
              value={form.maxSteps}
              onChange={(e) => onChange({ maxSteps: e.target.value })}
              placeholder="theo Cấu hình"
              aria-invalid={loiSoBuoc !== ""}
            />
            <span className="text-[13px] text-ink-soft">bước</span>
            <span className="text-[12px] text-ink-soft/70">(1 - 30)</span>
          </div>
          {loiSoBuoc && <p className="mt-2 text-[12px] text-red-600 dark:text-red-400">{loiSoBuoc}</p>}
        </AgentFormField>
      </AgentFormRow>

      <AgentFormRow>
        <AgentFormField
          label="Trần token mỗi lần gọi"
          htmlFor="ag-d-ctx"
          hint="Ngữ cảnh vượt mức này thì bot tự bỏ bớt ảnh cũ trước, rồi mới bỏ tin cũ - phần bỏ đi vẫn còn trong bản tóm tắt. Đặt riêng khi agent này chạy model có cửa sổ khác. Bỏ trống là theo trang Cấu hình."
        >
          <div className="flex items-center gap-2">
            <input
              id="ag-d-ctx"
              type="text"
              inputMode="numeric"
              className="gc-input w-40"
              value={form.contextWindow}
              onChange={(e) => onChange({ contextWindow: e.target.value })}
              placeholder="theo Cấu hình"
              aria-invalid={loiTran !== ""}
            />
            <span className="text-[13px] text-ink-soft">token</span>
            <span className="text-[12px] text-ink-soft/70">(4.000 - 2.000.000)</span>
          </div>
          {loiTran && <p className="mt-2 text-[12px] text-red-600 dark:text-red-400">{loiTran}</p>}
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
