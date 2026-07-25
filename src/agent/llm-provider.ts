import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { env } from "../config/env.js";
import { createLogger } from "../shared/logger.js";
import { createSanitizingFetch } from "./llm-response-sanitizer.js";

const log = createLogger("llm-provider");

// Chỉ bọc cho đường router proxy - Anthropic trực tiếp không có bug này
const sanitizingFetch = createSanitizingFetch({
  onSanitized: () =>
    log.warn("Router trả JSON dính đuôi SSE 'data: [DONE]' - đã cắt bỏ (bug 9Router, nên fix tận gốc)"),
});

/**
 * Chọn model theo env - đổi provider chỉ cần đổi env, không sửa code.
 * - openai-compatible: router proxy (9Router, LiteLLM, OpenRouter...) qua LLM_BASE_URL
 * - anthropic: gọi thẳng API Anthropic
 * Cần thêm provider trực tiếp khác (openai, google): pnpm add @ai-sdk/openai
 * rồi thêm 1 case tương tự.
 */
export function resolveLanguageModel(): LanguageModel {
  switch (env.LLM_PROVIDER) {
    case "openai-compatible": {
      const provider = createOpenAICompatible({
        name: "llm-router",
        baseURL: env.LLM_BASE_URL!,
        apiKey: env.LLM_API_KEY,
        fetch: sanitizingFetch,
      });
      return provider(env.LLM_MODEL);
    }
    case "anthropic": {
      const provider = createAnthropic({ apiKey: env.LLM_API_KEY });
      return provider(env.LLM_MODEL);
    }
  }
}
