import { db } from "./database.js";

/**
 * Đọc/xóa ghi chú nguyên văn cho DASHBOARD - tách khỏi `verbatim-note-store.ts`
 * vì hai bên khác hẳn phạm vi: tool chỉ được đụng ghi chú của NGƯỜI ĐANG NHẮN
 * (đúng luật bất đối xứng), còn dashboard là người vận hành xem mọi người.
 *
 * Kèm tên hiển thị từ `contacts`: ghi chú gắn theo user ID, mà người vận hành
 * cần biết "ghi chú của ai" chứ không phải dãy số.
 */

export type GhiChuDashboard = {
  id: number;
  accountId: string;
  subjectId: string;
  /** Tên hiển thị trong danh bạ; rỗng khi chưa có */
  tenNguoi: string;
  title: string;
  content: string;
  learnedInGroup: boolean;
  createdAt: string;
  updatedAt: string;
};

const listStmt = db.prepare(`
  SELECT n.id, n.account_id, n.subject_id, COALESCE(c.display_name, '') AS ten_nguoi,
         n.title, n.content, n.learned_in_group, n.created_at, n.updated_at
  FROM verbatim_notes n
  LEFT JOIN contacts c ON c.account_id = n.account_id AND c.user_id = n.subject_id
  WHERE (? = '' OR n.account_id = ?)
    AND (n.title LIKE ? OR n.content LIKE ? OR n.subject_id LIKE ? OR c.display_name LIKE ?)
  ORDER BY n.updated_at DESC, n.id DESC
  LIMIT ? OFFSET ?
`);

/** accountId bỏ trống = mọi account */
export function listGhiChuDashboard(params: {
  accountId?: string;
  query?: string;
  limit: number;
  offset: number;
}): GhiChuDashboard[] {
  type Row = {
    id: number; account_id: string; subject_id: string; ten_nguoi: string; title: string;
    content: string; learned_in_group: number; created_at: string; updated_at: string;
  };
  const acc = params.accountId ?? "";
  const like = `%${params.query ?? ""}%`;
  const rows = listStmt.all(acc, acc, like, like, like, like, params.limit, params.offset) as unknown as Row[];
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    subjectId: r.subject_id,
    tenNguoi: r.ten_nguoi,
    title: r.title,
    content: r.content,
    learnedInGroup: r.learned_in_group === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

const deleteStmt = db.prepare("DELETE FROM verbatim_notes WHERE account_id = ? AND id = ?");

export function xoaGhiChuDashboard(accountId: string, id: number): boolean {
  return deleteStmt.run(accountId, id).changes > 0;
}
