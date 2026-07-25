import { db } from "../conversation/database.js";

/**
 * Lưu phiên đăng nhập dashboard trong SQLite. Chỉ lưu HASH của secret, nên đọc
 * được file DB cũng không dựng lại được cookie hợp lệ.
 */

export type SessionRecord = {
  id: string;
  secretHash: string;
  passwordFingerprint: string;
  expiresAt: number;
};

const insertStmt = db.prepare(`
  INSERT INTO dashboard_sessions (id, secret_hash, password_fingerprint, created_at, expires_at)
  VALUES (?, ?, ?, ?, ?)
`);
const getStmt = db.prepare(`
  SELECT id, secret_hash, password_fingerprint, expires_at
  FROM dashboard_sessions WHERE id = ?
`);
const deleteStmt = db.prepare("DELETE FROM dashboard_sessions WHERE id = ?");
const pruneExpiredStmt = db.prepare("DELETE FROM dashboard_sessions WHERE expires_at <= ?");
const pruneStaleFingerprintStmt = db.prepare(
  "DELETE FROM dashboard_sessions WHERE password_fingerprint <> ?",
);
const countStmt = db.prepare("SELECT COUNT(*) AS n FROM dashboard_sessions");

type SessionRow = {
  id: string;
  secret_hash: string;
  password_fingerprint: string;
  expires_at: number;
};

export function insertSession(record: SessionRecord & { createdAt: number }): void {
  insertStmt.run(
    record.id,
    record.secretHash,
    record.passwordFingerprint,
    record.createdAt,
    record.expiresAt,
  );
}

export function findSession(id: string): SessionRecord | null {
  const row = getStmt.get(id) as SessionRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    secretHash: row.secret_hash,
    passwordFingerprint: row.password_fingerprint,
    expiresAt: row.expires_at,
  };
}

export function deleteSession(id: string): void {
  deleteStmt.run(id);
}

/** Dọn phiên hết hạn + phiên ký bằng password cũ (đổi password = kick sạch) */
export function pruneSessions(nowMs: number, currentFingerprint: string): void {
  pruneExpiredStmt.run(nowMs);
  pruneStaleFingerprintStmt.run(currentFingerprint);
}

/** Số phiên đang lưu - dùng cho test */
export function countSessions(): number {
  return (countStmt.get() as { n: number }).n;
}
