import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { getEffectiveLlmSettings } from "../config/runtime-llm-settings.js";
import type { LlmProviderKind } from "../config/llm-provider-kind.js";
import { createLogger } from "../shared/logger.js";
import { cacheSessionHeaders } from "./cache-session-id.js";
import { createSanitizingFetch } from "./llm-response-sanitizer.js";
import {
  reasoningProviderOptions,
  ROUTER_PROVIDER_OPTIONS_KEY,
  type ReasoningEffort,
} from "./reasoning-options.js";
import { LoiCauHinhLlm } from "./llm-config-error.js";
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
  modelProvider?: LlmProviderKind | null;
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
  thread?: { accountId: string; threadId: string; contextEpoch?: number },
): LanguageModel {
  const base = getEffectiveLlmSettings();
  const settings = { ...base, ...doiProviderAnToan(base, override) };
  if (!settings.apiKey) {
    // Khóa CÓ trong DB nhưng giải mã hỏng là chuyện khác hẳn "chưa nhập": nói
    // sai bệnh thì người dùng đi nhập lại key trong khi gốc rễ là
    // CREDENTIALS_ENCRYPTION_KEY đã đổi - và lúc đó cookie Zalo cũng hỏng theo.
    throw new LoiCauHinhLlm(
      "api_key",
      settings.apiKeyHong
        ? "Không giải mã được LLM API key đã lưu - CREDENTIALS_ENCRYPTION_KEY có thể đã đổi so với lúc lưu. Nhập lại key ở trang Providers, và kiểm tra cả phiên đăng nhập Zalo."
        : "Chưa cấu hình LLM API key - nhập ở trang Providers trên dashboard (hoặc LLM_API_KEY trong .env)",
    );
  }
  // Cùng nếp với API key: thiếu model thì báo ở ĐÂY chứ không chết lúc boot.
  // Không có nhánh này thì provider nhận model rỗng và người dùng nhận một lỗi
  // HTTP khó hiểu từ router thay vì câu nói rõ mình cần làm gì.
  if (!settings.model) {
    throw new LoiCauHinhLlm(
      "model",
      "Chưa cấu hình model - nhập ở trang Providers trên dashboard (hoặc LLM_MODEL trong .env)",
    );
  }

  const sessionHeaders = thread
    ? cacheSessionHeaders(
        getTuning("LLM_CACHE_SESSION_ENABLED"),
        thread.accountId,
        thread.threadId,
        thread.contextEpoch ?? 0,
      )
    : {};

  switch (settings.provider) {
    case "openai-compatible": {
      if (!settings.baseUrl) {
        throw new LoiCauHinhLlm(
          "base_url",
          "Chưa cấu hình base URL cho provider openai-compatible - nhập ở trang Providers trên dashboard",
        );
      }
      const provider = createOpenAICompatible({
        // Đổi name phải đổi cả ROUTER_PROVIDER_OPTIONS_KEY (reasoning-options.ts)
        name: ROUTER_PROVIDER_OPTIONS_KEY,
        baseURL: settings.baseUrl,
        apiKey: settings.apiKey,
        headers: sessionHeaders,
        fetch: sanitizingFetch,
        // Gửi `stream_options: {include_usage: true}`. Lượt agent đi đường
        // streaming (xem stream-text-result.ts), mà provider này mặc định KHÔNG
        // gửi cờ đó - với provider chỉ trả usage khi được hỏi thì mọi số token
        // của bot âm thầm về 0: log sai, bảng usage sai, trần token mất tác dụng.
        // Đo trên 9Router thì nó trả usage kể cả khi không hỏi, nhưng cả điểm
        // của `openai-compatible` là đổi provider bằng env mà không sửa code -
        // LiteLLM/OpenRouter/vLLM đều đòi cờ này.
        includeUsage: true,
      });
      return provider(settings.model);
    }
    case "anthropic": {
      // Gọi thẳng Anthropic thì header phiên vô nghĩa (không có router đọc),
      // nhưng gửi kèm cũng vô hại và giữ hành vi đồng nhất giữa 2 nhánh.
      const provider = createAnthropic({ apiKey: settings.apiKey, headers: sessionHeaders });
      return provider(settings.model);
    }
    case "google": {
      // PHẢI đi provider riêng của Google, KHÔNG dùng shim OpenAI của họ qua
      // `openai-compatible`. Gemini 3 trả kèm mỗi function call một
      // "thought_signature" và BẮT BUỘC nhận lại nó ở lượt sau; shim đưa chữ ký
      // đó ở `tool_calls[].extra_content.google.thought_signature`, mà
      // `@ai-sdk/openai-compatible` chỉ đọc các trường chuẩn OpenAI nên vứt mất.
      // Hệ quả đo thật 06/08/2026: mọi lượt CÓ GỌI TOOL chết bằng 400
      // "Function call is missing a thought_signature in functionCall parts",
      // chat chay thì vẫn sống. Provider này giữ chữ ký giúp (vercel/ai#10344,
      // #11413 - đã đóng).
      const provider = createGoogleGenerativeAI({
        apiKey: settings.apiKey,
        headers: sessionHeaders,
        // Bỏ trống thì SDK tự dùng endpoint của Google - xem `baseUrlChoGoogle`
        ...(baseUrlChoGoogle(settings.baseUrl) ? { baseURL: baseUrlChoGoogle(settings.baseUrl)! } : {}),
      });
      return provider(settings.model);
    }
  }
}

