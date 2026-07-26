import type { Tool } from "ai";
import type { API } from "zca-js";
import type { AccountConfig } from "../../config/account-store.js";
import { isSidecarConfigured } from "../../config/runtime-vision-settings.js";
import type { ParsedMessage } from "../../zalo/zalo-message-parser.js";
import { createAddReactionTool } from "./add-reaction-tool.js";
import { createGetDatetimeTool } from "./get-datetime-tool.js";
import { createGetGroupInfoTool } from "./get-group-info-tool.js";
import { createReadImageTool } from "./read-image-tool.js";
import { createSaveMemoryTool } from "./save-memory-tool.js";
import { createSendFileTool } from "./send-file-tool.js";
import { createTagMemberTool } from "./tag-member-tool.js";
import { createWebFetchTool } from "./web-fetch-tool.js";
import { createWebSearchTool } from "./web-search-tool.js";

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
    if (disabled.has(def.key)) continue;
    // Kiểm mỗi lượt: cấu hình sidecar từ dashboard ăn ngay không cần restart
    if (def.available && !def.available()) continue;
    tools[def.key] = def.build(ctx);
  }
  return tools;
}
