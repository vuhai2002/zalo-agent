import { db } from "./database.js";

export type ContactRow = {
  accountId: string;
  userId: string;
  displayName: string;
  firstSeen: string;
  lastSeen: string;
  messageCount: number;
};

const upsertStmt = db.prepare(`
  INSERT INTO contacts (account_id, user_id, display_name, message_count)
  VALUES (?, ?, ?, 1)
  ON CONFLICT (account_id, user_id) DO UPDATE SET
    message_count = message_count + 1,
    last_seen = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    display_name = CASE WHEN excluded.display_name != '' THEN excluded.display_name
                        ELSE display_name END
`);

/**
 * Ghi nhận 1 tin đến từ người này ("auto-collected" như GoClaw - ghi cả người
 * bị allowlist chặn để thấy ai đã từng nhắn tới bot).
 */
export function recordContactActivity(accountId: string, userId: string, displayName: string): void {
  if (!userId) return; // payload thiếu uidFrom - không có gì để ghi
  upsertStmt.run(accountId, userId, displayName);
}

const listStmt = db.prepare(`
  SELECT account_id, user_id, display_name, first_seen, last_seen, message_count
  FROM contacts
  WHERE (? = '' OR account_id = ?) AND (display_name LIKE ? OR user_id LIKE ?)
  ORDER BY last_seen DESC
  LIMIT ? OFFSET ?
`);

/** accountId bỏ trống = mọi account */
export function listContacts(params: {
  accountId?: string;
  query?: string;
  limit?: number;
  offset?: number;
}): ContactRow[] {
  const acc = params.accountId ?? "";
  const like = `%${params.query ?? ""}%`;
  type Row = {
    account_id: string; user_id: string; display_name: string;
    first_seen: string; last_seen: string; message_count: number;
  };
  const rows = listStmt.all(
    acc, acc, like, like, params.limit ?? 50, params.offset ?? 0,
  ) as unknown as Row[];
  return rows.map((r) => ({
    accountId: r.account_id,
    userId: r.user_id,
    displayName: r.display_name,
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
    messageCount: r.message_count,
  }));
}

/**
 * Backfill contact từ messages cũ - chỉ dựng được cho chat riêng (thread_id
 * chính là user ID của đối phương; messages cũ không lưu sender_id nên thành
 * viên group không khôi phục được, sẽ tự tích lũy từ tin mới).
 * Chỉ chạy khi bảng còn trống. Nhận diện chat riêng qua threads.thread_type = 0
 * (ThreadType.User) hoặc -1 (backfill chưa rõ type) kết hợp thread có tin user 1 người.
 */
export function backfillContactsFromDirectMessages(): number {
  const count = (db.prepare("SELECT COUNT(*) AS n FROM contacts").get() as { n: number }).n;
  if (count > 0) return 0;

  // Thread chat riêng: mọi tin user đều cùng 1 sender_name -> coi thread_id là user_id
  const result = db
    .prepare(`
      INSERT INTO contacts (account_id, user_id, display_name, first_seen, last_seen, message_count)
      SELECT m.account_id, m.thread_id,
             COALESCE(MAX(m.sender_name), ''),
             MIN(m.created_at), MAX(m.created_at), COUNT(*)
      FROM messages m
      WHERE m.role = 'user'
      GROUP BY m.account_id, m.thread_id
      HAVING COUNT(DISTINCT m.sender_name) = 1
    `)
    .run();
  return Number(result.changes);
}
