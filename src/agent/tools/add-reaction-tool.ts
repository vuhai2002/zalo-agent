import { tool } from "ai";
import { Reactions } from "zca-js";
import { z } from "zod";
import type { ToolContext } from "./index.js";
import { ketQuaLoi } from "./tool-failure-result.js";

const REACTION_MAP: Record<string, Reactions> = {
  heart: Reactions.HEART,
  like: Reactions.LIKE,
  haha: Reactions.HAHA,
  wow: Reactions.WOW,
  cry: Reactions.CRY,
  angry: Reactions.ANGRY,
  ok: Reactions.OK,
  rose: Reactions.ROSE,
};

export function createAddReactionTool({ api, message }: ToolContext) {
  return tool({
    description:
      "Thả reaction (biểu tượng cảm xúc) vào tin nhắn người dùng vừa gửi. Dùng khi muốn phản hồi cảm xúc nhẹ nhàng kèm/thay cho trả lời chữ.",
    inputSchema: z.object({
      reaction: z
        .enum(["heart", "like", "haha", "wow", "cry", "angry", "ok", "rose"])
        .describe("Loại reaction"),
    }),
    execute: async ({ reaction }) => {
      if (!message.msgId) return ketQuaLoi("Không thả được reaction: tin nhắn không có msgId");
      try {
        await api.addReaction(REACTION_MAP[reaction], {
          data: { msgId: message.msgId, cliMsgId: message.cliMsgId },
          threadId: message.threadId,
          type: message.threadType,
        });
        return `Đã thả reaction ${reaction}`;
      } catch (err) {
        return ketQuaLoi(`Thả reaction thất bại: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  });
}
