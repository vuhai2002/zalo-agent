import crypto from "node:crypto";
import { env } from "./env.js";

/**
 * Mã hóa secret lưu trong DB (API key nhập từ dashboard). AES-256-GCM cùng
 * khóa với cookie Zalo; định dạng base64("iv|authTag|ciphertext").
 *
 * Tách riêng vì đã có 2 nơi cần (LLM API key, key search provider) - hai bản
 * copy của cùng đoạn crypto là chỗ dễ lệch nhất khi sửa.
 */

const encryptionKey = () => Buffer.from(env.CREDENTIALS_ENCRYPTION_KEY, "hex");

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf-8");
}

/** "sk-abc...xyz" - đủ nhận diện key nào, không đủ dùng lại */
export function maskSecret(value: string): string {
  if (!value) return "chưa cấu hình";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 5)}...${value.slice(-4)}`;
}
