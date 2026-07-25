import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir, env } from "../config/env.js";

// Cookie Zalo = full quyền tài khoản, nên mã hóa AES-256-GCM khi lưu đĩa.
// Layout file: [iv 12 bytes][authTag 16 bytes][ciphertext]

export type StoredCredentials = {
  cookie: unknown;
  imei: string;
  userAgent: string;
};

const encryptionKey = () => Buffer.from(env.CREDENTIALS_ENCRYPTION_KEY, "hex");

export function credentialsPath(accountId: string): string {
  return path.join(dataDir, "accounts", accountId, "credentials.enc");
}

export function hasCredentials(accountId: string): boolean {
  return fs.existsSync(credentialsPath(accountId));
}

export function saveCredentials(accountId: string, creds: StoredCredentials): void {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(creds), "utf-8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), encrypted]);

  const file = credentialsPath(accountId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, payload, { mode: 0o600 });
}

export function loadCredentials(accountId: string): StoredCredentials | null {
  const file = credentialsPath(accountId);
  if (!fs.existsSync(file)) return null;

  const payload = fs.readFileSync(file);
  const iv = payload.subarray(0, 12);
  const authTag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);

  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(plaintext.toString("utf-8")) as StoredCredentials;
}
