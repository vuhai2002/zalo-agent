import { isSidecarConfigured } from "../../config/runtime-vision-settings.js";
import { createGetDatetimeTool } from "./get-datetime-tool.js";
import { createGetGroupInfoTool } from "./get-group-info-tool.js";
import { createReadImageTool } from "./read-image-tool.js";
import type { ToolDefinition } from "./tool-catalog-types.js";
import { createWebFetchTool } from "./web-fetch-tool.js";
import { createWebSearchTool } from "./web-search-tool.js";

/**
 * Nhóm "read" của catalog tool - tra cứu, không tác động ra ngoài. Tách khỏi
 * `tool-catalog.ts` (đúng nếp tách theo NHÓM đã bàn ở phase 04) để không file
 * catalog nào vượt ngưỡng 200 dòng khi thêm tool mới.
 */
export const READ_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    key: "get_datetime",
    label: "Ngày giờ hiện tại",
    description: "Cho bot biết chính xác ngày, giờ, thứ trong tuần theo múi giờ Việt Nam",
    group: "read",
    build: () => createGetDatetimeTool(),
  },
  {
    key: "web_search",
    label: "Tìm kiếm web",
    description: "Tìm thông tin mới trên web theo chuỗi nguồn, DuckDuckGo luôn đứng cuối",
    group: "read",
    hasSettings: true,
    build: () => createWebSearchTool(),
  },
  {
    key: "web_fetch",
    label: "Đọc trang web",
    description: "Đọc nội dung 1 URL công khai (đã chặn IP nội bộ chống SSRF)",
    group: "read",
    hasSettings: true,
    build: () => createWebFetchTool(),
  },
  {
    key: "read_image",
    label: "Nhìn kỹ ảnh",
    description:
      "Hỏi model đọc ảnh (sidecar) một câu cụ thể về ảnh đã nhận - đếm, đọc chữ nhỏ, soi chi tiết",
    group: "read",
    // Cấu hình đọc ảnh (chế độ vision + sidecar) nằm trong modal Settings của
    // chính dòng này - gom về một chỗ thay vì tách sang trang Providers
    hasSettings: true,
    available: () => isSidecarConfigured(),
    unavailableHint: "Bấm Settings để cấu hình model sidecar đọc ảnh",
    // Lượt theo lịch không có ảnh nào để mà nhìn kỹ lại
    runsInScheduledTurn: false,
    build: (ctx) => createReadImageTool(ctx),
  },
  {
    key: "get_group_info",
    label: "Thông tin nhóm",
    description: "Xem tên nhóm, số thành viên, danh sách thành viên của nhóm hiện tại",
    group: "read",
    build: (ctx) => createGetGroupInfoTool(ctx),
  },
];
