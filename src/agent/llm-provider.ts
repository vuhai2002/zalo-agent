import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { getEffectiveLlmSettings } from "../config/runtime-llm-settings.js";
import { createLogger } from "../shared/logger.js";
import { createSanitizingFetch } from "./llm-response-sanitizer.js";

const log = createLogger("llm-provider");

// Chỉ bọc cho đường router proxy - Anthropic trực tiếp không có bug này
const sanitizingFetch = createSanitizingFetch({
  onSanitized: () =>
    log.warn("Router trả JSON dính đuôi SSE 'data: [DONE]' - đã cắt bỏ (bug 9Router, nên fix tận gốc)"),
});

export type ModelOverride = {
  modelProvider?: "openai-compatible" | "anthropic" | null;
  modelName?: string | null;
};

/**
 * Chọn model theo thứ tự ưu tiên: override của agent (não) -> runtime_settings
 * (dashboard) -> env. Gọi mỗi lượt agent nên đổi từ UI có hiệu lực ngay.
 * - openai-compatible: router proxy (9Router, LiteLLM, OpenRouter...) qua base URL
 * - anthropic: gọi thẳng API Anthropic
 * API key/base URL luôn lấy từ cấu hình chung (per-agent key là chuyện sau).
 */
export function resolveLanguageModel(override?: ModelOverride): LanguageModel {
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

  switch (settings.provider) {
    case "openai-compatible": {
      if (!settings.baseUrl) {
        throw new Error("Thiếu base URL cho provider openai-compatible");
      }
      const provider = createOpenAICompatible({
        name: "llm-router",
        baseURL: settings.baseUrl,
        apiKey: settings.apiKey,
        fetch: sanitizingFetch,
      });
      return provider(settings.model);
    }
    case "anthropic": {
      const provider = createAnthropic({ apiKey: settings.apiKey });
      return provider(settings.model);
    }
  }
}
