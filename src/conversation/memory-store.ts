import { db } from "./database.js";
import { getTuning } from "../config/runtime-tuning-settings.js";

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

const trungStmt = db.prepare(`
  SELECT id FROM memories WHERE account_id = ? AND subject_id = ? AND content = ? LIMIT 1
`);

export type KetQuaGhiNho =
  | { ghi: true }
  /** Đã có sẵn một fact y hệt - không ghi bản thứ hai */
  | { ghi: false; lyDo: "trung" };

/**
 * So khớp TRÙNG KHÍT (sau khi cắt khoảng trắng hai đầu), không chuẩn hóa gì
 * thêm. Học Hermes (`memory_tool.py`: `if content in entries` -> "Entry already
 * exists"). Cố ý không bỏ dấu hay hạ chữ thường để so: hai câu chỉ khác dấu
 * trong tiếng Việt thường là hai câu khác nghĩa, mà chặn nhầm ở đây nghĩa là
 * người dùng dặn một điều mới và bot im lặng không nhớ.
 */
export function saveMemoryFact(params: {
  accountId: string;
  subjectId: string;
  content: string;
  learnedInThreadId: string;
  learnedInGroup: boolean;
}): KetQuaGhiNho {
  const noiDung = params.content.trim();
  if (trungStmt.get(params.accountId, params.subjectId, noiDung)) {
    return { ghi: false, lyDo: "trung" };
  }

  insertStmt.run(
    params.accountId,
    params.subjectId,
    noiDung,
    params.learnedInThreadId,
    params.learnedInGroup ? 1 : 0,
  );
  capStmt.run(
    params.accountId,
    params.subjectId,
    params.accountId,
    params.subjectId,
    getTuning("MEMORY_MAX_FACTS_PER_SUBJECT"),
  );
  return { ghi: true };
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

// ===== Cho dashboard: xem + xóa fact =====
//
// Trước đây ghi "xóa là quyền của user, bot không tự xóa". Đã đổi: bot sửa và
// xóa được qua `memory-edit-store.ts`, nhưng CHỈ trong tập fact nó đang nhìn
// thấy. Lý do đổi là bằng chứng mới chứ không phải đổi ý: không có đường sửa
// thì một lời đính chính của người dùng ("mình chuyển ra Hà Nội rồi") chỉ đẻ
// thêm fact mới nằm cạnh fact cũ, để lại hai điều mâu thuẫn - tệ hơn hẳn so
// với không nhớ gì. Đường xóa của dashboard vẫn giữ, không phụ thuộc vào bot.

const listStmt = db.prepare(`
  SELECT id, account_id, subject_id, content, learned_in_thread_id, learned_in_group, created_at
  FROM memories WHERE (? = '' OR account_id = ?) AND (subject_id LIKE ? OR content LIKE ?)
  ORDER BY id DESC LIMIT ? OFFSET ?
`);

/** accountId bỏ trống = mọi account */
export function listMemories(params: {
  accountId?: string;
  query?: string;
  limit?: number;
  offset?: number;
}): MemoryFact[] {
  type Row = {
    id: number; account_id: string; subject_id: string; content: string;
    learned_in_thread_id: string; learned_in_group: number; created_at: string;
  };
  const acc = params.accountId ?? "";
  const like = `%${params.query ?? ""}%`;
  const rows = listStmt.all(
    acc, acc, like, like, params.limit ?? 50, params.offset ?? 0,
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
