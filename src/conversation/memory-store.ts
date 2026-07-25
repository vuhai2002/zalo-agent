import { env } from "../config/env.js";
import { db } from "./database.js";

export type MemoryFact = {
  id: number;
  accountId: string;
  subjectId: string;
  content: string;
  learnedInThreadId: string;
  learnedInGroup: boolean;
  createdAt: string;
};

const insertStmt = db.prepare(`
  INSERT INTO memories (account_id, subject_id, content, learned_in_thread_id, learned_in_group)
  VALUES (?, ?, ?, ?, ?)
`);

// Giữ N fact mới nhất mỗi subject - cùng pattern prune của history-store
const capStmt = db.prepare(`
  DELETE FROM memories
  WHERE account_id = ? AND subject_id = ?
    AND id <= (SELECT id FROM memories
               WHERE account_id = ? AND subject_id = ?
               ORDER BY id DESC LIMIT 1 OFFSET ?)
`);

export function saveMemoryFact(params: {
  accountId: string;
  subjectId: string;
  content: string;
  learnedInThreadId: string;
  learnedInGroup: boolean;
}): void {
  insertStmt.run(
    params.accountId,
    params.subjectId,
    params.content,
    params.learnedInThreadId,
    params.learnedInGroup ? 1 : 0,
  );
  capStmt.run(
    params.accountId,
    params.subjectId,
    params.accountId,
    params.subjectId,
    env.MEMORY_MAX_FACTS_PER_SUBJECT,
  );
}

// Quy tắc inject BẤT ĐỐI XỨNG (user đã chốt): private không bao giờ chảy ra public.
// - Chat riêng với A: mọi fact về A (kể cả học trong group - chuyện nói trước nhóm
//   không còn là bí mật) + fact về chính thread DM.
// - Group X, A đang nói: fact về group X + fact về A NHƯNG CHỈ fact học trong group.
//   Fact học ở DM tuyệt đối không xuất hiện trong prompt ở group.
const directStmt = db.prepare(`
  SELECT id, subject_id, content, created_at FROM memories
  WHERE account_id = ? AND (subject_id = ? OR subject_id = ?)
  ORDER BY id
`);
const groupStmt = db.prepare(`
  SELECT id, subject_id, content, created_at FROM memories
  WHERE account_id = ?
    AND (subject_id = ? OR (subject_id = ? AND learned_in_group = 1))
  ORDER BY id
`);

export type MemoryContext = { subjectId: string; content: string }[];

export function getMemoriesForContext(params: {
  accountId: string;
  threadId: string;
  senderId: string;
  isGroup: boolean;
}): MemoryContext {
  type Row = { id: number; subject_id: string; content: string; created_at: string };
  const rows = (
    params.isGroup
      ? groupStmt.all(params.accountId, params.threadId, params.senderId)
      : directStmt.all(params.accountId, params.senderId, params.threadId)
  ) as unknown as Row[];

  // DM: senderId và threadId trùng nhau -> dedupe theo id
  const seen = new Set<number>();
  return rows
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .map((r) => ({ subjectId: r.subject_id, content: r.content }));
}

// ===== Cho dashboard: xem + xóa fact (xóa là quyền của user, bot không tự xóa) =====

const listStmt = db.prepare(`
  SELECT id, account_id, subject_id, content, learned_in_thread_id, learned_in_group, created_at
  FROM memories WHERE account_id = ? AND (subject_id LIKE ? OR content LIKE ?)
  ORDER BY id DESC LIMIT ? OFFSET ?
`);

export function listMemories(params: {
  accountId: string;
  query?: string;
  limit?: number;
  offset?: number;
}): MemoryFact[] {
  type Row = {
    id: number; account_id: string; subject_id: string; content: string;
    learned_in_thread_id: string; learned_in_group: number; created_at: string;
  };
  const like = `%${params.query ?? ""}%`;
  const rows = listStmt.all(
    params.accountId, like, like, params.limit ?? 50, params.offset ?? 0,
  ) as unknown as Row[];
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    subjectId: r.subject_id,
    content: r.content,
    learnedInThreadId: r.learned_in_thread_id,
    learnedInGroup: r.learned_in_group === 1,
    createdAt: r.created_at,
  }));
}

const deleteStmt = db.prepare("DELETE FROM memories WHERE account_id = ? AND id = ?");

export function deleteMemoryFact(accountId: string, id: number): boolean {
  return deleteStmt.run(accountId, id).changes > 0;
}
