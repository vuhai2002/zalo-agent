import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

/**
 * Auth cho dashboard: password (env) -> session token HMAC-signed, stateless.
 * Token = "<expiresAtMs>.<hmac(expiresAtMs)>" - không cần bảng session, sống
 * qua restart vì key ký là CREDENTIALS_ENCRYPTION_KEY cố định.
 */

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 ngày

const hmacKey = () => Buffer.from(env.CREDENTIALS_ENCRYPTION_KEY, "hex");

function sign(payload: string): string {
  return createHmac("sha256", hmacKey()).update(payload).digest("hex");
}

/** So sánh chuỗi thời gian không đổi - hash cả 2 vế để độ dài luôn bằng nhau */
function safeEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", hmacKey()).update(a).digest();
  const hb = createHmac("sha256", hmacKey()).update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function checkPassword(input: string): boolean {
  if (!env.DASHBOARD_PASSWORD) return false;
  return safeEqual(input, env.DASHBOARD_PASSWORD);
}

export function createSessionToken(nowMs = Date.now()): string {
  const expiresAt = String(nowMs + SESSION_TTL_MS);
  return `${expiresAt}.${sign(expiresAt)}`;
}

export function verifySessionToken(token: string | undefined, nowMs = Date.now()): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expiresAt = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!safeEqual(signature, sign(expiresAt))) return false;
  return Number(expiresAt) > nowMs;
}

// ===== Rate limit login: chặn brute-force password =====

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 60_000;

const attempts = new Map<string, { count: number; resetAt: number }>();

/** true = còn được phép thử login; false = quá 5 lần/phút */
export function allowLoginAttempt(ip: string, nowMs = Date.now()): boolean {
  const entry = attempts.get(ip);
  if (!entry || nowMs >= entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: nowMs + LOGIN_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= LOGIN_MAX_ATTEMPTS;
}

/** Login thành công thì xóa đếm để không khóa oan lần sau */
export function clearLoginAttempts(ip: string): void {
  attempts.delete(ip);
}
