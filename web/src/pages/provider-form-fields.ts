/**
 * Hai quyết định thuần của form nhà cung cấp LLM, tách khỏi hook để test được.
 *
 * Cả hai đều sinh ra từ cùng một sự thật: Base URL và Model THUỘC VỀ một nhà
 * cung cấp cụ thể, không mang sang nhà khác được. Trước đây form coi chúng như
 * ô độc lập nên đổi "Kiểu kết nối" xong ô Model vẫn là `gemini-3.5-flash-lite`
 * trong khi đã chọn Anthropic - bấm Lưu là lưu được tổ hợp vô nghĩa, và Base
 * URL của nhà cũ thì nằm lại trong DB vĩnh viễn rồi hiện lại lúc quay về.
 */

export type CauHinhDaLuu = { provider: string; baseUrl: string; model: string };

/**
 * Giá trị hai ô sau khi người dùng đổi "Kiểu kết nối".
 *
 * Quay VỀ nhà cung cấp đang lưu thì khôi phục nguyên giá trị đã lưu - bấm nhầm
 * rồi bấm lại là chuyện thường, bắt gõ lại tên model chỉ là ma sát. Mọi hướng
 * khác thì dọn sạch để người dùng phải chọn có ý thức.
 */
export function oTheoNhaCungCap(
  providerMoi: string,
  daLuu: CauHinhDaLuu | null,
): { baseUrl: string; model: string } {
  if (daLuu && providerMoi === daLuu.provider) {
    return { baseUrl: daLuu.baseUrl, model: daLuu.model };
  }
  return { baseUrl: "", model: "" };
}

/**
 * Giá trị `baseUrl` gửi lên khi Lưu.
 *
 * `undefined` = giữ nguyên, `null` = xóa hẳn (xem `LlmSettingsUpdate.baseUrl`).
 * Nhà cung cấp gọi thẳng hãng không dùng base URL, nên phải XÓA chứ không phải
 * bỏ qua - bỏ qua là để URL của nhà cũ nằm lại trong DB.
 */
export function baseUrlKhiLuu(provider: string, baseUrl: string): string | null | undefined {
  if (provider !== "openai-compatible") return null;
  // Ô để trống ở nhánh openai-compatible vẫn là "giữ nguyên" như hành vi cũ
  return baseUrl || undefined;
}
