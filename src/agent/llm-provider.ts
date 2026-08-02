import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
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

/**
 * Chốt chặn rò khóa API: chỉ nhận override provider khi TRÙNG provider chung.
 *
 * `apiKey` và `baseUrl` luôn lấy từ cấu hình chung (per-agent key chưa có). Nên
 * một agent khai `modelProvider: "anthropic"` trong khi cấu hình chung là router
 * sẽ khiến `createAnthropic({ apiKey: <khóa router> })` gửi khóa của router
 * thành header `x-api-key` tới `api.anthropic.com` - vừa lộ credential sang bên
 * thứ ba vừa làm bot câm vì 401.
 *
 * Chặn ở ĐÂY chứ không chỉ ở giao diện hay ở biên API, vì đây là chỗ duy nhất
 * mọi đường đều đi qua: bản ghi lệch đã nằm sẵn trong DB (sửa tay từ trước), một
 * route mới quên kiểm, hay lỗi tải cấu hình làm giao diện không kịp khóa ô chọn.
 *
 * Bỏ luôn `modelName` khi từ chối provider: tên model được chọn CHO provider kia
 * (vd `claude-opus-5` cho Anthropic), gửi sang router chỉ nhận 400. Rơi hẳn về
 * cấu hình chung mới là trạng thái chạy được.
 */
export function doiProviderAnToan<P extends string>(
  base: { provider: P; model: string },
  override?: { modelProvider?: P | null; modelName?: string | null },
): { provider: P; model: string } {
  const muon = override?.modelProvider;
  if (muon && muon !== base.provider) {
    log.error(
      { agentProvider: muon, providerChung: base.provider },
      "Agent khai nhà cung cấp khác cấu hình chung nhưng chưa có API key riêng - BỎ QUA override để không gửi khóa sang nhầm bên. Sửa lại ở trang Agents.",
    );
    return { provider: base.provider, model: base.model };
  }
  return { provider: muon ?? base.provider, model: override?.modelName ?? base.model };
}

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
  const settings = { ...base, ...doiProviderAnToan(base, override) };
  if (!settings.apiKey) {
    throw new Error(
      "Chưa cấu hình LLM API key - đặt LLM_API_KEY trong .env hoặc nhập ở trang Providers trên dashboard",
    );
  }

  const sessionHeaders = thread
    ? cacheSessionHeaders(getTuning("LLM_CACHE_SESSION_ENABLED"), thread.accountId, thread.threadId)
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
  // Đi qua `doiProviderAnToan` chứ KHÔNG đọc override thô: với agent khai
  // provider lệch, override bị bỏ qua ở `resolveLanguageModel` nên model chạy
  // trên provider chung. Đọc thô ở đây sẽ dựng `providerOptions` cho namespace
  // của provider KHÔNG chạy, provider thật bỏ qua âm thầm và reasoning tắt hẳn
  // trong khi giao diện vẫn hiện mức suy nghĩ đang bật.
  const { provider } = doiProviderAnToan(getEffectiveLlmSettings(), override);
  return reasoningProviderOptions(provider, resolveReasoningEffort(override));
}

/**
 * Provider + model THẬT SỰ sẽ chạy, sau khi đã bỏ qua override không an toàn.
 *
 * Mọi nơi cần suy ra "model nào đang chạy" phải gọi hàm này thay vì tự đọc
 * `override?.modelProvider ?? base.provider` - đó là cách bốn chỗ trong repo
 * từng trôi khỏi nhau.
 */
export function modelHieuLuc(override?: ModelOverride): { provider: string; model: string } {
  return doiProviderAnToan(getEffectiveLlmSettings(), override);
}

/** Mức suy nghĩ hiệu lực: agent đặt riêng thắng mức mặc định ở trang Cấu hình */
export function resolveReasoningEffort(override?: ModelOverride): ReasoningEffort {
  return override?.reasoningEffort ?? getTuning("LLM_REASONING_EFFORT");
}