/**
 * Base URL dùng được cho provider Google, hoặc `undefined` để SDK tự dùng
 * endpoint mặc định của hãng.
 *
 * Làm HAI việc, cả hai đều vì base URL cũ nằm lại trong DB khi người dùng đổi ô
 * "Kiểu kết nối":
 *
 * 1. GỠ ĐUÔI "/openai". Google có hai endpoint trên cùng host: API riêng ở
 *    `/v1beta` và lớp giả OpenAI ở `/v1beta/openai`. Provider này nói API
 *    riêng, trỏ vào lớp giả kia là 404. Nút chọn nhanh "Google Gemini" trước
 *    đây điền đúng cái đuôi ấy, nên cấu hình đang lưu chắc chắn có.
 * 2. BỎ HẲN base URL của hãng KHÁC. Người đang chạy OpenRouter hay 9Router mà
 *    đổi sang Google thì URL cũ vẫn còn - gửi khóa Google sang đó là vừa lộ
 *    khóa sang bên thứ ba vừa nhận 401 khó hiểu. Cùng loại tai nạn mà
 *    `doiProviderAnToan` chặn ở tầng provider, nên chặn theo cùng cách: thà bỏ
 *    qua cấu hình lệch để rơi về trạng thái chạy được.
 */
export function baseUrlChoGoogle(baseUrl: string | undefined): string | undefined {
  if (!baseUrl) return undefined;
  const sach = baseUrl.trim().replace(/\/+$/, "").replace(/\/openai$/i, "");
  if (!sach) return undefined;
  try {
    // Chỉ nhận đúng host của Google; chuỗi không parse được cũng bỏ qua
    if (!/(^|\.)googleapis\.com$/i.test(new URL(sach).hostname)) return undefined;
  } catch {
    return undefined;
  }
  return sach;
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
export function modelHieuLuc(override?: ModelOverride): { provider: LlmProviderKind; model: string } {
  return doiProviderAnToan(getEffectiveLlmSettings(), override);
}

/** Mức suy nghĩ hiệu lực: agent đặt riêng thắng mức mặc định ở trang Cấu hình */
export function resolveReasoningEffort(override?: ModelOverride): ReasoningEffort {
  return override?.reasoningEffort ?? getTuning("LLM_REASONING_EFFORT");
}
