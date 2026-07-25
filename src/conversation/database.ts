import path from "node:path";
// Dùng SQLite built-in của Node (>= 22.13) - không cần native build (better-sqlite3
// yêu cầu Visual Studio Build Tools trên Windows). 1 connection dùng chung cho
// mọi store (history/thread/contact/usage) - node:sqlite là sync nên không cần pool.
import { DatabaseSync } from "node:sqlite";
import { dataDir } from "../config/env.js";

export const db = new DatabaseSync(path.join(dataDir, "zalo-agent.db"));
db.exec("PRAGMA journal_mode = WAL;");

runMigrations();

function runMigrations(): void {
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

    CREATE TABLE IF NOT EXISTS threads (
      account_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      thread_type INTEGER NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      bot_enabled INTEGER NOT NULL DEFAULT 1,
      message_count INTEGER NOT NULL DEFAULT 0,
      last_message_at TEXT,
      last_sender_name TEXT,
      PRIMARY KEY (account_id, thread_id)
    );

    CREATE TABLE IF NOT EXISTS contacts (
      account_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      first_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      last_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      message_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (account_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS runtime_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    -- Memory lớp 3: fact bền do agent tự lưu qua tool save_memory.
    -- learned_in_group quyết định quy tắc inject bất đối xứng (private không ra public)
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      content TEXT NOT NULL,
      learned_in_thread_id TEXT NOT NULL,
      learned_in_group INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_memories_account_subject
      ON memories (account_id, subject_id, id);

    CREATE TABLE IF NOT EXISTS agent_turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      steps INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_turns_account_created
      ON agent_turns (account_id, created_at);
  `);

  // DB tạo trước khi có cột sender_id: ALTER thêm (nullable - tin cũ không có id)
  addColumnIfMissing("messages", "sender_id", "TEXT");
  // Memory lớp 2: rolling summary per thread
  addColumnIfMissing("threads", "summary", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing("threads", "summary_covers_to_message_id", "INTEGER NOT NULL DEFAULT 0");
}

function addColumnIfMissing(table: string, column: string, definition: string): void {
  const cols = db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function closeDatabase(): void {
  db.close();
}
