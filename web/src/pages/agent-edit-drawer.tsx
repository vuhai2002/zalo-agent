import { useState } from "react";
import type { ManagedAgent, ReasoningEffort } from "../dashboard-api-client";
import { api, ApiError } from "../dashboard-api-client";

/** Drawer tạo/sửa agent. agent=null nghĩa là tạo mới. */
export function AgentEditDrawer({
  agent,
  onClose,
  onSaved,
}: {
  agent: ManagedAgent | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    id: agent?.id ?? "",
    icon: agent?.icon ?? "🤖",
    name: agent?.name ?? "",
    persona: agent?.persona ?? "",
    modelOverride: agent?.modelName ?? "",
    // Chuỗi rỗng = "theo mặc định chung", gửi lên thành null
    maxSteps: agent?.maxSteps == null ? "" : String(agent.maxSteps),
    reasoningEffort: agent?.reasoningEffort ?? "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError("");
    try {
      if (agent) {
        await api.agentsAdmin.update(agent.id, {
          icon: form.icon,
          name: form.name,
          persona: form.persona,
          modelName: form.modelOverride.trim() || null,
          maxSteps: form.maxSteps.trim() === "" ? null : Number(form.maxSteps),
          reasoningEffort: form.reasoningEffort === "" ? null : (form.reasoningEffort as ReasoningEffort),
        });
      } else {
        const created = await api.agentsAdmin.create({
          id: form.id,
          icon: form.icon,
          name: form.name,
          persona: form.persona,
        });
        const themVao = {
          ...(form.modelOverride.trim() ? { modelName: form.modelOverride.trim() } : {}),
          ...(form.maxSteps.trim() ? { maxSteps: Number(form.maxSteps) } : {}),
          ...(form.reasoningEffort ? { reasoningEffort: form.reasoningEffort as ReasoningEffort } : {}),
        };
        if (Object.keys(themVao).length > 0) {
          await api.agentsAdmin.update(created.agent.id, themVao);
        }
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Lưu thất bại");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/25 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-line bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="font-semibold text-ink">{agent ? `Sửa: ${agent.name}` : "Tạo agent mới"}</div>
          <button
            onClick={onClose}
            className="rounded-lg border border-line px-3 py-1 text-[13px] text-ink-soft hover:bg-tile"
          >
            Đóng
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {!agent && (
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-ink">
                ID <span className="font-normal text-ink-soft">(kebab-case, không đổi được sau này)</span>
              </label>
              <input
                className="gc-input w-full"
                value={form.id}
                onChange={(e) => setForm({ ...form, id: e.target.value })}
                placeholder="vd: tu-van-khoa-hoc"
              />
            </div>
          )}

          <div className="flex gap-3">
            <div className="w-20">
              <label className="mb-1.5 block text-[13px] font-medium text-ink">Icon</label>
              <input
                className="gc-input w-full text-center text-lg"
                value={form.icon}
                onChange={(e) => setForm({ ...form, icon: e.target.value })}
              />
            </div>
            <div className="flex-1">
              <label className="mb-1.5 block text-[13px] font-medium text-ink">Tên hiển thị</label>
              <input
                className="gc-input w-full"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="vd: Tư Vấn Khóa Học"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-ink">
              Persona / chỉ dẫn <span className="font-normal text-ink-soft">(LLM đọc nguyên văn)</span>
            </label>
            <textarea
              className="gc-input min-h-48 w-full resize-y leading-relaxed"
              value={form.persona}
              onChange={(e) => setForm({ ...form, persona: e.target.value })}
              placeholder="Bạn là trợ lý tư vấn khóa học, xưng 'em' với khách..."
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-ink">
              Model override <span className="font-normal text-ink-soft">(bỏ trống = dùng Providers chung)</span>
            </label>
            <input
              className="gc-input w-full"
              value={form.modelOverride}
              onChange={(e) => setForm({ ...form, modelOverride: e.target.value })}
              placeholder="vd: claude-sonnet-5"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label htmlFor="agent-max-steps" className="mb-1.5 block text-[13px] font-medium text-ink">
                Số bước tối đa <span className="font-normal text-ink-soft">(bỏ trống = theo Cấu hình)</span>
              </label>
              <input
                id="agent-max-steps"
                type="number"
                min={1}
                max={30}
                className="gc-input w-full"
                value={form.maxSteps}
                onChange={(e) => setForm({ ...form, maxSteps: e.target.value })}
                placeholder="vd: 8"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="agent-effort" className="mb-1.5 block text-[13px] font-medium text-ink">
                Mức suy nghĩ <span className="font-normal text-ink-soft">(bỏ trống = theo Cấu hình)</span>
              </label>
              <select
                id="agent-effort"
                className="gc-input w-full cursor-pointer"
                value={form.reasoningEffort}
                onChange={(e) => setForm({ ...form, reasoningEffort: e.target.value })}
              >
                <option value="">Theo mặc định chung</option>
                <option value="off">Tắt</option>
                <option value="low">Thấp</option>
                <option value="medium">Vừa</option>
                <option value="high">Cao</option>
                <option value="xhigh">Rất cao</option>
              </select>
            </div>
          </div>

          <p className="text-[12px] leading-[1.6] text-ink-soft">
            Nghĩ càng kỹ thì trả lời càng chắc nhưng chậm hơn và tốn token hơn. Việc đối chiếu số liệu,
            dò bảng nên để mức cao; trò chuyện thường để vừa là đủ.
          </p>

          {error && <p className="text-[13px] text-red-600">{error}</p>}
        </div>

        <div className="border-t border-line px-5 py-4">
          <button
            onClick={save}
            disabled={busy || !form.name || (!agent && !form.id)}
            className="w-full rounded-lg bg-zalo-500 py-2.5 text-[14px] font-medium text-white hover:bg-zalo-600 disabled:opacity-50"
          >
            {busy ? "Đang lưu..." : agent ? "Lưu thay đổi" : "Tạo agent"}
          </button>
        </div>
      </div>
    </div>
  );
}
