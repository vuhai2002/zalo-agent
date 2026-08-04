import { tool } from "ai";
import { z } from "zod";
import { enqueueSend } from "../../middleware/rate-limiter.js";
import type { ToolContext } from "./index.js";
import { ketQuaLoi } from "./tool-failure-result.js";
import { lamSachTraLoi } from "../../zalo/sanitize-reply-text.js";
import { ghiChuDaGuiChu } from "./sent-by-tool-note.js";

export function createTagMemberTool({ api, account, message, ghiNhanDaGui }: ToolContext) {
  return tool({
    description:
      "Gửi tin nhắn có tag (@mention) một thành viên trong nhóm. Chỉ dùng trong group chat, cần biết đúng userId (lấy từ get_group_info nếu chưa biết).",
    inputSchema: z.object({
      memberId: z.string().describe("userId của thành viên cần tag"),
      memberName: z.string().describe("Tên hiển thị của thành viên"),
      text: z.string().describe("Nội dung nhắn kèm sau phần tag"),
    }),
    execute: async ({ memberId, memberName, text }) => {
      if (!message.isGroup) return ketQuaLoi("Chỉ tag được trong nhóm chat");

      // `text` là một câu trả lời ĐẦY ĐỦ do model viết, gửi thẳng vào nhóm - nên
      // phải qua đúng lớp làm sạch như câu trả lời thường, không thì nó là lối
      // đi vòng qua cả ba lớp chặn.
      const sach = lamSachTraLoi(text);
      if (sach.chan) {
        return ketQuaLoi(
          "Nội dung định tag có dấu hiệu lộ chỉ dẫn nội bộ nên chưa gửi được. Viết lại bằng lời của bạn rồi thử lại.",
        );
      }
      const noiDung = sach.text.trim() || text;

      try {
        const mentionText = `@${memberName}`;
        await enqueueSend(`${account.id}:${message.threadId}`, () =>
          api.sendMessage(
            {
              msg: `${mentionText} ${noiDung}`,
              mentions: [{ pos: 0, uid: memberId, len: mentionText.length }],
            },
            message.threadId,
            message.threadType,
          ),
        );
        ghiNhanDaGui?.(ghiChuDaGuiChu(`${mentionText} ${noiDung}`));
        return `Đã gửi tin nhắn tag ${memberName}`;
      } catch (err) {
        return ketQuaLoi(`Tag thất bại: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  });
}
