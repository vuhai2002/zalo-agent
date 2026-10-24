import { MCPClientError } from "@ai-sdk/mcp";

/**
 * Lỗi ném ra từ một lời gọi tool MCP có phải do KẾT NỐI chết (phiên hết hạn,
 * server khởi động lại, mất mạng) hay chỉ là tool đó hỏng?
 *
 * Vì sao phải phân biệt: vòng health của `mcp-manager.ts` chỉ nối lại server
 * đang ở trạng thái `loi`. Server khởi động lại thì phiên cũ chết (404
 * "session expired") mà trạng thái vẫn là `da_ket_noi`, nên mọi lời gọi sau đó
 * hỏng mãi tới khi restart bot. Ngược lại, đánh `loi` cho MỌI lỗi là nối lại
 * oan mỗi khi model truyền sai tham số - và cắt ngang lời gọi khác đang chạy
 * dở trên cùng client.
 *
 * Luật THẬN TRỌNG, chỉ dựa vào HÌNH DẠNG lỗi của `@ai-sdk/mcp` (đã đọc
 * `dist/index.js`), không dò chữ:
 *   - `MCPClientError` có `code` số: lỗi JSON-RPC do SERVER trả lời -> server
 *     còn sống, KHÔNG phải mất kết nối. Xét trước tiên vì thân HTTP lỗi mang
 *     JSON-RPC cũng được lib đổi về dạng này.
 *   - `MCPClientError` có `statusCode` là 404 (hết phiên), 401/403 (mất quyền)
 *     hoặc 5xx -> nối lại. CHỈ các mã đó: lib gắn `statusCode` cho MỌI phản hồi
 *     hỏng, kể cả 400/413 của reverse proxy, 429 siết nhịp, và thậm chí 200 kèm
 *     "Unexpected content type". Nối lại vì 429 là gửi thêm `initialize` vào
 *     server đang siết nhịp và cắt ngang các lời gọi khác trên cùng client.
 *   - "Connection closed" / "closed client": client đã đóng, gọi nữa vô ích.
 *   - `TypeError("fetch failed")`: undici không tới được máy chủ (từ chối kết
 *     nối, mất DNS, reset) - lib ném nguyên lỗi này, không bọc.
 * Còn lại (hết giờ của `goiCoTimeout`, hủy lượt, server trả kết quả sai
 * schema) -> KHÔNG đánh: chúng không chứng minh kết nối đã chết.
 */
function laMaMatPhien(ma: number): boolean {
  return ma === 404 || ma === 401 || ma === 403 || ma >= 500;
}

export function laLoiMatKetNoiMcp(e: unknown): boolean {
  if (MCPClientError.isInstance(e)) {
    if (typeof e.code === "number") return false;
    if (typeof e.statusCode === "number") return laMaMatPhien(e.statusCode);
    return e.message === "Connection closed" || e.message === "Attempted to send a request from a closed client";
  }
  return e instanceof TypeError && e.message === "fetch failed";
}
