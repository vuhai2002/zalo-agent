import { isSidecarConfigured } from "../../config/runtime-vision-settings.js";
import { nguonCuaAgent } from "../../knowledge/kb-agent-binding.js";
import { coNguonNao } from "../../knowledge/kb-source-queries.js";
import { createGetDatetimeTool } from "./get-datetime-tool.js";
import { createGetGroupInfoTool } from "./get-group-info-tool.js";
import { createKbSearchTool } from "./kb-search-tool.js";
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
    // Không khoe: người dùng tự xem giờ được, đưa vào danh sách năng lực chỉ
    // làm cả danh sách trông nghiệp dư. Model vẫn gọi tool này bình thường.
    keTrongKhaNang: false,
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
  {
    key: "kb_search",
    label: "Tra kho tri thức",
    description: "Tra tài liệu do chủ bot nạp lên (chính sách, bảng giá, hướng dẫn)",
    group: "read",
    hasSettings: false,
    /**
     * Agent chưa gán nguồn nào thì tra cũng chỉ ra rỗng - bày tool luôn trả
     * rỗng chỉ dạy model gọi vô ích và tốn một step. Trong LƯỢT AGENT THẬT,
     * `scope.agent.id` luôn là id thật (bắt buộc ở `ToolContext`) nên nhánh
     * dưới luôn hỏi đúng câu "nguồn ĐÃ GÁN cho agent này".
     *
     * Route `/api/tools` (catalog dashboard, không có agent cụ thể - trang
     * Tools phạm vi tài khoản) truyền agent RỖNG (`id: ""`) làm quy ước "không
     * biết agent nào" - khi đó câu hỏi đúng tầm là "kho ĐÃ có nguồn nào chưa"
     * (`coNguonNao`), không phải "nguồn của agent nào" (mọi agent id thật
     * đều không rỗng nên hai nhánh không bao giờ lẫn nhau).
     */
    available: (scope) => (scope.agent.id === "" ? coNguonNao() : nguonCuaAgent(scope.agent.id).length > 0),
    // I18: câu cũ bảo "vào tab Kho tri thức để nạp/gán" - tab đó chỉ NẠP tài
    // liệu, không có ô gán nào (subtitle của chính tab đó cũng nói vậy). Ô
    // gán nằm ở khối Kho tri thức NGAY BÊN DƯỚI danh sách công cụ này, trên
    // trang sửa agent - nói đúng một chỗ, không đẩy người vận hành đi vòng.
    unavailableHint:
      "Kho tri thức chưa có nguồn nào (nạp ở trang Kho tri thức), hoặc agent này chưa được gán nguồn - " +
      "tick nguồn ở khối Kho tri thức ngay bên dưới, trên trang Agents",
    build: (ctx) => createKbSearchTool(ctx),
  },
];
