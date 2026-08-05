/**
 * Danh sách nhà cung cấp LLM - MỘT nguồn sự thật cho cả schema env, cấu hình
 * runtime, bộ chọn model và giao diện.
 *
 * Trước đây union này chép tay ở bốn chỗ (env, runtime settings, override của
 * agent, reasoning options). Thêm một nhà cung cấp là sửa cả bốn, mà quên một
 * chỗ thì trình biên dịch chỉ báo ở nơi ghép kiểu chứ không nói thiếu ở đâu.
 *
 * Module THUẦN: không env, không DB, không logger - để cả tầng cấu hình lẫn
 * tầng agent đều import được mà không tạo phụ thuộc ngược.
 */

export const LLM_PROVIDER_KINDS = ["openai-compatible", "anthropic", "google"] as const;

export type LlmProviderKind = (typeof LLM_PROVIDER_KINDS)[number];

export function laLlmProviderKind(giaTri: unknown): giaTri is LlmProviderKind {
  return typeof giaTri === "string" && (LLM_PROVIDER_KINDS as readonly string[]).includes(giaTri);
}

/**
 * Nhà cung cấp này gọi THẲNG hãng, không qua router proxy.
 *
 * Dùng để quyết hai chuyện: base URL có bắt buộc không (không - SDK có sẵn
 * endpoint của hãng), và có tra `/models` của router để đoán khả năng đọc ảnh
 * không (không - đường đó là API riêng của 9Router).
 */
export function laGoiThangHang(provider: LlmProviderKind): boolean {
  return provider === "anthropic" || provider === "google";
}
