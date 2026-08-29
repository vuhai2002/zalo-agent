import { useEffect, useState } from "react";
import type { ManagedAgent, McpServerListItem } from "../dashboard-api-client";
import { api, ApiError } from "../dashboard-api-client";
import { useChotNen } from "../shared/backdrop-close-guard";
import { ToggleKnob } from "../shared/ui-bits";

/**
 * Gán MỘT server MCP cho nhiều agent - mirror `kb-assign-agents-modal.tsx`.
 *
 * Mặc định KHÔNG tick agent nào (default-deny): server vừa tạo chưa có dòng
 * nào trong `agent_mcp_servers`, nên `GET /:id/agents` trả mảng rỗng và ô tick
 * tự nhiên trống - không cần logic riêng để ép "mặc định tắt".
 */
export function McpAssignAgentsModal({
  server,
  onClose,
  onSaved,
}: {
  server: McpServerListItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [agents, setAgents] = useState<ManagedAgent[] | null>(null);
  const [ticked, setTicked] = useState<Set<string> | null>(null);
  const [loi, setLoi] = useState("");
  const [dangLuu, setDangLuu] = useState(false);
  const nen = useChotNen(onClose);

  useEffect(() => {
    let huy = false;
    // Hai lời gọi song song: danh sách agent để hiện, và danh sách đang gán để
    // tick sẵn. Chờ cả hai rồi mới dựng `ticked` - dựng sớm từ một nửa dữ liệu
    // là ô tick nhấp nháy từ trạng thái sai sang trạng thái đúng.
    Promise.all([api.agentsAdmin.list(), api.mcp.serverAgents(server.id)])
      .then(([ds, dangGan]) => {
        if (huy) return;
        setAgents(ds.items);
        setTicked(new Set(dangGan.agentIds));
      })
      .catch((err: unknown) => {
        if (huy) return;
        setAgents([]);
        setTicked(new Set());
        setLoi(err instanceof ApiError ? err.message : "Không tải được danh sách agent");
      });
    return () => {
      huy = true;
    };
  }, [server.id]);

  function toggle(id: string) {
    setTicked((truoc) => {
      if (!truoc) return truoc;
      const sau = new Set(truoc);
      if (sau.has(id)) sau.delete(id);
      else sau.add(id);
      return sau;
    });
  }

  async function luu() {
    if (!ticked) return;
    setDangLuu(true);
    setLoi("");
    try {
      await api.mcp.setServerAgents(server.id, [...ticked]);
      onSaved();
      onClose();
    } catch (err: unknown) {
      setLoi(err instanceof ApiError ? err.message : "Không lưu được");
    } finally {
      setDangLuu(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4 backdrop-blur-[2px]" {...nen}>
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-surface shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="truncate font-semibold text-ink">Agent nào được dùng server này</div>
            <div className="truncate text-[12px] text-ink-soft">{server.ten}</div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 cursor-pointer rounded-lg border border-line px-3 py-1 text-[13px] text-ink-soft hover:bg-tile"
          >
            Đóng
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {agents === null && !loi && <p className="text-[13px] text-ink-soft">Đang tải...</p>}
          {agents !== null && agents.length === 0 && !loi && (
            <p className="py-10 text-center text-[13px] leading-relaxed text-ink-soft/60">
              Chưa có agent nào - tạo agent ở trang Agents trước, rồi quay lại gán server
            </p>
          )}
          {agents !== null && agents.length > 0 && (
            <div className="divide-y divide-line">
              {agents.map((a) => (
                <div key={a.id} className="flex w-full items-center justify-between gap-4 py-3 first:pt-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 text-[16px]">{a.icon}</span>
                    <span className="truncate text-[14px] font-medium text-ink">{a.name}</span>
                  </div>
                  <button
                    type="button"
                    aria-label={`Bật tắt agent ${a.name}`}
                    aria-pressed={ticked?.has(a.id) ?? false}
                    onClick={() => toggle(a.id)}
                    className="shrink-0 cursor-pointer"
                  >
                    <ToggleKnob on={ticked?.has(a.id) ?? false} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {loi && <p className="mt-3 text-[13px] text-red-600 dark:text-red-400">{loi}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
          <span className="text-[12px] text-ink-soft">
            {ticked && ticked.size === 0 ? "Không agent nào dùng được server này" : `${ticked?.size ?? 0} agent dùng được`}
          </span>
          <button
            onClick={() => void luu()}
            disabled={dangLuu || ticked === null}
            className="cursor-pointer rounded-lg bg-zalo-600 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-zalo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {dangLuu ? "Đang lưu..." : "Lưu"}
          </button>
        </div>
      </div>
    </div>
  );
}
