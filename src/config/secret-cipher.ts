import { env } from "./env.js";
import { decryptWith, encryptWith } from "./secret-cipher-core.js";

/**
 * Mã hóa secret lưu trong DB (API key nhập từ dashboard). AES-256-GCM cùng
 * khóa với cookie Zalo; định dạng base64("iv|authTag|ciphertext").
 *
 * Tách riêng vì đã có 2 nơi cần (LLM API key, key search provider) - hai bản
 * copy của cùng đoạn crypto là chỗ dễ lệch nhất khi sửa.
 *
 * File này chỉ còn phần NỐI KHÓA: thuật toán nằm ở `secret-cipher-core.ts`
 * (thuần, nhận khóa qua tham số) để bộ eval giải mã được cấu hình trong DB thật
 * mà không phải nạp `env.js` sớm.
 */

export function encryptSecret(plaintext: string): string {
  return encryptWith(env.CREDENTIALS_ENCRYPTION_KEY, plaintext);
}

export function decryptSecret(payload: string): string {
  return decryptWith(env.CREDENTIALS_ENCRYPTION_KEY, payload);
}

export { maskSecret } from "./secret-cipher-core.js";
