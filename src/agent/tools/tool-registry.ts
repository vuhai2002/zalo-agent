import type { Tool } from "ai";
import type { API } from "zca-js";
import type { AccountConfig } from "../../config/account-store.js";
import type { ParsedMessage } from "../../zalo/zalo-message-parser.js";
import { createAddReactionTool } from "./add-reaction-tool.js";
import { createGetDatetimeTool } from "./get-datetime-tool.js";
import { createGetGroupInfoTool } from "./get-group-info-tool.js";
import { createSaveMemoryTool } from "./save-memory-tool.js";
import { createSendFileTool } from "./send-file-tool.js";
import { createTagMemberTool } from "./tag-member-tool.js";
import { createWebFetchTool } from "./web-fetch-tool.js";
import { createWebSearchTool } from "./web-search-tool.js";

/** Bối cảnh 1 lượt xử lý - tools dùng để gọi zca-js đúng account + thread */
export type ToolContext = {
  api: API;
  account: AccountConfig;
  message: ParsedMessage;
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
    build: (ctx) => createSaveMemoryTool(ctx),
  },
];

export const TOOL_KEYS = TOOL_DEFINITIONS.map((t) => t.key);

/**
 * Bộ tool đưa vào lượt agent, đã bỏ tool account tắt trên dashboard.
 * Tool bị tắt không xuất hiện trong schema -> model không biết nó tồn tại,
 * không tốn token mô tả, không thể bị prompt injection dụ gọi.
 */
export function buildAgentTools(ctx: ToolContext): Record<string, Tool> {
  const disabled = new Set(ctx.account.disabledTools);
  const tools: Record<string, Tool> = {};
  for (const def of TOOL_DEFINITIONS) {
    if (!disabled.has(def.key)) tools[def.key] = def.build(ctx);
  }
  return tools;
}
