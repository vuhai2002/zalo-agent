import { useEffect, useState } from "react";
import type { ManagedAgent } from "../dashboard-api-client";
import { api, ApiError } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { AgentEditDrawer } from "./agent-edit-drawer";
import { useConfirmDialog } from "../shared/confirm-dialog";
import { Badge } from "../shared/ui-bits";

/** Trang Agents theo mẫu GoClaw: card não (icon, tên, persona preview), tạo/sửa/xóa */
export function AgentsPage() {
  const [agents, setAgents] = useState<ManagedAgent[]>([]);
  const [editing, setEditing] = useState<ManagedAgent | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const { confirm, confirmDialog } = useConfirmDialog();

  const reload = () => api.agentsAdmin.list().then((d) => setAgents(d.items)).catch(() => setAgents([]));
  useEffect(() => {
    void reload();
  }, []);

  async function remove(agent: ManagedAgent) {
    const ok = await confirm({
      title: `Xóa agent "${agent.name}"?`,
      message: "Persona và cấu hình model riêng của agent này sẽ mất.",
    });
    if (!ok) return;
    setError("");
    try {
      await api.agentsAdmin.remove(agent.id);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xóa thất bại");
    }
  }

  return (
    <div>
      <PageHeader
        title="Agents"
        subtitle="Mỗi agent là một bộ não: persona + model riêng, gắn vào tài khoản Zalo ở trang Accounts"
        aside={
          <button
            onClick={() => setCreating(true)}
            className="rounded-lg bg-zalo-500 px-4 py-2 text-[14px] font-medium text-white hover:bg-zalo-600"
          >
            Tạo agent
          </button>
        }
      />

      {error && <p className="mb-4 text-[13px] text-red-600">{error}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {agents.map((agent) => (
          <div key={agent.id} className="gc-card flex flex-col p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-tile text-[22px]">
                {agent.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink">{agent.name}</span>
                  {agent.isDefault && <Badge tone="blue" dot={false}>Mặc định</Badge>}
                  {agent.modelName && (
                    <Badge tone="gray" dot={false}>{agent.modelName}</Badge>
                  )}
                </div>
                <div className="text-[12px] text-ink-soft/60">{agent.id}</div>
              </div>
            </div>

            <p className="mt-3 line-clamp-3 min-h-10 flex-1 text-[13px] leading-relaxed text-ink-soft">
              {agent.persona || "(chưa có persona - dùng giọng mặc định của bot)"}
            </p>

            <div className="mt-4 flex items-center justify-between border-t border-line/70 pt-3">
              <span className="text-[12px] text-ink-soft">
                {agent.accountCount > 0 ? `${agent.accountCount} account đang dùng` : "Chưa gắn account nào"}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditing(agent)}
                  className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-tile"
                >
                  Sửa
                </button>
                {!agent.isDefault && (
                  <button
                    onClick={() => remove(agent)}
                    className="rounded-lg px-3 py-1.5 text-[13px] text-red-600 hover:bg-red-50"
                  >
                    Xóa
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {(editing || creating) && (
        <AgentEditDrawer
          agent={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            setEditing(null);
            setCreating(false);
            void reload();
          }}
        />
      )}

      {confirmDialog}
    </div>
  );
}
