import { generateText, stepCountIs, type ModelMessage, type UserContent } from "ai";
import type { API } from "zca-js";
import type { AccountConfig } from "../config/accounts.js";
import { env } from "../config/env.js";
import { getRecentMessages } from "../conversation/history-store.js";
import { getMemoriesForContext } from "../conversation/memory-store.js";
import { getThreadSummary } from "../conversation/thread-store.js";
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

export type AgentTurnResult = {
  text: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; steps: number };
};

/** "[25/07 14:30]" theo giờ máy chạy bot - đủ cho model cảm nhận khoảng cách thời gian */
function formatTimestamp(isoUtc: string): string {
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `[${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}]`;
}

/**
 * Chạy 1 lượt agent: history + cả batch tin nhắn mới (kèm ảnh nếu có) -> LLM tự
 * quyết gọi tool (react, gửi file, tag...) -> trả text cuối cùng để gửi lại Zalo.
 *
 * History được đọc TRƯỚC khi ghi batch hiện tại vào DB, nếu không tin nhắn mới
 * sẽ xuất hiện 2 lần trong input của model.
 */
export async function runAgentTurn({ api, account, batch }: AgentTurnParams): Promise<AgentTurnResult> {
  // Tin cuối đại diện cho lượt: tools (thả reaction, quote) tác động lên tin này
  const latest = batch[batch.length - 1]!;

  const history = getRecentMessages(account.id, latest.threadId);
  const messages: ModelMessage[] = history.map((h) => {
    // Kèm thời gian gửi để model biết khoảng cách giữa các đoạn hội thoại
    // (người quay lại sau 3 ngày không bị nối chuyện như vừa nhắn xong)
    const ts = h.createdAt ? formatTimestamp(h.createdAt) : "";
    if (h.role === "user") {
      const name = h.senderName ? `${h.senderName}: ` : "";
      return { role: "user", content: `${ts} ${name}${h.content}`.trim() };
    }
    return { role: "assistant", content: h.content };
  });

  messages.push({ role: "user", content: await buildCurrentTurnContent(batch) });

  // Memory: fact bền (lọc theo quy tắc privacy) + summary phần hội thoại cũ
  const memory = {
    facts: getMemoriesForContext({
      accountId: account.id,
      threadId: latest.threadId,
      senderId: latest.senderId,
      isGroup: latest.isGroup,
    }),
    threadSummary: getThreadSummary(account.id, latest.threadId).summary,
  };

  const result = await generateText({
    model: resolveLanguageModel(),
    system: buildSystemPrompt(account, latest, memory),
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

  return {
    text: result.text.trim(),
    usage: {
      inputTokens: result.totalUsage.inputTokens ?? 0,
      outputTokens: result.totalUsage.outputTokens ?? 0,
      totalTokens: result.totalUsage.totalTokens ?? 0,
      steps: result.steps.length,
    },
  };
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
