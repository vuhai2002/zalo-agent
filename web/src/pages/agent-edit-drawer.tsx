import { useState } from "react";
import type { ManagedAgent } from "../dashboard-api-client";
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
        });
      } else {
        const created = await api.agentsAdmin.create({
          id: form.id,
          icon: form.icon,
          name: form.name,
          persona: form.persona,
        });
        if (form.modelOverride.trim()) {
          await api.agentsAdmin.update(created.agent.id, { modelName: form.modelOverride.trim() });
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
