import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type McpServerListItem } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { useConfirmDialog } from "../shared/confirm-dialog";
import { IconGlobe } from "../shared/dashboard-icons";
import { EmptyRow, TableShell } from "../shared/ui-bits";
import { McpAssignAgentsModal } from "./mcp-assign-agents-modal";
import { McpServerFormModal } from "./mcp-server-form-modal";
import { McpServerRow } from "./mcp-server-row";

// Cùng lý do với `knowledge-page.tsx`: POST/PATCH nối lại server ở NỀN (không
// chặn response), nên trang phải tự làm mới định kỳ để thấy badge đổi
// cho_ket_noi -> da_ket_noi/loi mà không cần F5. Không phân trang/tìm kiếm
// (khác KB): số server MCP một cài đặt thực tế chỉ vài cái, thêm UI đó là
// over-engineer cho quy mô này.
const KHOANG_POLL_MS = 4000;

/**
 * Trang MCP: quản server MCP ngoài (HTTP-only) cho agent dùng tool của chúng.
 * Cùng dạng "danh sách + gán agent" với trang Kho tri thức - nạp xong PHẢI GÁN
 * cho agent thì bot mới gọi được tool (default-deny).
 */
export function McpPage() {
  const [servers, setServers] = useState<McpServerListItem[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  // "new" = mở form ở chế độ tạo mới; một server cụ thể = chế độ sửa
  const [formFor, setFormFor] = useState<McpServerListItem | "new" | null>(null);
  const [ganAgentCho, setGanAgentCho] = useState<McpServerListItem | null>(null);
  const { confirm, confirmDialog } = useConfirmDialog();

  const reload = useCallback(() => {
    api.mcp
      .list()
      .then((d) => {
        setServers(d.servers);
        setLoadError("");
      })
      .catch((err: unknown) => {
        setServers((cu) => cu ?? []);
        setLoadError(err instanceof ApiError ? err.message : "Không tải được danh sách server");
      });
  }, []);

  useEffect(() => {
    reload();
    const timer = window.setInterval(reload, KHOANG_POLL_MS);
    return () => window.clearInterval(timer);
  }, [reload]);

  async function remove(server: McpServerListItem) {
    const ok = await confirm({
      title: `Xóa server "${server.ten}"?`,
      message:
        server.soAgentGan > 0
          ? `${server.soAgentGan} agent đang dùng server này sẽ mất quyền gọi tool ngoài của nó.`
          : "Chưa agent nào dùng server này.",
    });
    if (!ok) return;
    setActionError("");
    try {
      await api.mcp.remove(server.id);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Xóa thất bại");
    }
  }

  async function reapprove(server: McpServerListItem) {
    setActionError("");
    try {
      await api.mcp.reapprove(server.id);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Duyệt lại thất bại");
    }
  }

  return (
    <div>
      <PageHeader
        icon={IconGlobe}
        title="MCP"
        subtitle="Server MCP ngoài cắm cho agent dùng tool của chúng - thêm xong phải GÁN cho agent thì bot mới gọi được"
        aside={
          <button
            onClick={() => setFormFor("new")}
            className="cursor-pointer rounded-lg bg-zalo-500 px-4 py-2 text-[14px] font-medium text-white hover:bg-zalo-600"
          >
            Thêm server
          </button>
        }
      />

      {actionError && <p className="mb-4 text-[13px] text-red-600 dark:text-red-400">{actionError}</p>}
      {loadError && <p className="mb-4 text-[13px] text-red-600 dark:text-red-400">{loadError}</p>}

      <TableShell headers={["Tên", "URL", "Trạng thái", "Số tool", "Agent đang dùng", "Cập nhật", ""]} minWidth={960} ghimCotCuoi>
        {servers === null ? (
          <EmptyRow colSpan={7} text="Đang tải..." />
        ) : servers.length === 0 ? (
          <EmptyRow colSpan={7} text='Chưa có server nào - bấm "Thêm server" để cắm MCP server ngoài' />
        ) : (
          servers.map((s) => (
            <McpServerRow
              key={s.id}
              server={s}
              onEdit={() => setFormFor(s)}
              onDelete={() => void remove(s)}
              onAssignAgents={() => setGanAgentCho(s)}
              onReapprove={() => void reapprove(s)}
            />
          ))
        )}
      </TableShell>

      {formFor && (
        <McpServerFormModal
          server={formFor === "new" ? null : formFor}
          onClose={() => setFormFor(null)}
          onSaved={() => {
            setFormFor(null);
            reload();
          }}
        />
      )}

      {ganAgentCho && (
        <McpAssignAgentsModal server={ganAgentCho} onClose={() => setGanAgentCho(null)} onSaved={reload} />
      )}

      {confirmDialog}
    </div>
  );
}
