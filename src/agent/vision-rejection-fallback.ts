import { APICallError, type ModelMessage } from "ai";

/**
 * Điều kiện kích hoạt reactive fallback của agent-loop: lượt đang đính pixel
 * bị provider từ chối -> dựng lại input không pixel (describe/blind) thử lại.
 * Tách khỏi agent-loop để test thuần không cần dựng cả lượt agent.
 */

/**
 * Provider TỪ CHỐI request (4xx) - với lượt đang đính ảnh, khả năng áp đảo là
 * model không nhận ảnh (endpoint ngoài 9Router không khai capability nên
 * detect đoán lạc quan). KHÔNG tính: 401/403 (sai key - bỏ ảnh cũng không
 * cứu), 429 (hết quota - lỗi tạm), 5xx (SDK maxRetries đã lo).
 */
export function isImageRejectionError(err: unknown): boolean {
  if (!APICallError.isInstance(err)) return false;
  const status = err.statusCode ?? 0;
  return status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 429;
}

/** Lượt này có part ảnh nào không - điều kiện để reactive fallback dám retry */
export function hasImageParts(messages: ModelMessage[]): boolean {
  return messages.some(
    (m) => Array.isArray(m.content) && m.content.some((p) => p.type === "file"),
  );
}
