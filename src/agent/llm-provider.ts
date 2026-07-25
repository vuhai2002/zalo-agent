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

/**
 * Chọn model theo cấu hình hiệu lực (runtime_settings từ dashboard đè lên env).
 * Gọi mỗi lượt agent nên đổi settings từ UI có hiệu lực ngay lượt kế tiếp.
 * - openai-compatible: router proxy (9Router, LiteLLM, OpenRouter...) qua base URL
 * - anthropic: gọi thẳng API Anthropic
 * Cần thêm provider trực tiếp khác (openai, google): pnpm add @ai-sdk/openai
 * rồi thêm 1 case tương tự.
 */
export function resolveLanguageModel(): LanguageModel {
  const settings = getEffectiveLlmSettings();
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
