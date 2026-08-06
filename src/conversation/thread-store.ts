import { db } from "./database.js";

export type ThreadRow = {
  accountId: string;
  threadId: string;
  threadType: number;
  displayName: string;
  botEnabled: boolean;
  messageCount: number;
  lastMessageAt: string | null;
  lastSenderName: string | null;
};

const upsertStmt = db.prepare(`
  INSERT INTO threads (account_id, thread_id, thread_type, display_name, message_count,
                       last_message_at, last_sender_name)
  VALUES (?, ?, ?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?)
  ON CONFLICT (account_id, thread_id) DO UPDATE SET
    message_count = message_count + 1,
    last_message_at = excluded.last_message_at,
    last_sender_name = excluded.last_sender_name,
    -- Tên mới chỉ ghi đè khi không rỗng (tin sau có thể thiếu tên)
    display_name = CASE WHEN excluded.display_name != '' THEN excluded.display_name
                        ELSE display_name END
`);

/** Ghi nhận 1 tin đến cho thread (tạo mới nếu chưa có). displayName rỗng = giữ tên cũ. */
export function recordThreadActivity(params: {
  accountId: string;
  threadId: string;
  threadType: number;
  displayName: string;
  lastSenderName: string;
}): void {
  upsertStmt.run(
    params.accountId,
    params.threadId,
    params.threadType,
    params.displayName,
    params.lastSenderName,
  );
}

const getStmt = db.prepare(
  "SELECT bot_enabled, display_name FROM threads WHERE account_id = ? AND thread_id = ?",
);

/** Bot có được phép trả lời thread này không. Thread chưa từng thấy = có. */
export function isBotEnabled(accountId: string, threadId: string): boolean {
  const row = getStmt.get(accountId, threadId) as { bot_enabled: number } | undefined;
  return row === undefined || row.bot_enabled === 1;
}

/**
 * Trạng thái thread cho scheduler (`proactive-send-guard.ts`) - CỐ Ý khác
 * `isBotEnabled` ở trên: hàm đó mặc định permissive cho thread lạ (đúng cho
 * TIN ĐẾN - chưa kịp ghi thread thì vẫn phải trả lời được), còn tin CHỦ ĐỘNG
 * không được nhắm vào một thread chưa từng ghi nhận trong hệ thống - trả
 * `undefined` để caller coi đó là điều kiện chặn, không phải mặc định cho qua.
 */
export function findThreadStatus(accountId: string, threadId: string): { botEnabled: boolean } | undefined {
  const row = getStmt.get(accountId, threadId) as { bot_enabled: number } | undefined;
  return row ? { botEnabled: row.bot_enabled === 1 } : undefined;
}

/** Thread group đã có tên hiển thị chưa - dùng để quyết định có gọi getGroupInfo không */
export function hasDisplayName(accountId: string, threadId: string): boolean {
  const row = getStmt.get(accountId, threadId) as { display_name: string } | undefined;
  return row !== undefined && row.display_name !== "";
}

const setEnabledStmt = db.prepare(
  "UPDATE threads SET bot_enabled = ? WHERE account_id = ? AND thread_id = ?",
);

export function setBotEnabled(accountId: string, threadId: string, enabled: boolean): boolean {
  const result = setEnabledStmt.run(enabled ? 1 : 0, accountId, threadId);
  return result.changes > 0;
}

const setNameStmt = db.prepare(
  "UPDATE threads SET display_name = ? WHERE account_id = ? AND thread_id = ?",
);

export function setThreadDisplayName(accountId: string, threadId: string, name: string): void {
  setNameStmt.run(name, accountId, threadId);
}

// ===== Memory lớp 2: rolling summary =====

const getSummaryStmt = db.prepare(
  "SELECT summary, summary_covers_to_message_id FROM threads WHERE account_id = ? AND thread_id = ?",
);

export function getThreadSummary(
  accountId: string,
  threadId: string,
): { summary: string; coversTo: number } {
  const row = getSummaryStmt.get(accountId, threadId) as
    | { summary: string; summary_covers_to_message_id: number }
    | undefined;
  return { summary: row?.summary ?? "", coversTo: row?.summary_covers_to_message_id ?? 0 };
}

