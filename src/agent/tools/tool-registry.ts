import type { Tool } from "ai";
import type { AccountConfig } from "../../config/account-store.js";
import { TOOL_DEFINITIONS, type ToolContext, type ToolDefinition } from "./tool-catalog.js";

/**
 * Logic lọc + dựng tool cho 1 lượt agent. Hình dạng dữ liệu (type + catalog
 * `TOOL_DEFINITIONS`) nằm ở `tool-catalog.ts` - tách ra để file này không vượt
 * ngưỡng 200 dòng. Re-export lại để mọi nơi import từ "tool-registry.js" (hoặc
 * gián tiếp qua "index.js") như cũ, không phải sửa call site nào khác.
 */
export { TOOL_DEFINITIONS, TOOL_KEYS, type ToolContext, type ToolDefinition, type ToolGroup } from "./tool-catalog.js";

/**
 * Bộ tool đưa vào lượt agent, đã bỏ tool account tắt trên dashboard (và với
 * lượt theo lịch, đã bỏ thêm tool có `runsInScheduledTurn: false`).
 * Tool bị tắt không xuất hiện trong schema -> model không biết nó tồn tại,
 * không tốn token mô tả, không thể bị prompt injection dụ gọi.
 */
export function buildAgentTools(ctx: ToolContext): Record<string, Tool> {
  const tools: Record<string, Tool> = {};
  for (const def of listAvailableTools(ctx.account, { isolated: ctx.isolated })) {
    tools[def.key] = def.build(ctx);
  }
  return tools;
}

/**
 * Tool account THỰC SỰ nhận được trong lượt này. Dùng chung bộ lọc với
 * `buildAgentTools` (chính nó gọi hàm này) vì system prompt cũng cần danh sách
 * để trả lời câu "bạn làm được gì" - hai nơi tự lọc riêng là sớm muộn cũng
 * lệch, và lệch nghĩa là bot hứa một tool mà model không hề nhận được.
 *
 * `context.isolated` mặc định false: CẢ `buildAgentTools` LẪN `buildSystemPrompt`
 * (persona-prompt.ts) đều truyền `isolated` THẬT xuống đây - lượt theo lịch
 * (isolated:true) phải thấy ĐÚNG danh sách tool đã lọc ở CẢ 2 nơi, không chỉ
 * ở schema gửi model. Lệch nhau nghĩa là persona hứa 1 tool mà model không hề
 * nhận được (đúng lỗi persona-prompt.test.ts đang canh bằng bất biến riêng).
 */
export function listAvailableTools(
  account: Pick<AccountConfig, "disabledTools">,
  context: { isolated?: boolean } = {},
): ToolDefinition[] {
  const disabled = new Set(account.disabledTools);
  return TOOL_DEFINITIONS.filter((def) => {
    if (disabled.has(def.key)) return false;
    if (context.isolated && def.runsInScheduledTurn === false) return false;
    // Kiểm mỗi lượt: cấu hình từ dashboard ăn ngay không cần restart
    return !def.available || def.available();
  });
}
