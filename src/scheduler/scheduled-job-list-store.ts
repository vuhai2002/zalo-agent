/**
 * Đọc job cho DASHBOARD - liệt kê THEO ACCOUNT (mọi thread), khác
 * `listJobsForThread` (scheduled-job-store.ts) vốn luôn cần cả accountId lẫn
 * threadId vì đó là phạm vi của TOOL (một cuộc hội thoại chỉ thấy job của
 * chính cuộc hội thoại đó). Dashboard là màn quản trị duy nhất (1 mật khẩu,
 * không có khái niệm "mỗi thread một chủ khác nhau") nên cần xem GỘP mọi
 * thread của 1 account, hoặc mọi account (accountId rỗng) - đúng pattern
 * `listThreads` của `thread-store.ts` đang dùng cho trang Sessions.
 *
 * Không đặt vào `scheduled-job-store.ts` (giữ nguyên, tách riêng ở phase
 * khác) nên tách file riêng, dùng lại `mapRow` đã export sẵn ở
 * `scheduled-job-record.ts`.
 */

import { db } from "../conversation/database.js";
import { mapRow, type ScheduledJob, type ScheduledJobRow } from "./scheduled-job-record.js";

const listByAccountStmt = db.prepare(
  `SELECT * FROM scheduled_jobs WHERE account_id = ? ORDER BY created_at DESC`,
);
const listAllStmt = db.prepare(`SELECT * FROM scheduled_jobs ORDER BY created_at DESC`);

/** accountId rỗng = mọi account (dashboard mặc định xem trộn, đúng pattern listThreads) */
export function listJobsForAccount(accountId: string): ScheduledJob[] {
  const rows = (accountId ? listByAccountStmt.all(accountId) : listAllStmt.all()) as unknown as ScheduledJobRow[];
  return rows.map(mapRow);
}
