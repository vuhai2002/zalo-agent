import { tool } from "ai";
import { z } from "zod";
import { saveMemoryFact } from "../../conversation/memory-store.js";
import type { ToolContext } from "./index.js";

/**
 * Memory lớp 3 (tương đương tool `bio` của ChatGPT): agent tự quyết lưu fact
 * đáng nhớ lâu dài. Fact ghi kèm ngữ cảnh học được (DM hay group) để lớp inject
 * áp quy tắc bất đối xứng: fact học ở DM không bao giờ xuất hiện trong group.
 */
export function createSaveMemoryTool({ account, message }: ToolContext) {
  return tool({
    description:
      "Lưu một fact đáng nhớ LÂU DÀI về người đang chat hoặc về nhóm (sở thích, thông tin cá nhân họ chia sẻ, quyết định đã chốt, việc đã hứa). Chỉ dùng khi thông tin còn giá trị cho các cuộc trò chuyện SAU NÀY - không lưu chuyện vặt một lần.",
    inputSchema: z.object({
      content: z
        .string()
        .min(5)
        .max(500)
        .describe("Fact cần nhớ, 1-2 câu ngắn gọn, vd 'Anh Hải thích cà phê đen, không đường'"),
      about: z
        .enum(["sender", "thread"])
        .describe("'sender' = fact về người vừa nhắn; 'thread' = fact về nhóm/cuộc trò chuyện này"),
    }),
    execute: async ({ content, about }) => {
      const subjectId = about === "sender" ? message.senderId : message.threadId;
      if (!subjectId) return "Không xác định được đối tượng để lưu";

      saveMemoryFact({
        accountId: account.id,
        subjectId,
        content,
        learnedInThreadId: message.threadId,
        learnedInGroup: message.isGroup,
      });
      return `Đã ghi nhớ: ${content}`;
    },
  });
}
