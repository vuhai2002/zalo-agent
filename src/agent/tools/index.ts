/**
 * Điểm vào của hệ tool. Catalog + logic bật/tắt nằm ở tool-registry.ts;
 * file này chỉ re-export để các tool file import `ToolContext` từ "./index.js"
 * như cũ (import type - không tạo vòng import lúc chạy).
 */
export {
  buildAgentTools,
  TOOL_DEFINITIONS,
  TOOL_KEYS,
  type ToolContext,
  type ToolDefinition,
  type ToolGroup,
} from "./tool-registry.js";
