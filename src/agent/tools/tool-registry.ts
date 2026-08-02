import type { Tool } from "ai";
import type { AccountConfig } from "../../config/account-store.js";
import type { AgentProfile } from "../../config/agent-store.js";
import { TOOL_DEFINITIONS, type ToolContext, type ToolDefinition } from "./tool-catalog.js";

/**
 * Logic lọc + dựng tool cho 1 lượt agent. Hình dạng dữ liệu (type + catalog
 * `TOOL_DEFINITIONS`) nằm ở `tool-catalog.ts` - tách ra để file này không vượt
 * ngưỡng 200 dòng. Re-export lại để mọi nơi import từ "tool-registry.js" (hoặc
 * gián tiếp qua "index.js") như cũ, không phải sửa call site nào khác.
 */
export { TOOL_DEFINITIONS, TOOL_KEYS, type ToolContext, type ToolDefinition, type ToolGroup } from "./tool-catalog.js";

/**
 * Hai lớp cùng quyết định một tool có được cấp hay không.
 *
 * - `agent` khai NĂNG LỰC: agent này biết làm những việc gì.
 * - `account` áp CHÍNH SÁCH: nick Zalo này được phép làm gì.
 *
 * Cả hai đều lưu danh sách TẮT, và kết quả là phần KHÔNG bên nào tắt. Không bên
 * nào bật ngược lại được bên kia - nhờ vậy thêm một agent mới không bao giờ nới
 * rộng được quyền của một nick, kể cả khi agent đó được tạo cẩu thả.
 */
export type ToolScope = {
  agent: Pick<AgentProfile, "disabledTools">;
  account: Pick<AccountConfig, "disabledTools">;
};

/**
 * Bộ tool đưa vào lượt agent, đã bỏ tool agent tắt, tool account tắt trên
 * dashboard, và (với lượt theo lịch) tool có `runsInScheduledTurn: false`.
 * Tool bị tắt không xuất hiện trong schema -> model không biết nó tồn tại,
 * không tốn token mô tả, không thể bị prompt injection dụ gọi.
 */
export function buildAgentTools(ctx: ToolContext): Record<string, Tool> {
  const tools: Record<string, Tool> = {};
  for (const def of listAvailableTools(
    { agent: ctx.agent, account: ctx.account },
    { isolated: ctx.isolated },
  )) {
    tools[def.key] = def.build(ctx);
  }
  return tools;
}

/**
 * Tool agent THỰC SỰ nhận được trong lượt này. Dùng chung bộ lọc với
 * `buildAgentTools` (chính nó gọi hàm này) vì system prompt cũng cần danh sách
 * để trả lời câu "bạn làm được gì" - hai nơi tự lọc riêng là sớm muộn cũng
 * lệch, và lệch nghĩa là bot hứa một tool mà model không hề nhận được.
 *
 * Nhận nguyên cụm `scope` thay vì hai tham số rời: thêm lớp lọc mới sau này chỉ
 * phải sửa type, không phải sờ lại từng call site. Và để cụm là BẮT BUỘC (không
 * optional) nên quên truyền `agent` là lỗi biên dịch, không phải lỗi âm thầm
 * cấp thừa tool.
 *
 * `context.isolated` mặc định false: CẢ `buildAgentTools` LẪN `buildSystemPrompt`
 * (persona-prompt.ts) đều truyền `isolated` THẬT xuống đây - lượt theo lịch
 * (isolated:true) phải thấy ĐÚNG danh sách tool đã lọc ở CẢ 2 nơi, không chỉ
 * ở schema gửi model. Lệch nhau nghĩa là persona hứa 1 tool mà model không hề
 * nhận được (đúng lỗi persona-prompt.test.ts đang canh bằng bất biến riêng).
 */
export function listAvailableTools(
  scope: ToolScope,
  context: { isolated?: boolean } = {},
): ToolDefinition[] {
  // Gộp hai danh sách TẮT thành một tập: tool nằm trong tập là bị loại, bất kể
  // bên nào tắt nó. Đây chính là phép giao của hai tập BẬT, viết theo chiều
  // danh sách tắt cho khớp cách lưu ở DB.
  const disabled = new Set([...scope.agent.disabledTools, ...scope.account.disabledTools]);
  return TOOL_DEFINITIONS.filter((def) => {
    if (disabled.has(def.key)) return false;
    if (context.isolated && def.runsInScheduledTurn === false) return false;
    // Kiểm mỗi lượt: cấu hình từ dashboard ăn ngay không cần restart
    return !def.available || def.available();
  });
}