const setSummaryStmt = db.prepare(
  "UPDATE threads SET summary = ?, summary_covers_to_message_id = ? WHERE account_id = ? AND thread_id = ?",
);

export function setThreadSummary(
  accountId: string,
  threadId: string,
  summary: string,
  coversTo: number,
): void {
  setSummaryStmt.run(summary, coversTo, accountId, threadId);
}

const getEpochStmt = db.prepare(
  "SELECT context_epoch FROM threads WHERE account_id = ? AND thread_id = ?",
);

/**
 * Số lần ngữ cảnh thread này đã bị xóa sạch. Vào khóa phiên gửi router để mỗi
 * lần xóa mở một phiên mới - xem `cache-session-id.ts` và cột `context_epoch`.
 *
 * Thread chưa có dòng nào (tin đầu tiên chưa ghi xong) trả 0, cùng giá trị với
 * thread chưa từng bị xóa - đúng ý, vì cả hai đều là "chưa có gì để bỏ đi".
 */
export function getThreadContextEpoch(accountId: string, threadId: string): number {
  const row = getEpochStmt.get(accountId, threadId) as { context_epoch?: number } | undefined;
  return row?.context_epoch ?? 0;
}

const listStmt = db.prepare(`
  SELECT account_id, thread_id, thread_type, display_name, bot_enabled,
         message_count, last_message_at, last_sender_name
  FROM threads
  WHERE (? = '' OR account_id = ?) AND (display_name LIKE ? OR thread_id LIKE ?)
  ORDER BY last_message_at DESC
  LIMIT ? OFFSET ?
`);

/** accountId bỏ trống = mọi account (dashboard mặc định xem trộn chung) */
export function listThreads(params: {
  accountId?: string;
  query?: string;
  limit?: number;
  offset?: number;
}): ThreadRow[] {
  const acc = params.accountId ?? "";
  const like = `%${params.query ?? ""}%`;
  type Row = {
    account_id: string; thread_id: string; thread_type: number; display_name: string;
    bot_enabled: number; message_count: number; last_message_at: string | null;
    last_sender_name: string | null;
  };
  const rows = listStmt.all(
    acc, acc, like, like, params.limit ?? 50, params.offset ?? 0,
  ) as unknown as Row[];
  return rows.map((r) => ({
    accountId: r.account_id,
    threadId: r.thread_id,
    threadType: r.thread_type,
    displayName: r.display_name,
    botEnabled: r.bot_enabled === 1,
    messageCount: r.message_count,
    lastMessageAt: r.last_message_at,
    lastSenderName: r.last_sender_name,
  }));
}

/**
 * Dựng lại bảng threads từ messages sẵn có - chạy 1 lần khi threads còn trống
 * (nâng cấp từ bản chưa có dashboard). Tên thread = sender_name của tin user
 * gần nhất; thread_type không suy ra được từ messages nên tạm để -1, tin đến
 * kế tiếp sẽ upsert đúng type.
 */
export function backfillThreadsFromMessages(): number {
  const count = (db.prepare("SELECT COUNT(*) AS n FROM threads").get() as { n: number }).n;
  if (count > 0) return 0;

  const result = db
    .prepare(`
      INSERT INTO threads (account_id, thread_id, thread_type, display_name, message_count,
                           last_message_at, last_sender_name)
      SELECT m.account_id, m.thread_id, -1,
             COALESCE((SELECT sender_name FROM messages
                       WHERE account_id = m.account_id AND thread_id = m.thread_id
                         AND role = 'user' AND sender_name IS NOT NULL
                       ORDER BY id DESC LIMIT 1), ''),
             COUNT(*), MAX(m.created_at),
             (SELECT sender_name FROM messages
              WHERE account_id = m.account_id AND thread_id = m.thread_id AND role = 'user'
              ORDER BY id DESC LIMIT 1)
      FROM messages m
      GROUP BY m.account_id, m.thread_id
    `)
    .run();
  return Number(result.changes);
}
