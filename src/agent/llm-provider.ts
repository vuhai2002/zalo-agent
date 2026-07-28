import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { env } from "../config/env.js";
import { getEffectiveLlmSettings } from "../config/runtime-llm-settings.js";
import { createLogger } from "../shared/logger.js";
import { cacheSessionHeaders } from "./cache-session-id.js";
import { createSanitizingFetch } from "./llm-response-sanitizer.js";
import {
  reasoningProviderOptions,
  ROUTER_PROVIDER_OPTIONS_KEY,
  type ReasoningEffort,
} from "./reasoning-options.js";
import { getTuning } from "../config/runtime-tuning-settings.js";

const log = createLogger("llm-provider");

// Chỉ bọc cho đường router proxy - Anthropic trực tiếp không có bug này
const sanitizingFetch = createSanitizingFetch({
  onSanitized: () =>
    log.warn("Router trả JSON dính đuôi SSE 'data: [DONE]' - đã cắt bỏ (bug 9Router, nên fix tận gốc)"),
});

export type ModelOverride = {
  modelProvider?: "openai-compatible" | "anthropic" | null;
  modelName?: string | null;
  /** Mức suy nghĩ riêng của agent; null/undefined = theo mức mặc định chung */
  reasoningEffort?: ReasoningEffort | null;
};

/**
 * Chọn model theo thứ tự ưu tiên: override của agent (não) -> runtime_settings
 * (dashboard) -> env. Gọi mỗi lượt agent nên đổi từ UI có hiệu lực ngay.
 * - openai-compatible: router proxy (9Router, LiteLLM, OpenRouter...) qua base URL
 * - anthropic: gọi thẳng API Anthropic
 * API key/base URL luôn lấy từ cấu hình chung (per-agent key là chuyện sau).
 */
export function resolveLanguageModel(
  override?: ModelOverride,
  /**
   * Thread đang xử lý - dùng dựng header phiên ổn định để router bật prompt
   * caching. Bỏ trống (summarizer, nút test kết nối) thì không gửi header:
   * đó là lượt một lần, không có prefix nào để tái dùng.
   */
  thread?: { accountId: string; threadId: string },
): LanguageModel {
  const base = getEffectiveLlmSettings();
  const settings = {
    ...base,
    provider: override?.modelProvider ?? base.provider,
    model: override?.modelName ?? base.model,
  };
  if (!settings.apiKey) {
    throw new Error(
      "Chưa cấu hình LLM API key - đặt LLM_API_KEY trong .env hoặc nhập ở trang Providers trên dashboard",
    );
  }

  const sessionHeaders = thread
    ? cacheSessionHeaders(env.LLM_CACHE_SESSION_ENABLED, thread.accountId, thread.threadId)
    : {};

  switch (settings.provider) {
    case "openai-compatible": {
      if (!settings.baseUrl) {
        throw new Error("Thiếu base URL cho provider openai-compatible");
      }
      const provider = createOpenAICompatible({
        // Đổi name phải đổi cả ROUTER_PROVIDER_OPTIONS_KEY (reasoning-options.ts)
        name: ROUTER_PROVIDER_OPTIONS_KEY,
        baseURL: settings.baseUrl,
        apiKey: settings.apiKey,
        headers: sessionHeaders,
        fetch: sanitizingFetch,
      });
      return provider(settings.model);
    }
    case "anthropic": {
      // Gọi thẳng Anthropic thì header phiên vô nghĩa (không có router đọc),
      // nhưng gửi kèm cũng vô hại và giữ hành vi đồng nhất giữa 2 nhánh.
      const provider = createAnthropic({ apiKey: settings.apiKey, headers: sessionHeaders });
      return provider(settings.model);
    }
  }
}

/**
 * providerOptions bật thinking cho lượt agent, theo provider ĐANG hiệu lực
 * (override của agent thắng runtime settings thắng env - cùng thứ tự với
 * resolveLanguageModel để không bao giờ lệch model một đằng options một nẻo).
 * Summarizer và nút test kết nối không truyền options này - việc nhẹ, không
 * cần đốt token thinking.
 */
export function resolveReasoningOptions(override?: ModelOverride) {
  const provider = override?.modelProvider ?? getEffectiveLlmSettings().provider;
  return reasoningProviderOptions(provider, resolveReasoningEffort(override));
}

/** Mức suy nghĩ hiệu lực: agent đặt riêng thắng mức mặc định ở trang Cấu hình */
export function resolveReasoningEffort(override?: ModelOverride): ReasoningEffort {
  return override?.reasoningEffort ?? getTuning("LLM_REASONING_EFFORT");
}
