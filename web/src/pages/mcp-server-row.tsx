import type { McpServerListItem } from "../dashboard-api-client";
import { IconPencil, IconUndo, IconUsers, IconWarning } from "../shared/dashboard-icons";
import { Badge, formatTime, O_GHIM_PHAI } from "../shared/ui-bits";
import { nhanTrangThai } from "./mcp-status-label";

/**
 * Quy đổi tone THUẦN ("ok"/"warn"/"muted") của `nhanTrangThai` sang tone của
 * `Badge` ("green"/"amber"/"gray") - giữ `mcp-status-label.ts` không phụ thuộc
 * UI để test được như hàm thuần.
 */
const BADGE_TONE = { ok: "green", warn: "amber", muted: "gray" } as const;

export function McpServerRow({
  server,
  onEdit,
  onDelete,
  onAssignAgents,
  onReapprove,
}: {
  server: McpServerListItem;
  onEdit: () => void;
  onDelete: () => void;
  /** Mở modal gán server này cho agent */
  onAssignAgents: () => void;
  /** Chỉ gọi được khi `trangThai === 'can_duyet_lai'` */
  onReapprove: () => void;
}) {
  const nhan = nhanTrangThai(server.trangThai);
  const soTool = server.runtime?.soTool ?? 0;
  const tenTool = server.toolsSnapshot.map((t) => t.ten).join(", ");

  return (
    <tr className="border-b border-line/60 last:border-0 hover:bg-tile/40">
      <td className="max-w-xs px-4 py-3 text-ink">
        <div className="truncate font-medium">{server.ten}</div>
        {server.trangThai === "loi" && server.loi && (
          <div className="mt-0.5 truncate text-[12px] text-red-600 dark:text-red-400" title={server.loi}>
            {server.loi}
          </div>
        )}
        {server.trangThai === "can_duyet_lai" && (
          <div className="mt-0.5 text-[12px] text-amber-600 dark:text-amber-400">
            Bộ tool của server đã đổi so với lần duyệt trước
          </div>
        )}
        {!server.enabled && <div className="mt-0.5 text-[11px] text-ink-soft">Đang tắt</div>}
      </td>
      <td className="max-w-xs truncate px-4 py-3 text-ink-soft" title={server.url}>
        {server.url}
      </td>
      <td className="px-4 py-3">
        <Badge tone={BADGE_TONE[nhan.tone]}>{nhan.chu}</Badge>
      </td>
      <td className="px-4 py-3 text-ink-soft" title={tenTool || undefined}>
        {soTool}
      </td>
      {/* Cột duy nhất phân biệt "server đã nối" với "agent gọi được tool ngoài
          này" - server 0 agent thì bot vẫn không thấy tool nào của nó
          (default-deny), dù badge có hiện "Đã kết nối". */}
      <td className="px-4 py-3">
        <button
          onClick={onAssignAgents}
          title={server.soAgentGan === 0 ? "Chưa agent nào dùng được - bấm để gán" : "Đổi agent dùng được server này"}
          className={`flex cursor-pointer items-center gap-1.5 text-[13px] hover:underline ${
            server.soAgentGan === 0 ? "text-amber-700 dark:text-amber-400" : "text-ink-soft hover:text-ink"
          }`}
        >
          {server.soAgentGan === 0 ? (
            <>
              <IconWarning size={14} />
              Chưa gán
            </>
          ) : (
            <>
              <IconUsers size={14} />
              {server.soAgentGan} agent
            </>
          )}
        </button>
      </td>
      <td className="px-4 py-3 text-ink-soft">{formatTime(server.updatedAt)}</td>
      <td className={`px-4 py-3 ${O_GHIM_PHAI}`}>
        <div className="flex items-center justify-end gap-3">
          {server.trangThai === "can_duyet_lai" && (
            <button
              onClick={onReapprove}
              title="Xem bộ tool hiện tại là đúng ý, lấy làm mốc mới"
              className="flex cursor-pointer items-center gap-1 text-[13px] text-amber-600 hover:underline dark:text-amber-400"
            >
              <IconUndo size={14} />
              Duyệt lại
            </button>
          )}
          <button
            onClick={onEdit}
            className="flex cursor-pointer items-center gap-1 text-[13px] text-ink-soft hover:underline hover:text-ink"
          >
            <IconPencil size={14} />
            Sửa
          </button>
          <button onClick={onDelete} className="cursor-pointer text-[13px] text-red-600 hover:underline dark:text-red-400">
            Xóa
          </button>
        </div>
      </td>
    </tr>
  );
}
