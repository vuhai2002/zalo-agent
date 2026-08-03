import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ManagedAgent } from "../dashboard-api-client";
import { api, ApiError } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { IconBot } from "../shared/dashboard-icons";
import { AgentCreateModal } from "./agent-create-modal";
import { useConfirmDialog } from "../shared/confirm-dialog";
import { Badge } from "../shared/ui-bits";

/**
 * Danh sách agent. Tạo mở modal 2 ô (nhanh), sửa mở trang riêng `/agents/:id`
 * (đủ chỗ cho model, công cụ, ngân sách token) - xem
 * `plans/260802-1348-agent-chuan-production/phase-01-*`.
 */
export function AgentsPage() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<ManagedAgent[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  /** Nhà cung cấp chung - để biết agent nào khai provider LỆCH */
  const [providerChung, setProviderChung] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirmDialog();

  const reload = () => api.agentsAdmin.list().then((d) => setAgents(d.items)).catch(() => setAgents([]));
  useEffect(() => {
    void reload();
    // Lỗi thì bỏ qua: đây chỉ để hiện cảnh báo, không được làm chết trang
    void api.provider().then((p) => setProviderChung(p.provider)).catch(() => undefined);
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
        icon={IconBot}
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

      {error && <p className="mb-4 text-[13px] text-red-600 dark:text-red-400">{error}</p>}

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
                  {/* Override provider LỆCH bị `doiProviderAnToan` bỏ qua ở
                      tầng dựng client, nên badge model ở đây là NÓI DỐI: bot
                      đang chạy model chung chứ không phải model ghi trên badge.
                      Trang chi tiết có cảnh báo, danh sách thì trước đó không. */}
                  {agent.modelName &&
                    (providerChung !== null &&
                    agent.modelProvider !== null &&
                    agent.modelProvider !== providerChung ? (
                      <Badge tone="amber" dot={false}>
                        {agent.modelName} - override bị bỏ qua
                      </Badge>
                    ) : (
                      <Badge tone="gray" dot={false}>{agent.modelName}</Badge>
                    ))}
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
                  onClick={() => navigate(`/agents/${encodeURIComponent(agent.id)}`)}
                  className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-tile"
                >
                  Sửa
                </button>
                {!agent.isDefault && (
                  <button
                    onClick={() => remove(agent)}
                    className="rounded-lg px-3 py-1.5 text-[13px] text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                  >
                    Xóa
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {creating && (
        <AgentCreateModal
          onClose={() => setCreating(false)}
          // Tạo xong đi thẳng vào trang sửa: ai muốn chỉnh tiếp thì đã ở đúng
          // chỗ, ai không thì đóng lại là xong
          onCreated={(id) => navigate(`/agents/${encodeURIComponent(id)}`)}
        />
      )}

      {confirmDialog}
    </div>
  );
}
