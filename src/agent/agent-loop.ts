import { generateText, stepCountIs, type ModelMessage, type UserContent } from "ai";
import type { API } from "zca-js";
import type { AccountConfig } from "../config/accounts.js";
import { env } from "../config/env.js";
import { getRecentMessages } from "../conversation/history-store.js";
import { createLogger } from "../shared/logger.js";
import { downloadImageAsBase64, type ParsedMessage } from "../zalo/zalo-message-parser.js";
import { resolveLanguageModel } from "./llm-provider.js";
import { buildSystemPrompt } from "./persona-prompt.js";
import { buildAgentTools } from "./tools/index.js";

const log = createLogger("agent-loop");

export type AgentTurnParams = {
  api: API;
  account: AccountConfig;
  /** Các tin nhắn đã gộp của lượt này (ảnh và caption Zalo gửi tách nhau) */
  batch: ParsedMessage[];
};

/**
 * Chạy 1 lượt agent: history + cả batch tin nhắn mới (kèm ảnh nếu có) -> LLM tự
 * quyết gọi tool (react, gửi file, tag...) -> trả text cuối cùng để gửi lại Zalo.
 *
 * History được đọc TRƯỚC khi ghi batch hiện tại vào DB, nếu không tin nhắn mới
 * sẽ xuất hiện 2 lần trong input của model.
 */
export async function runAgentTurn({ api, account, batch }: AgentTurnParams): Promise<string> {
  // Tin cuối đại diện cho lượt: tools (thả reaction, quote) tác động lên tin này
  const latest = batch[batch.length - 1]!;

  const history = getRecentMessages(account.id, latest.threadId);
  const messages: ModelMessage[] = history.map((h) =>
    h.role === "user"
      ? {
          role: "user",
          content: h.senderName ? `${h.senderName}: ${h.content}` : h.content,
        }
      : { role: "assistant", content: h.content },
  );

  messages.push({ role: "user", content: await buildCurrentTurnContent(batch) });

  const result = await generateText({
    model: resolveLanguageModel(),
    system: buildSystemPrompt(account, latest),
    messages,
    tools: buildAgentTools({ api, account, message: latest }),
    stopWhen: stepCountIs(env.LLM_MAX_STEPS),
    maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
    maxRetries: 2,
  });

  log.debug(
    {
      accountId: account.id,
      threadId: latest.threadId,
      batchSize: batch.length,
      steps: result.steps.length,
      usage: result.totalUsage,
    },
    "Hoàn thành lượt agent",
  );

  return result.text.trim();
}

/** Gộp toàn bộ ảnh + text trong batch thành content của 1 lượt user */
async function buildCurrentTurnContent(batch: ParsedMessage[]): Promise<UserContent> {
  const parts: Exclude<UserContent, string> = [];

  for (const msg of batch) {
    for (const image of msg.images) {
      const downloaded = await downloadImageAsBase64(image.url);
      if (downloaded) {
        parts.push({ type: "image", image: downloaded.base64, mediaType: downloaded.mediaType });
      }
    }
  }

  const texts = batch.map((m) => m.text.trim()).filter(Boolean);
  const latest = batch[batch.length - 1]!;
  const label = latest.isGroup ? `${latest.senderName}: ` : "";
  const body = texts.length > 0 ? texts.join("\n") : "(người dùng gửi ảnh, không kèm chữ)";
  parts.push({ type: "text", text: `${label}${body}` });

  return parts;
}
