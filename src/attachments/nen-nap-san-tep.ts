/**
 * Có nên tải + đọc sẵn tệp của tin gọi bot không: CHỈ khi `doc_file` còn bật
 * ở cả agent lẫn account (cùng phép giao của `listAvailableTools`). Không xét
 * thì người vận hành tắt tool rồi mà bot vẫn tải, vẫn OCR (tốn tiền model đọc
 * ảnh) và vẫn giữ chữ của tài liệu người lạ trong DB 24 giờ - không ai đọc tới.
 *
 * Hàm thuần, đọc thẳng `disabledTools` thay vì gọi `listAvailableTools`: router
 * import tool-registry là kéo cả catalog tool vào đường nhận tin. Kênh bot
 * không đi qua router này (Bot API không mang tệp).
 */
export function nenNapSanTep(agent: { disabledTools: string[] }, account: { disabledTools: string[] }): boolean {
  return !agent.disabledTools.includes("doc_file") && !account.disabledTools.includes("doc_file");
}
