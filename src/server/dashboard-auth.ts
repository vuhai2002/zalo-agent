import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { currentPasswordMaterial, verifyPassword } from "./dashboard-password-store.js";
import {
  deleteSession,
  findSession,
  insertSession,
  pruneSessions,
} from "./dashboard-session-store.js";

/**
 * Auth cho dashboard: password (env) -> session token, phiên lưu trong SQLite.
 * Token = "<sessionId>.<secret>", DB chỉ giữ sha256(secret).
 *
 * Vì sao có bản ghi trong DB thay vì token HMAC thuần: logout phải thu hồi được
 * thật. Token tự chứng thực thì cookie bị lộ vẫn dùng được đến khi hết hạn, và
 * đổi DASHBOARD_PASSWORD cũng không đá được phiên nào ra.
 */

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 ngày

const hmacKey = () => Buffer.from(env.CREDENTIALS_ENCRYPTION_KEY, "hex");

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/** So sánh chuỗi thời gian không đổi - hash cả 2 vế để độ dài luôn bằng nhau */
function safeEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", hmacKey()).update(a).digest();
  const hb = createHmac("sha256", hmacKey()).update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Dấu vân tay của password đang hiệu lực. Lưu vào từng phiên để đổi mật khẩu
 * là mọi phiên cũ hết giá trị ngay, không cần xóa DB tay. Nguồn là
 * `currentPasswordMaterial()` nên đổi qua web cũng đá phiên y như sửa `.env`.
 */
function passwordFingerprint(): string {
  return createHmac("sha256", hmacKey()).update(currentPasswordMaterial()).digest("hex");
}

/**
 * `DASHBOARD_PASSWORD` vẫn là CÔNG TẮC bật/tắt dashboard: không set thì không
 * đăng nhập được kể cả khi DB có mật khẩu đã đổi. Giữ đúng mặc định an toàn
 * "không cấu hình = không mở cửa", và khớp với `startDashboardServer` vốn
 * không mở cổng khi thiếu biến này.
 */
export function checkPassword(input: string): boolean {
  if (!env.DASHBOARD_PASSWORD) return false;
  return verifyPassword(input);
}

export function createSessionToken(nowMs = Date.now()): string {
  const fingerprint = passwordFingerprint();
  // Login là dịp rẻ nhất để dọn: bảng này chỉ vài dòng
  pruneSessions(nowMs, fingerprint);

  const id = randomBytes(16).toString("hex");
  const secret = randomBytes(32).toString("hex");
  insertSession({
    id,
    secretHash: sha256(secret),
    passwordFingerprint: fingerprint,
    createdAt: nowMs,
    expiresAt: nowMs + SESSION_TTL_MS,
  });
  return `${id}.${secret}`;
}

function parseToken(token: string | undefined): { id: string; secret: string } | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  return { id: token.slice(0, dot), secret: token.slice(dot + 1) };
}

export function verifySessionToken(token: string | undefined, nowMs = Date.now()): boolean {
  const parsed = parseToken(token);
  if (!parsed) return false;

  const record = findSession(parsed.id);
  if (!record) return false;

  if (record.expiresAt <= nowMs) {
    deleteSession(parsed.id);
    return false;
  }
  // Password đã đổi sau khi phiên này được tạo
  if (!safeEqual(record.passwordFingerprint, passwordFingerprint())) return false;

  return safeEqual(record.secretHash, sha256(parsed.secret));
}

/** Logout: xóa hẳn phiên khỏi DB - cookie cũ không dùng lại được */
export function revokeSessionToken(token: string | undefined): void {
  const parsed = parseToken(token);
  if (parsed) deleteSession(parsed.id);
}

// ===== Rate limit login: chặn brute-force password =====

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 60_000;
/** Quá số bucket này mới quét dọn - dọn mỗi lần gọi là O(n) không cần thiết */
const PRUNE_THRESHOLD = 500;

const attempts = new Map<string, { count: number; resetAt: number }>();

/** Map sống suốt đời process: bỏ bucket đã hết cửa sổ để không phình vô hạn */
function pruneExpiredAttempts(nowMs: number): void {
  for (const [ip, entry] of attempts) {
    if (nowMs >= entry.resetAt) attempts.delete(ip);
  }
}

/** true = còn được phép thử login; false = quá 5 lần/phút */
export function allowLoginAttempt(ip: string, nowMs = Date.now()): boolean {
  if (attempts.size > PRUNE_THRESHOLD) pruneExpiredAttempts(nowMs);

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

/** Số bucket rate-limit đang giữ - dùng cho test rò rỉ bộ nhớ */
export function loginAttemptBucketCount(): number {
  return attempts.size;
}
