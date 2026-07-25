import { getEffectiveLlmSettings } from "../config/runtime-llm-settings.js";
import { db } from "../conversation/database.js";

/** Số liệu thật cho trang Overview - không có gì là mock */

const countStmt = (table: string) =>
  db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE account_id = ?`);

const threadsCount = countStmt("threads");
const contactsCount = countStmt("contacts");
const memoriesCount = countStmt("memories");
const messagesCount = countStmt("messages");

const messagesTodayStmt = db.prepare(
  `SELECT COUNT(*) AS n FROM messages
   WHERE account_id = ? AND created_at >= strftime('%Y-%m-%dT00:00:00Z', 'now')`,
);

export type AccountStats = {
  threads: number;
  contacts: number;
  memories: number;
  messagesTotal: number;
  messagesToday: number;
};

export function getAccountStats(accountId: string): AccountStats {
  const n = (stmt: ReturnType<typeof db.prepare>) =>
    (stmt.get(accountId) as { n: number }).n;
  return {
    threads: n(threadsCount),
    contacts: n(contactsCount),
    memories: n(memoriesCount),
    messagesTotal: n(messagesCount),
    messagesToday: (messagesTodayStmt.get(accountId) as { n: number }).n,
  };
}

export type SystemInfo = {
  uptimeSeconds: number;
  nodeVersion: string;
  llm: { provider: string; model: string; hasOverride: boolean };
};

export function getSystemInfo(): SystemInfo {
  const llm = getEffectiveLlmSettings();
  return {
    uptimeSeconds: Math.floor(process.uptime()),
    nodeVersion: process.version,
    llm: { provider: llm.provider, model: llm.model, hasOverride: llm.hasOverride },
  };
}
