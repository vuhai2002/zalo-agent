import path from "node:path";
// Dùng SQLite built-in của Node (>= 22.13) - không cần native build (better-sqlite3
// yêu cầu Visual Studio Build Tools trên Windows). API đủ cho nhu cầu key-value history.
import { DatabaseSync } from "node:sqlite";
import { dataDir, env } from "../config/env.js";

export type StoredMessage = {
  role: "user" | "assistant";
  content: string;
  senderName?: string;
};

const db = new DatabaseSync(path.join(dataDir, "zalo-agent.db"));
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    sender_name TEXT,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_messages_account_thread
    ON messages (account_id, thread_id, id);
`);

const insertStmt = db.prepare(
  `INSERT INTO messages (account_id, thread_id, role, sender_name, content)
   VALUES (?, ?, ?, ?, ?)`,
);

const recentStmt = db.prepare(
  `SELECT role, sender_name, content FROM messages
   WHERE account_id = ? AND thread_id = ?
   ORDER BY id DESC LIMIT ?`,
);

export function appendMessage(
  accountId: string,
  threadId: string,
  message: StoredMessage,
): void {
  insertStmt.run(accountId, threadId, message.role, message.senderName ?? null, message.content);
}

export function getRecentMessages(
  accountId: string,
  threadId: string,
  limit = env.HISTORY_CONTEXT_LIMIT,
): StoredMessage[] {
  type Row = { role: "user" | "assistant"; sender_name: string | null; content: string };
  const rows = recentStmt.all(accountId, threadId, limit) as unknown as Row[];
  // DESC để lấy N tin mới nhất, đảo lại thành thứ tự thời gian cho LLM
  return rows.reverse().map((r) => ({
    role: r.role,
    content: r.content,
    senderName: r.sender_name ?? undefined,
  }));
}

export function closeHistoryStore(): void {
  db.close();
}
