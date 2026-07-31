import { ACTION_TOOL_DEFINITIONS } from "./tool-catalog-action.js";
import { READ_TOOL_DEFINITIONS } from "./tool-catalog-read.js";
import type { ToolDefinition } from "./tool-catalog-types.js";

/**
 * Catalog tool duy nhất - dashboard đọc danh sách từ đây qua API (một nguồn,
 * không để frontend chép lại rồi lệch - cùng lý do với reaction-icons).
 *
 * Danh sách thật nằm ở 2 file theo NHÓM (`tool-catalog-read.ts`,
 * `tool-catalog-action.ts`) - tách ra vì file này (hình dạng dữ liệu +
 * `TOOL_DEFINITIONS` gộp cả 2 nhóm) sắp vượt ngưỡng 200 dòng khi thêm tool mới
 * (`schedule_task`, phase 04). Type dùng chung nằm ở `tool-catalog-types.ts`
 * để 2 file nhóm không phải import lẫn nhau.
 */
export type { ToolContext, ToolDefinition, ToolGroup } from "./tool-catalog-types.js";

export const TOOL_DEFINITIONS: ToolDefinition[] = [...READ_TOOL_DEFINITIONS, ...ACTION_TOOL_DEFINITIONS];

export const TOOL_KEYS = TOOL_DEFINITIONS.map((t) => t.key);
