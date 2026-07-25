import type { AccountConfig } from "../config/accounts.js";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";

export type FilterDecision = { respond: boolean; reason: string };

/**
 * Quyết định bot có trả lời tin nhắn này không - chạy TRƯỚC khi gọi LLM
 * để tin bị lọc không tốn token nào.
 */
export function shouldRespond(account: AccountConfig, msg: ParsedMessage): FilterDecision {
  if (msg.isSelf) {
    return { respond: false, reason: "tin của chính bot" };
  }

  if (!msg.text.trim() && msg.images.length === 0) {
    return { respond: false, reason: "không có nội dung xử lý được (sticker/voice/...)" };
  }

  if (msg.isGroup) {
    if (!account.respondToGroups) {
      return { respond: false, reason: "account tắt trả lời group" };
    }
    if (account.groupRequireMention && !msg.mentionsMe) {
      return { respond: false, reason: "group yêu cầu @mention bot" };
    }
  }

  if (account.allowlist.mode === "list" && !account.allowlist.userIds.includes(msg.senderId)) {
    return { respond: false, reason: `sender ${msg.senderId} ngoài allowlist` };
  }

  return { respond: true, reason: "ok" };
}
