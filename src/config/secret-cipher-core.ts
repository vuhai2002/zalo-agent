import crypto from "node:crypto";

/**
 * Phần MÃ HÓA THUẦN của `secret-cipher.ts` - nhận khóa qua tham số thay vì đọc
 * `env`.
 *
 * Tách ra vì có người dùng cần giải mã mà KHÔNG được phép nạp `env.js`: bộ eval
 * (`evals/eval-env.ts`) phải đọc cấu hình LLM từ DB THẬT trước khi dựng env tạm,
 * mà `env.js` parse `process.env` ngay lúc import nên nạp sớm là chốt nhầm giá
 * trị. Chép đoạn crypto sang đó là hai bản dễ lệch - đúng thứ mà `secret-cipher`
 * sinh ra để tránh.
 *
 * Module THUẦN: chỉ `node:crypto`.
 *
 * AES-256-GCM, định dạng base64("iv|authTag|ciphertext").
 */

const khoa = (keyHex: string): Buffer => Buffer.from(keyHex, "hex");

export function encryptWith(keyHex: string, plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", khoa(keyHex), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

export function decryptWith(keyHex: string, payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", khoa(keyHex), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf-8");
}

/** "sk-abc...xyz" - đủ nhận diện key nào, không đủ dùng lại */
export function maskSecret(value: string): string {
  if (!value) return "chưa cấu hình";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 5)}...${value.slice(-4)}`;
}
