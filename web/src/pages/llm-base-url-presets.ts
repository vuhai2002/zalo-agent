/**
 * Base URL dựng sẵn cho các nhà cung cấp nói giao thức OpenAI.
 *
 * Vì sao cần: ô "Kiểu kết nối" chỉ có 2 lựa chọn (OpenAI-compatible / Anthropic)
 * nên nhìn vào tưởng bot chỉ chạy được 2 hãng. Thật ra mọi endpoint nói giao
 * thức OpenAI đều dùng được - thiếu mỗi việc người dùng phải tự đi tra URL.
 *
 * Mỗi dòng kèm link tài liệu gốc đã tra ngày 2026-08-03. URL của các hãng CÓ
 * đổi (Moonshot vừa dời tài liệu từ platform.moonshot.ai sang platform.kimi.ai),
 * nên khi nghi ngờ hãy mở lại link rồi sửa ở đây, đừng đoán.
 *
 * `@ai-sdk/openai-compatible` nối `baseURL + "/chat/completions"` sau khi cắt
 * dấu gạch cuối (đọc `dist/index.js`: `withoutTrailingSlash`), nên URL dưới đây
 * ghi KHÔNG kèm gạch cuối và phải là phần gốc đứng trước `/chat/completions`.
 */

export type BaseUrlPreset = {
  /** Tên hãng hiện trên danh sách */
  label: string;
  baseUrl: string;
};

export const BASE_URL_PRESETS: BaseUrlPreset[] = [
  // https://openrouter.ai/docs/quickstart
  { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  // https://ai.google.dev/gemini-api/docs/openai
  { label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  // https://api-docs.deepseek.com - tài liệu ghi ĐÚNG dạng không có /v1
  { label: "DeepSeek", baseUrl: "https://api.deepseek.com" },
  // https://platform.kimi.ai/docs/api/chat (platform.moonshot.ai đã 301 sang đây)
  { label: "Kimi (Moonshot)", baseUrl: "https://api.moonshot.ai/v1" },
  // https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope
  { label: "Qwen (Alibaba, quốc tế)", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" },
  { label: "Qwen (Alibaba, Trung Quốc)", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  // https://docs.z.ai/guides/develop/openai/python - gói Coding Plan dùng URL
  // khác (/api/coding/paas/v4), không đưa vào đây để khỏi chọn nhầm
  { label: "GLM (Z.ai)", baseUrl: "https://api.z.ai/api/paas/v4" },
  // https://docs.x.ai/docs/api-reference
  { label: "Grok (xAI)", baseUrl: "https://api.x.ai/v1" },
  // https://docs.mistral.ai/api
  { label: "Mistral", baseUrl: "https://api.mistral.ai/v1" },
  // https://console.groq.com/docs/openai
  { label: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
  { label: "Ollama (máy nhà)", baseUrl: "http://localhost:11434/v1" },
];

/** Giá trị của mục "Tự nhập" - chuỗi rỗng để không đụng vào base URL đang có */
export const TU_NHAP = "";

/**
 * Tên hãng khớp với base URL đang nhập, hoặc `TU_NHAP` khi không khớp mục nào.
 *
 * So sánh sau khi cắt gạch cuối và hạ chữ thường: người dùng dán URL từ tài liệu
 * hay kèm gạch cuối (tài liệu Gemini ghi hẳn `.../openai/`), mà lệch mỗi dấu đó
 * thì danh sách nhảy về "Tự nhập" trong khi rõ ràng đang là Gemini.
 */
export function timPreset(baseUrl: string): string {
  const chuan = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
  const can = chuan(baseUrl);
  if (!can) return TU_NHAP;
  return BASE_URL_PRESETS.find((p) => chuan(p.baseUrl) === can)?.baseUrl ?? TU_NHAP;
}
