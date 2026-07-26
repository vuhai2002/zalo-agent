import { generateText, stepCountIs } from "ai";
import type { API } from "zca-js";
import type { AccountConfig } from "../config/account-store.js";
import { getAgentForAccount } from "../config/agent-store.js";
import { env } from "../config/env.js";
import { isSidecarConfigured } from "../config/runtime-vision-settings.js";
import { getRecentMessages } from "../conversation/history-store.js";
import { getMemoriesForContext } from "../conversation/memory-store.js";
import { getThreadSummary } from "../conversation/thread-store.js";
import { createLogger } from "../shared/logger.js";
import { TECHNICAL_ERROR_REPLY } from "../zalo/send-reply-in-parts.js";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";
import { buildTurnMessages, type ImageContextMode } from "./agent-turn-content.js";
import { resolveLanguageModel, resolveReasoningOptions } from "./llm-provider.js";
import { markModelNoVision } from "./model-vision-detection.js";
import { buildSystemPrompt } from "./persona-prompt.js";
import { buildAgentTools } from "./tools/index.js";
import { hasImageParts, isImageRejectionError } from "./vision-rejection-fallback.js";

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

/**
 * Tin nhắn khi router hỏng cả 2 lần - im lặng bỏ treo người nhắn là tệ nhất.
 * Dùng chung một câu với nhánh lỗi ở account-manager để người nhắn không phải
 * đoán xem hai thông báo khác nhau nghĩa là hai chuyện khác nhau.
 */
const ROUTER_DOWN_REPLY = TECHNICAL_ERROR_REPLY;

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

  // Não của account: persona + model/maxSteps override (fallback cấu hình chung)
  const agent = getAgentForAccount(account.agentId);

  const history = getRecentMessages(account.id, latest.threadId);
  // Ảnh xử lý theo chế độ: native (model tự đọc) / describe (sidecar mô tả) /
  // hybrid (combo: cả hai) / blind (bỏ ảnh, dặn bot nói thật)
  const built = await buildTurnMessages({ history, batch, override: agent });
  let messages = built.messages;
  let imageMode = built.imageMode;

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

  const runOnce = () =>
    generateText({
      model: resolveLanguageModel(agent, {
        accountId: account.id,
        threadId: latest.threadId,
      }),
      system: buildSystemPrompt(agent, latest, memory),
      messages,
      tools: buildAgentTools({ api, account, message: latest, batch }),
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

  let result: Awaited<ReturnType<typeof runOnce>>;
  try {
    result = await runOnce();
  } catch (err) {
    // Reactive fallback: lượt đang đính pixel mà provider từ chối bằng 4xx
    // (endpoint ngoài 9Router không khai capability, detect đoán lạc quan) ->
    // ghi nhớ model mù + dựng lại input không pixel rồi thử lại 1 lần.
    // Combo qua 9Router không rơi vào đây - router lột ảnh êm, không lỗi.
    const pixelModes: ImageContextMode[] = ["native", "hybrid"];
    if (!pixelModes.includes(imageMode) || !hasImageParts(messages) || !isImageRejectionError(err)) {
      throw err;
    }
    markModelNoVision(agent);
    const fallbackMode: ImageContextMode = isSidecarConfigured() ? "describe" : "blind";
    log.warn(
      { accountId: account.id, threadId: latest.threadId, imageMode, fallbackMode, err: forLog(err, 200) },
      "Provider từ chối lượt có ảnh (4xx) - thử lại không kèm pixel",
    );
    const rebuilt = await buildTurnMessages({ history, batch, override: agent, forceMode: fallbackMode });
    messages = rebuilt.messages;
    imageMode = rebuilt.imageMode;
    result = await runOnce();
  }

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
      // native = model tự đọc ảnh; describe = sidecar mô tả; hybrid = combo
      // nhận cả pixel + mô tả; blind = bỏ ảnh. Lượt bị reactive fallback thì
      // đây là chế độ THẬT đã chạy (describe/blind), không phải chế độ ban đầu.
      imageMode,
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
