import { generateText, stepCountIs, type ModelMessage } from "ai";
import type { API } from "zca-js";
import type { AccountConfig } from "../config/account-store.js";
import { getAgentForAccount } from "../config/agent-store.js";
import { isSidecarConfigured } from "../config/runtime-vision-settings.js";
import { getRecentMessages } from "../conversation/history-store.js";
import { getMemoriesForContext } from "../conversation/memory-store.js";
import { getThreadSummary } from "../conversation/thread-store.js";
import { createLogger } from "../shared/logger.js";
import { TECHNICAL_ERROR_REPLY } from "../zalo/send-reply-in-parts.js";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";
import { summarizeStep, type StepTrace } from "./agent-step-trace.js";
import { buildTurnMessages, type ImageContextMode } from "./agent-turn-content.js";
import { resolveLanguageModel, resolveReasoningEffort, resolveReasoningOptions } from "./llm-provider.js";
import { markModelNoVision } from "./model-vision-detection.js";
import { buildSystemPrompt } from "./persona-prompt.js";
import { buildAgentTools } from "./tools/index.js";
import { hasImageParts, isImageRejectionError } from "./vision-rejection-fallback.js";
import { getTuning } from "../config/runtime-tuning-settings.js";

const log = createLogger("agent-loop");

/** Cắt gọn giá trị cho log - output tool (nội dung trang web) dài hàng nghìn ký tự */
function forLog(value: unknown, max: number): string {
  // `JSON.stringify(undefined)` trả về undefined chứ không phải chuỗi - đọc
  // `.length` của nó là TypeError, mà hàm này chạy trong onStepFinish nên lỗi đó
  // giết cả lượt. SDK có đặt `input: void 0` cho tool do provider tự chạy.
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

/**
 * Các field NGẮN nhưng quyết định hành vi, tách ra log riêng để không bị cắt
 * mất sau field dài. Đã dính thật: `prompt` của create_image dài hơn trần 200
 * ký tự nên `imageIndex` đứng sau bị nuốt sạch - chẩn đoán phải suy luận ngược
 * từ câu lỗi thay vì đọc thẳng.
 */
const SHORT_FIELDS = ["mode", "imageIndex", "transparentBackground", "fileName"];

function shortArgsOf(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of SHORT_FIELDS) {
    if (record[key] !== undefined) picked[key] = record[key];
  }
  // Độ dài prompt phân biệt được "model chép nguyên văn nội dung người dùng đưa"
  // với "model tóm tắt thành chủ đề" - hai thứ cho ra ảnh khác hẳn nhau mà nhìn
  // 200 ký tự đầu thì không tài nào biết được
  if (typeof record.prompt === "string") picked.promptChars = record.prompt.length;
  return Object.keys(picked).length > 0 ? picked : undefined;
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
 * Lượt dừng vì HẾT LƯỢT GỌI TOOL chứ không phải vì model xong việc.
 *
 * Nhận biết bằng CẤU TRÚC (đủ số step + step cuối vẫn còn gọi tool) thay vì
 * bằng `finishReason`: model xong việc thì step cuối không có tool call, còn
 * `stopWhen: stepCountIs(n)` cắt ngang đúng lúc model vừa gọi tool xong. Không
 * dùng `finishReason` vì trường đó do provider map, và `MockLanguageModel` của
 * SDK không truyền nó ra nên nhánh này sẽ không test được.
 */
export function hitStepLimit(input: { stepCount: number; maxSteps: number; lastStepToolCalls: number }): boolean {
  return input.stepCount >= input.maxSteps && input.lastStepToolCalls > 0;
}

/**
 * Tin nhắn khi router hỏng cả 2 lần - im lặng bỏ treo người nhắn là tệ nhất.
 * Dùng chung một câu với nhánh lỗi ở account-manager để người nhắn không phải
 * đoán xem hai thông báo khác nhau nghĩa là hai chuyện khác nhau.
 */
const ROUTER_DOWN_REPLY = TECHNICAL_ERROR_REPLY;

/**
 * Dùng khi hết step VÀ lượt chốt cũng không ra chữ. Nói thật là chưa xong thay
 * vì im lặng hoặc gửi câu tường thuật nội bộ - người nhắn còn biết mà hỏi lại.
 */
const STEP_LIMIT_REPLY =
  "Mình tra hơi nhiều bước mà vẫn chưa gom đủ để trả lời cho chắc. Anh/chị hỏi lại gọn hơn một chút giúp mình nhé, ví dụ chỉ một mục hoặc một nguồn thôi.";

export type AgentTurnParams = {
  api: API;
  account: AccountConfig;
  /** Các tin nhắn đã gộp của lượt này (ảnh và caption Zalo gửi tách nhau) */
  batch: ParsedMessage[];
  /**
   * Mảng trace do CALLER sở hữu, hàm này chỉ push vào.
   *
   * Trước đây mảng này là biến cục bộ rồi trả về ở cuối - nghĩa là lượt ném lỗi
   * làm nó rơi theo stack, mất sạch phần chẩn đoán đúng lúc cần nhất. Caller giữ
   * mảng thì nhánh catch vẫn còn đủ những gì đã chạy được.
   */
  trace: StepTrace[];
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
export async function runAgentTurn({ api, account, batch, trace }: AgentTurnParams): Promise<AgentTurnResult> {
  // Tin cuối đại diện cho lượt: tools (thả reaction, quote) tác động lên tin này
  const latest = batch[batch.length - 1]!;

  // Não của account: persona + model/maxSteps override (fallback cấu hình chung)
  const agent = getAgentForAccount(account.agentId);

  const history = getRecentMessages(account.id, latest.threadId);
  // Ảnh xử lý theo chế độ: native (model tự đọc) / describe (sidecar mô tả) /
  // hybrid (combo: cả hai) / blind (bỏ ảnh, dặn bot nói thật)
  const built = await buildTurnMessages({ history, batch, override: agent, allowlist: account.allowlist });
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

  // `trace` do caller truyền vào và dùng chung cho MỌI lần chạy trong lượt: lượt
  // retry (glitch router) và lượt dựng lại không kèm pixel đều nối tiếp vào đó -
  // đúng lúc hỏng mới cần nhìn đủ cả hai lần chạy.
  const runOnce = () =>
    generateText({
      model: resolveLanguageModel(agent, {
        accountId: account.id,
        threadId: latest.threadId,
      }),
      system: buildSystemPrompt(agent, latest, memory, account),
      messages,
      tools: buildAgentTools({ api, account, message: latest, batch }),
      stopWhen: stepCountIs(agent.maxSteps ?? getTuning("LLM_MAX_STEPS")),
      maxOutputTokens: getTuning("LLM_MAX_OUTPUT_TOKENS"),
      // Bật thinking theo LLM_REASONING_EFFORT - kiểm chứng bằng
      // usage.outputTokenDetails.reasoningTokens > 0 trong log bên dưới
      providerOptions: resolveReasoningOptions(agent),
      maxRetries: 2,
      // Chặn trên cho CẢ lượt. Không có nó, router nhận kết nối rồi treo sẽ ăn
      // 300s (undici) x maxRetries x số step, khóa thread hàng giờ trong khi tin
      // nhắn sau xếp hàng chờ. `totalMs` bao gồm cả thời gian chạy tool, nên giá
      // trị này bắt buộc lớn hơn IMAGE_GEN_TIMEOUT_MS.
      timeout: { totalMs: getTuning("LLM_TURN_TIMEOUT_MS") },
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
              // Đứng SAU input trong object nhưng là field riêng nên không bị
              // trần 200 ký tự của input nuốt mất
              args: shortArgsOf(r.input),
              output: forLog(r.output, 300),
            },
            "Tool đã chạy",
          );
        }

        // Tool CHẠY LỖI không bao giờ lọt vào `toolResults` - getter đó chỉ lọc
        // `type === "tool-result"`. Đo thật với ai@7.0.37: tool ném exception
        // cho ra toolResults rỗng, lỗi nằm ở `content` dạng `tool-error`. Trước
        // khi có vòng này, schema chặn input hay tool ném lỗi đều không để lại
        // dấu vết nào: log trống, trace hiện "Gọi tool" rồi cụt, còn model thì
        // vẫn nhận lỗi và thử lại vài vòng - nhìn từ ngoài chỉ thấy bot hứa rồi
        // không làm được. Mức ERROR vì đây là việc đã HỎNG, không phải chẩn đoán.
        for (const p of step.content) {
          if (p.type !== "tool-error") continue;
          log.error(
            {
              accountId: account.id,
              threadId: latest.threadId,
              tool: p.toolName,
              args: shortArgsOf(p.input),
              error: forLog(p.error instanceof Error ? p.error.message : p.error, 300),
            },
            "Tool chạy lỗi",
          );
        }

        if (!getTuning("AGENT_TRACE_ENABLED")) return;
        const t = summarizeStep(step, getTuning("AGENT_TRACE_MAX_CHARS"));
        trace.push(t);
        // Mức DEBUG vì đây là dữ liệu chẩn đoán, bật khi cần chứ không đổ vào
        // log thường. Ghi cả TOOL CALL (model gửi gì) chứ không chỉ kết quả,
        // và cả warnings - chỗ provider báo tham số bị âm thầm bỏ qua.
        log.debug(
          {
            accountId: account.id,
            threadId: latest.threadId,
            step: t.stepNumber,
            finishReason: t.finishReason,
            text: t.text,
            // Rỗng với model OpenAI (không phơi chuỗi suy nghĩ), có nội dung
            // với DeepSeek - phụ thuộc MODEL chứ không phải cấu hình
            reasoning: t.reasoning,
            toolCalls: t.toolCalls,
            toolResults: t.toolResults,
            toolErrors: t.toolErrors,
            warnings: t.warnings,
            tokens: { in: t.inputTokens, out: t.outputTokens },
          },
          "Chi tiết step agent",
        );
      },
    });

  /**
   * Lượt CHỐT khi đã hết step: nối lại đúng những gì model vừa làm rồi hỏi lại
   * mà KHÔNG cấp tool. Không cấp tool là điểm mấu chốt - còn tool thì model lại
   * gọi tiếp và rơi vào đúng cái bẫy vừa thoát ra.
   */
  const runWrapUp = async (daLam: ModelMessage[]): Promise<string> => {
    const r = await generateText({
      model: resolveLanguageModel(agent, { accountId: account.id, threadId: latest.threadId }),
      system: buildSystemPrompt(agent, latest, memory, account),
      messages: [
        ...messages,
        ...daLam,
        {
          role: "user",
          content:
            "Bạn đã hết lượt gọi công cụ. Dựa vào những gì đã thu thập được ở trên, hãy trả lời người dùng NGAY BÂY GIỜ. Nói rõ phần nào chắc chắn, phần nào còn thiếu vì chưa tra xong - đừng bịa cho đủ. Không kể lể tiến trình, không hứa sẽ tra thêm.",
        },
      ],
      maxOutputTokens: getTuning("LLM_MAX_OUTPUT_TOKENS"),
      maxRetries: 1,
      timeout: { totalMs: getTuning("LLM_TURN_TIMEOUT_MS") },
    });
    if (getTuning("AGENT_TRACE_ENABLED")) trace.push(summarizeStep(r.steps[0] ?? {}, getTuning("AGENT_TRACE_MAX_CHARS")));
    return r.text;
  };

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
    const rebuilt = await buildTurnMessages({
      history,
      batch,
      override: agent,
      forceMode: fallbackMode,
      allowlist: account.allowlist,
    });
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
      reasoningEffort: resolveReasoningEffort(agent),
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

  // Chạm trần step: vòng lặp dừng vì HẾT LƯỢT chứ không phải vì model xong việc,
  // nên `result.text` là text của step đang-gọi-tool. Từ lúc persona dạy model
  // kể tiến trình, text đó là câu tường thuật kiểu "Đủ 2 nguồn - giờ đối chiếu
  // và trả lời." - gửi thẳng xuống Zalo là người dùng nhận đúng câu đó làm câu
  // trả lời, rồi lượt sau model đọc history thấy mình đã trả lời như vậy.
  // (Trước khi có persona đó thì text rỗng và bot im lặng - cũng hỏng.)
  // Chữa bằng một lượt chốt KHÔNG cấp tool: model buộc phải viết câu trả lời từ
  // những gì đã thu thập, thay vì vứt bỏ toàn bộ công sức của 8 step.
  const maxSteps = agent.maxSteps ?? getTuning("LLM_MAX_STEPS");
  if (
    hitStepLimit({
      stepCount: result.steps.length,
      maxSteps,
      lastStepToolCalls: result.steps.at(-1)?.toolCalls.length ?? 0,
    })
  ) {
    log.warn(
      { accountId: account.id, threadId: latest.threadId, steps: result.steps.length, maxSteps },
      "Chạm trần số step khi model vẫn đang gọi tool - chạy một lượt chốt không cấp tool",
    );
    const chot = await runWrapUp(result.response.messages).catch((err: unknown) => {
      log.error({ accountId: account.id, threadId: latest.threadId, err }, "Lượt chốt cũng lỗi");
      return null;
    });
    return {
      text: chot?.trim() || STEP_LIMIT_REPLY,
      usage: {
        inputTokens: result.totalUsage.inputTokens ?? 0,
        outputTokens: result.totalUsage.outputTokens ?? 0,
        totalTokens: result.totalUsage.totalTokens ?? 0,
        steps: result.steps.length,
      },
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
