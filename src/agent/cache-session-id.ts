import { createHash } from "node:crypto";

/**
 * Khóa phiên ổn định theo thread, gửi lên router qua header `x-session-id`
 * để bật prompt caching.
 *
 * Vì sao cần (đọc source 9Router, open-sse/utils/sessionManager.js):
 * router suy ra khóa cache theo thứ tự - header `x-session-id` trước, rồi
 * `body.prompt_cache_key`, rồi FALLBACK băm nội dung text của assistant trong
 * request. Client không gửi gì thì rơi vào fallback đó, mà text assistant DÀI
 * THÊM sau mỗi câu trả lời -> băm ra khóa khác mỗi lượt -> upstream coi là
 * phiên mới -> cache không bao giờ trúng (đo thực tế: CACHED TOKENS = 0 trên
 * 181k token input).
 *
 * Header này là đường CHUNG cho mọi provider, không riêng OpenAI:
 * - codex.js / grok-cli.js: đổ vào `prompt_cache_key` của upstream
 * - claude.js (Anthropic): giữ fingerprint nhất quán khi cloaking; phần
 *   `cache_control` thì router tự bơm, client không phải làm
 * - kiro / antigravity: định danh phiên
 * - provider thường (DeepSeek, Groq...): bị bỏ qua, vô hại
 *
 * Module thuần, không import env - caller truyền cấu hình vào.
 */

/** Tên header router đọc đầu tiên (SESSION_HEADER_KEYS trong sessionManager.js) */
export const CACHE_SESSION_HEADER = "x-session-id";

/**
 * Khóa ổn định cho 1 thread của 1 account. Băm thay vì ghép thẳng id: thread
 * id Zalo là định danh người dùng thật, không nên rò ra log/telemetry của
 * router. Cùng thread luôn ra cùng khóa, khác thread chắc chắn khác khóa.
 *
 * `epoch` là số lần ngữ cảnh thread bị xóa sạch (cột `threads.context_epoch`).
 * Nó nằm trong phần băm để mỗi lần xóa mở một PHIÊN MỚI với router: không có
 * nó thì xóa xong vẫn gửi đúng khóa cũ, và router giữ tiền tố đã cache của cuộc
 * trò chuyện vừa bị xóa. Cùng cách goclaw gọi `ResetCLISession` sau /reset và
 * Hermes xoay `session_id`. Mặc định 0 để mọi call site cũ giữ nguyên khóa.
 */
export function cacheSessionId(accountId: string, threadId: string, epoch = 0): string {
  const digest = createHash("sha256").update(`${accountId}:${threadId}:${epoch}`).digest("hex");
  return `zalo-agent-${digest.slice(0, 32)}`;
}

/**
 * Header kèm theo request LLM. Trả object rỗng khi tắt để caller spread thẳng
 * vào cấu hình provider mà không cần if.
 */
export function cacheSessionHeaders(
  enabled: boolean,
  accountId: string,
  threadId: string,
  epoch = 0,
): Record<string, string> {
  if (!enabled || !accountId || !threadId) return {};
  return { [CACHE_SESSION_HEADER]: cacheSessionId(accountId, threadId, epoch) };
}
