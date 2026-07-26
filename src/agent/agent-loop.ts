import { generateText, stepCountIs, type ModelMessage, type UserContent } from "ai";
import type { API } from "zca-js";
import type { AccountConfig } from "../config/account-store.js";
import { getAgentForAccount } from "../config/agent-store.js";
import { env } from "../config/env.js";
import { getRecentMessages } from "../conversation/history-store.js";
import { loadStoredImage } from "../conversation/media-store.js";
import { getMemoriesForContext } from "../conversation/memory-store.js";
import { getThreadSummary } from "../conversation/thread-store.js";
import { downloadImageAsBase64 } from "../shared/download-image.js";
import { createLogger } from "../shared/logger.js";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";
import { historyToModelMessages } from "./history-to-model-messages.js";
import { resolveLanguageModel, resolveReasoningOptions } from "./llm-provider.js";
import { buildSystemPrompt } from "./persona-prompt.js";
import { buildAgentTools } from "./tools/index.js";

const log = createLogger("agent-loop");

/** Cắt gọn giá trị cho log - output tool (nội dung trang web) dài hàng nghìn ký tự */
function forLog(value: unknown, max: number): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

/**
 * Chữ ký "router trả completion rỗng": 9Router thỉnh thoảng trả HTTP 200 với
 * message trống trơn - không text, không tool call, usage = 0. SDK coi đó là
 * thành công nên maxRetries không cứu. Phân biệt được với lượt "chỉ thả
 * reaction" hợp lệ: lượt đó CÓ tool call và CÓ token.
 */
export function isEmptyRouterCompletion(input: {
  text: string;
  toolCallCount: number;
  totalTokens: number;
}): boolean {
  return !input.text.trim() && input.toolCallCount === 0 && input.totalTokens === 0;
}

/** Tin nhắn khi router hỏng cả 2 lần - im lặng bỏ treo người nhắn là tệ nhất */
const ROUTER_DOWN_REPLY =
  "Mình đang gặp trục trặc kỹ thuật, bạn nhắn lại giúp mình sau ít phút nhé.";

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
  // Kèm lại tối đa N ảnh gần nhất từ đĩa để model xem lại được ảnh cũ
  const messages: ModelMessage[] = historyToModelMessages(
    history,
    env.HISTORY_IMAGE_CONTEXT_LIMIT,
    loadStoredImage,
  );

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

  // Não của account: persona + model/maxSteps override (fallback cấu hình chung)
  const agent = getAgentForAccount(account.agentId);

  const runOnce = () =>
    generateText({
      model: resolveLanguageModel(agent, {
        accountId: account.id,
        threadId: latest.threadId,
      }),
      system: buildSystemPrompt(agent, latest, memory),
      messages,
      tools: buildAgentTools({ api, account, message: latest }),
      stopWhen: stepCountIs(agent.maxSteps ?? env.LLM_MAX_STEPS),
      maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
      // Bật thinking theo LLM_REASONING_EFFORT - kiểm chứng bằng
      // usage.outputTokenDetails.reasoningTokens > 0 trong log bên dưới
      providerOptions: resolveReasoningOptions(agent),
      maxRetries: 2,
      // Log từng tool call kèm input + đầu output: khi bot trả lời kém phải đọc
      // được ngay nó fetch trang nào và thấy gì (vụ dò vé số chỉ có số steps,
      // toàn bộ chẩn đoán phải đi đường vòng qua DB + tái hiện tay)
      onStepFinish: (step) => {
        for (const r of step.toolResults) {
          log.info(
            {
              accountId: account.id,
              threadId: latest.threadId,
              tool: r.toolName,
              input: forLog(r.input, 200),
              output: forLog(r.output, 300),
            },
            "Tool đã chạy",
          );
        }
      },
    });

  const isGlitch = (r: Awaited<ReturnType<typeof runOnce>>) =>
    isEmptyRouterCompletion({
      text: r.text,
      toolCallCount: r.steps.reduce((sum, s) => sum + s.toolCalls.length, 0),
      totalTokens: r.totalUsage.totalTokens ?? 0,
    });

  let result = await runOnce();

  // 9Router thỉnh thoảng trả 200 + completion rỗng (0 token). maxRetries của
  // SDK không retry vì response "thành công" - phải tự thử lại 1 lần.
  if (isGlitch(result)) {
    log.warn(
      { accountId: account.id, threadId: latest.threadId },
      "Router trả completion rỗng (0 token) - thử lại 1 lần",
    );
    result = await runOnce();
  }

  // info + kèm tên tool: khi bot trả lời kém ("chưa lấy được kết quả...") phải
  // nhìn được ngay nó ĐÃ gọi gì - trước đây chỉ có số steps, debug toàn phải đoán
  log.info(
    {
      accountId: account.id,
      threadId: latest.threadId,
      batchSize: batch.length,
      steps: result.steps.length,
      finishReason: result.finishReason,
      // Model THẬT đã trả lời (router có thể âm thầm route sang model khác)
      model: result.response.modelId,
      reasoningEffort: env.LLM_REASONING_EFFORT,
      // > 0 nghĩa là prompt cache đang trúng. Bằng 0 liên tục ở lượt nhiều
      // step = router/upstream không cache - kiểm lại header phiên và
      // CACHED TOKENS trên dashboard 9Router.
      cachedTokens: result.totalUsage.inputTokenDetails?.cacheReadTokens ?? 0,
      toolCalls: result.steps.flatMap((step) => step.toolCalls.map((call) => call.toolName)),
      usage: result.totalUsage,
    },
    "Hoàn thành lượt agent",
  );

  // Vẫn rỗng sau retry: trả lời fallback thay vì im lặng bỏ treo người nhắn.
  // Lượt "chỉ thả reaction" hợp lệ không dính nhánh này (có tool call + token).
  if (isGlitch(result)) {
    log.error(
      { accountId: account.id, threadId: latest.threadId },
      "Router trả completion rỗng 2 lần liên tiếp - trả lời fallback. Cần soi log 9Router.",
    );
    return {
      text: ROUTER_DOWN_REPLY,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, steps: result.steps.length },
    };
  }

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
      // Ảnh đã persist trước đó (account-manager) thì đọc từ đĩa - không tải lại;
      // persist lỗi thì rơi về tải thẳng từ URL Zalo như cũ
      const stored = image.localPath ? loadStoredImage(image.localPath) : null;
      const downloaded = stored ?? (await downloadImageAsBase64(image.url));
      if (downloaded) {
        // Part "file" thay cho "image": kiểu image bị AI SDK v7 đánh dấu
        // deprecated (in cảnh báo mỗi ảnh) và sẽ xóa ở bản sau
        parts.push({ type: "file", data: downloaded.base64, mediaType: downloaded.mediaType });
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
