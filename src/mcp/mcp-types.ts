/**
 * Type dùng chung cho module MCP client - tách riêng file này để tránh vòng
 * import: nhiều module (`mcp-server-store.ts`, `mcp-manager.ts`, dashboard
 * routes...) đều cần các type này nhưng không được kéo theo DB hay client.
 *
 * Xem spec mục 3: `plans/260829-0726-mcp-client-cam-mcp-ngoai/reports/thiet-ke-va-interface.md`.
 */

/** Trạng thái kết nối tới 1 MCP server ngoài. */
export type TrangThaiServer = "cho_ket_noi" | "da_ket_noi" | "loi" | "can_duyet_lai";

/** 1 tool do server MCP khai báo - dùng để hiển thị + đối chiếu drift. */
export type McpToolInfo = { ten: string; moTa: string };

/**
 * View nội bộ của 1 server - KHÔNG kèm giá trị headers thật, chỉ cờ
 * `hasHeaders` (UI dùng để hiện nút "xóa header" mà không lộ secret).
 */
export type McpServer = {
  id: string;
  ten: string;
  url: string;
  enabled: boolean;
  trangThai: TrangThaiServer;
  loi: string;
  toolsSnapshot: McpToolInfo[];
  hasHeaders: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Bản đầy đủ CÓ headers đã giải mã - chỉ dùng nội bộ (manager kết nối). */
export type McpServerNoiBo = McpServer & { headers: Record<string, string> };

/** Dữ liệu trả cho API dashboard - che secret, thêm số agent đang gán. */
export type McpServerView = {
  id: string;
  ten: string;
  url: string;
  enabled: boolean;
  trangThai: TrangThaiServer;
  loi: string;
  toolsSnapshot: McpToolInfo[];
  hasHeaders: boolean;
  soAgentGan: number;
};
