/**
 * CRUD bảng `proactive_send_counters` - đếm tin CHỦ ĐỘNG đã gửi mỗi (account,
 * thread, ngày VN), bền qua restart. Tách khỏi `proactive-send-guard.ts` theo
 * đúng nếp "một store một bảng" của dự án (`scheduled-job-store.ts`,
 * `job-run-log-store.ts`).
 *
 * KHÔNG đếm từ `scheduled_job_runs`: bảng đó bị prune xuống
 * `SCHEDULER_RUN_LOG_KEEP` dòng MỖI JOB ngay mỗi lần mở lượt (`openRun`), nên
 * 1 job dày (vd `every 5 phút` = 288 lượt/ngày) làm dòng `ok` buổi sáng bị xoá
 * trong vài giờ - đếm lại tụt về 0 giữa ngày, còn tệ hơn bộ đếm trong bộ nhớ.
 */

import { db } from "../conversation/database.js";

export type ProactiveCounter = { count: number; noticeSent: boolean };

const getStmt = db.prepare(
  `SELECT count, notice_sent FROM proactive_send_counters WHERE account_id = ? AND thread_id = ? AND day_key = ?`,
);

export function getProactiveCounter(accountId: string, threadId: string, dayKey: string): ProactiveCounter {
  const row = getStmt.get(accountId, threadId, dayKey) as { count: number; notice_sent: number } | undefined;
  return row ? { count: row.count, noticeSent: row.notice_sent === 1 } : { count: 0, noticeSent: false };
}

const addStmt = db.prepare(`
  INSERT INTO proactive_send_counters (account_id, thread_id, day_key, count)
  VALUES (?, ?, ?, ?)
  ON CONFLICT (account_id, thread_id, day_key) DO UPDATE SET
    count = count + excluded.count, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
`);

const pruneStmt = db.prepare(`DELETE FROM proactive_send_counters WHERE day_key < ?`);

/**
 * Cộng thêm `amount` TIN (không phải "lượt") vào bộ đếm của ngày - tạo dòng
 * nếu chưa có. `amount` phải là số tin THẬT SỰ đã gửi (`reply.sentParts`) -
 * `sendReplyInParts` có thể cắt 1 câu trả lời dài thành nhiều tin.
 *
 * Dọn cùng nhịp ghi (giống prune-on-write của `history-store.ts`): xoá dòng
 * cũ hơn `keepSinceDayKey` để bảng không phình - trần chỉ cần biết ĐÚNG HÔM
 * NAY nên không cần giữ lịch sử xa.
 */
export function addProactiveSendCount(
  accountId: string,
  threadId: string,
  dayKey: string,
  amount: number,
  keepSinceDayKey?: string,
): void {
  if (amount <= 0) return;
  addStmt.run(accountId, threadId, dayKey, amount);
  if (keepSinceDayKey) pruneStmt.run(keepSinceDayKey);
}

const markNoticeStmt = db.prepare(`
  INSERT INTO proactive_send_counters (account_id, thread_id, day_key, notice_sent)
  VALUES (?, ?, ?, 1)
  ON CONFLICT (account_id, thread_id, day_key) DO UPDATE SET notice_sent = 1
`);

/** Đánh dấu ĐÃ báo trần cho đúng 1 lần/ngày/thread - chỉ gọi SAU KHI thông báo thật sự gửi được */
export function markProactiveCapNoticeSent(accountId: string, threadId: string, dayKey: string): void {
  markNoticeStmt.run(accountId, threadId, dayKey);
}

/** Chỉ dùng cho test - xoá sạch bảng để mỗi ca test bắt đầu từ 0 */
export function resetAllProactiveCounters(): void {
  db.exec("DELETE FROM proactive_send_counters");
}
