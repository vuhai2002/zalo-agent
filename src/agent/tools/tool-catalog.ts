import type { Tool } from "ai";
import type { API } from "zca-js";
import type { AccountConfig } from "../../config/account-store.js";
import { isImageGenConfigured } from "../../config/runtime-image-settings.js";
import { isSidecarConfigured } from "../../config/runtime-vision-settings.js";
import type { ParsedMessage } from "../../zalo/zalo-message-parser.js";
import { createAddReactionTool } from "./add-reaction-tool.js";
import { createExcelFileTool, createWordDocumentTool } from "./create-document-tools.js";
import { createImageTool } from "./create-image-tool.js";
import { createGetDatetimeTool } from "./get-datetime-tool.js";
import { createGetGroupInfoTool } from "./get-group-info-tool.js";
import { createReadImageTool } from "./read-image-tool.js";
import { createSaveMemoryTool } from "./save-memory-tool.js";
import { createSendFileTool } from "./send-file-tool.js";
import { createTagMemberTool } from "./tag-member-tool.js";
import { createWebFetchTool } from "./web-fetch-tool.js";
import { createWebSearchTool } from "./web-search-tool.js";

/**
 * Hình dạng dữ liệu của catalog tool: type + danh sách `TOOL_DEFINITIONS`.
 * Tách khỏi `tool-registry.ts` (giữ `buildAgentTools`/`listAvailableTools`)
 * để file đó không vượt ngưỡng 200 dòng - đúng nếp `scheduled-job-record.ts`
 * đã tách khỏi `scheduled-job-store.ts`.
 */

/** Bối cảnh 1 lượt xử lý - tools dùng để gọi zca-js đúng account + thread */
export type ToolContext = {
  api: API;
  account: AccountConfig;
  /** Tin cuối của lượt - tools tác động (reaction, quote) nhắm vào tin này */
  message: ParsedMessage;
  /**
   * Cả batch của lượt (ảnh và caption Zalo gửi tách tin). read_image cần vì
   * ảnh của lượt hiện tại CHƯA vào DB khi tool chạy - đọc history là hụt.
   */
  batch: ParsedMessage[];
  /**
   * Lượt CHẠY THEO LỊCH (job scheduler agent-loop.ts truyền `isolated:true`
   * xuống đây) - lọc bớt tool theo `runsInScheduledTurn`. Mặc định false/undefined
   * cho lượt tin nhắn thường.
   */
  isolated?: boolean;
};

/**
 * Nhóm theo mức rủi ro (học từ toolset của Hermes - webhook chỉ được cấp
 * tool "đọc"): read = tra cứu, không tác động ra ngoài; action = gửi/sửa
 * thứ gì đó trên Zalo. UI trang Tools nhóm theo đây.
 */
export type ToolGroup = "read" | "action";

export type ToolDefinition = {
  /** Tên tool trong schema gửi LLM - đổi là model mất trí nhớ về tool */
  key: string;
  /** Tên + mô tả hiển thị trên trang Tools của dashboard */
  label: string;
  description: string;
  group: ToolGroup;
  /**
   * Có nút Settings trên dòng tool ở dashboard không. Tool nào đi theo CHUỖI
   * nhiều nguồn thì có, để người dùng xem thứ tự thử và bật/tắt từng bậc
   * (mô hình Extractor Chain của GoClaw).
   */
  hasSettings?: boolean;
  /**
   * Điều kiện runtime để tool vào schema (kiểm mỗi lượt, ngoài chuyện bật/tắt
   * per account). Tool thiếu hạ tầng (read_image chưa có sidecar) mà vẫn vào
   * schema thì chỉ tốn token mô tả và dụ model gọi để nhận lỗi.
   */
  available?: () => boolean;
  /**
   * Hiện trên trang Tools khi `available()` false - phải nói RÕ thiếu gì và
   * sửa ở đâu. Không có dòng này thì UI hiện tool bật sẵn trong khi model
   * không hề nhận được nó (người dùng tưởng bot có khả năng đó mà không có).
   */
  unavailableHint?: string;
  /**
   * Tool này có được cấp trong lượt CHẠY THEO LỊCH (job scheduler) không.
   * Mặc định true - phải khai TƯỜNG MINH false mới bị loại. Chỉ 3 tool loại:
   * `add_reaction` (lượt này không có `msgId` thật để thả vào), `read_image`
   * (không có ảnh nào trong lượt), `save_memory` (đường nội dung web đi vào
   * trí nhớ vĩnh viễn là prompt injection thật, và lượt theo lịch vốn không có
   * phát ngôn nào của user để mà học). `schedule_task` (phase 04) cũng sẽ đặt
   * false - luật "job không được đẻ job".
   */
  runsInScheduledTurn?: boolean;
  build: (ctx: ToolContext) => Tool;
};

/**
 * Catalog tool duy nhất - dashboard đọc danh sách từ đây qua API (một nguồn,
 * không để frontend chép lại rồi lệch - cùng lý do với reaction-icons).
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
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
  {
    key: "add_reaction",
    label: "Thả cảm xúc",
    description: "Thả reaction (tim, like...) vào tin nhắn trong hội thoại",
    group: "action",
    // Lượt theo lịch không có tin thật nào (msgId rỗng) để mà thả reaction vào
    runsInScheduledTurn: false,
    build: (ctx) => createAddReactionTool(ctx),
  },
  {
    key: "send_file",
    label: "Gửi file",
    description: "Gửi file từ kho shared-files hoặc tải từ URL công khai rồi gửi",
    group: "action",
    build: (ctx) => createSendFileTool(ctx),
  },
  {
    key: "create_word_document",
    label: "Tạo file Word",
    description: "Soạn nội dung thành file .docx (tiêu đề, đoạn văn, gạch đầu dòng, bảng) rồi gửi luôn",
    group: "action",
    build: (ctx) => createWordDocumentTool(ctx),
  },
  {
    key: "create_excel_file",
    label: "Tạo file Excel",
    description: "Soạn bảng số liệu thành file .xlsx có công thức tính sẵn rồi gửi luôn",
    group: "action",
    build: (ctx) => createExcelFileTool(ctx),
  },
  {
    key: "create_image",
    label: "Vẽ ảnh AI",
    description: "Vẽ ảnh mới hoặc sửa ảnh người dùng vừa gửi (đổi màu, xóa vật thể, đổi phong cách) rồi gửi luôn",
    group: "action",
    hasSettings: true,
    available: () => isImageGenConfigured(),
    unavailableHint: "Bấm Settings để cấu hình endpoint + model vẽ ảnh",
    build: (ctx) => createImageTool(ctx),
  },
  {
    key: "tag_member",
    label: "Tag thành viên",
    description: "Nhắc tên (@mention) thành viên trong nhóm khi trả lời",
    group: "action",
    build: (ctx) => createTagMemberTool(ctx),
  },
  {
    key: "save_memory",
    label: "Ghi nhớ lâu dài",
    description: "Tự lưu fact về người dùng/nhóm để nhớ qua các phiên chat sau",
    group: "action",
    // Đường nội dung web đi vào trí nhớ vĩnh viễn là prompt injection thật, và
    // lượt theo lịch vốn không có phát ngôn nào của user để mà học
    runsInScheduledTurn: false,
    build: (ctx) => createSaveMemoryTool(ctx),
  },
];

export const TOOL_KEYS = TOOL_DEFINITIONS.map((t) => t.key);
