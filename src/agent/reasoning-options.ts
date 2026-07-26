/**
 * Bật "suy nghĩ" (reasoning/thinking) cho model - học chokepoint
 * resolve_reasoning_config của Hermes: MỘT nơi duy nhất quyết định tham số
 * thinking cho mọi đường gọi, map theo provider đang hiệu lực.
 *
 * Vì sao cần: không bật thinking, model đọc 50k token nội dung trang web theo
 * kiểu lướt một lượt - bảng số pipe-separated, đối chiếu từng đuôi vé... đều là
 * việc cần nghĩ từng bước. Vụ dò vé số: dữ liệu ĐÃ vào context (51k token input)
 * mà model vẫn kết luận "chưa lấy được bảng" - thiếu bước nghĩ, không phải thiếu
 * dữ liệu.
 *
 * Module thuần (không import env) để test không cần setupTestEnv.
 */

export type ReasoningEffort = "off" | "low" | "medium" | "high" | "xhigh";

/**
 * Cấu trúc providerOptions của AI SDK (Record<provider, Record<key, JSON>>).
 * Tự khai thay vì import từ @ai-sdk/provider-utils - đó là dep gián tiếp,
 * pnpm strict không cho import; thêm dep thật chỉ vì 1 type là không đáng.
 */
type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type ReasoningOptions = Record<string, Record<string, JsonValue>>;

export type ProviderKind = "openai-compatible" | "anthropic";

/**
 * Trùng với `name` truyền vào createOpenAICompatible trong llm-provider.ts.
 *
 * PHẢI viết camelCase: `@ai-sdk/openai-compatible` chuyển tên provider sang
 * camelCase rồi so lại, thấy client dùng bản kebab-case (`llm-router`) là in
 * cảnh báo deprecated MỖI REQUEST. Tham số vẫn tới nơi (SDK rơi về key thô khi
 * không có bản camelCase) nhưng terminal ngập cảnh báo. Hằng số này chỉ dùng
 * nội bộ nên đổi tên không ảnh hưởng gì bên ngoài.
 */
export const ROUTER_PROVIDER_OPTIONS_KEY = "llmRouter";

/**
 * providerOptions cho generateText theo provider + mức effort.
 * - openai-compatible: `reasoning_effort` chuẩn OpenAI - 9Router truyền tiếp
 *   cho upstream (Anthropic/OpenAI đều hiểu qua translation của router)
 * - anthropic trực tiếp: adaptive thinking + effort (Claude 4.6+/5); model cũ
 *   không nhận "xhigh" thì hạ mức trong env
 * - "off": anthropic tắt hẳn thinking; openai-compatible bỏ tham số (mỗi router
 *   một kiểu giá trị "tắt", bỏ hẳn là an toàn nhất)
 */
export function reasoningProviderOptions(
  provider: ProviderKind,
  effort: ReasoningEffort,
): ReasoningOptions | undefined {
  if (provider === "anthropic") {
    if (effort === "off") return { anthropic: { thinking: { type: "disabled" } } };
    return { anthropic: { thinking: { type: "adaptive" }, effort } };
  }

  if (effort === "off") return undefined;
  return { [ROUTER_PROVIDER_OPTIONS_KEY]: { reasoningEffort: effort } };
}
