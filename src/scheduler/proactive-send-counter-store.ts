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

const tryReserveStmt = db.prepare(`
  INSERT INTO proactive_send_counters (account_id, thread_id, day_key, count)
  VALUES (?, ?, ?, 1)
  ON CONFLICT (account_id, thread_id, day_key) DO UPDATE SET
    count = count + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE count < ?
`);

/**
 * Giành ĐÚNG 1 suất một cách NGUYÊN TỬ - 1 câu UPDATE có điều kiện (`count <
 * max`), không phải đọc-rồi-ghi 2 bước. Chặn đúng race giữa 2 job CÙNG thread
 * cùng đến hạn: tách 2 bước thì cả 2 có thể cùng đọc `count` cũ trước khi bên
 * kia kịp ghi, nhưng SQLite tự khoá đúng 1 câu UPDATE này nên chỉ 1 trong 2
 * giành được suất cuối cùng.
 *
 * Hàng CHƯA TỪNG có (job đầu tiên trong ngày của thread này) luôn giành được
 * an toàn dù `max` là bao nhiêu: nhánh INSERT chèn thẳng `count=1` (không qua
 * WHERE - WHERE chỉ áp cho nhánh UPDATE của upsert), và `max >= 1` luôn đúng
 * (ràng buộc Zod của `SCHEDULER_MAX_PROACTIVE_PER_DAY`).
 *
 * Trả `true` nếu giành được (đã CỘNG 1 vào count), `false` nếu đã đủ trần
 * (KHÔNG đụng gì). Gọi `addProactiveSendCount` sau đó để cộng nốt phần CÒN
 * LẠI khi biết `sentParts` thật > 1, hoặc `refundProactiveSlot` nếu cuối cùng
 * không gửi được gì.
 */
export function tryReserveProactiveSlot(accountId: string, threadId: string, dayKey: string, max: number): boolean {
  return tryReserveStmt.run(accountId, threadId, dayKey, max).changes > 0;
}

const refundStmt = db.prepare(`
  UPDATE proactive_send_counters SET count = MAX(0, count - 1), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE account_id = ? AND thread_id = ? AND day_key = ?
`);

/** Hoàn lại ĐÚNG 1 suất đã `tryReserveProactiveSlot` giành nhưng cuối cùng không gửi được gì. Kẹp sàn 0 - không bao giờ âm. */
export function refundProactiveSlot(accountId: string, threadId: string, dayKey: string): void {
  refundStmt.run(accountId, threadId, dayKey);
}

const tryReserveNoticeStmt = db.prepare(`
  INSERT INTO proactive_send_counters (account_id, thread_id, day_key, notice_sent)
  VALUES (?, ?, ?, 1)
  ON CONFLICT (account_id, thread_id, day_key) DO UPDATE SET
    notice_sent = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE notice_sent = 0
`);

/**
 * Giành QUYỀN gửi thông báo chạm trần một cách NGUYÊN TỬ - 1 câu UPDATE có
 * điều kiện (`notice_sent = 0`), không phải đọc-rồi-ghi 2 bước. Chặn đúng
 * race giữa N job CÙNG thread cùng bị chặn trong CÙNG 1 tick: mỗi job đọc
 * `noticeSent=false` TRƯỚC khi job khác kịp gửi xong (đường gửi phải chờ
 * `SCHEDULER_SEND_GAP_MS`, thường 20s) sẽ tưởng mình là lần đầu chạm trần - N
 * job thành N tin thông báo giống hệt nhau, cách nhau 20 giây, đúng lúc bot
 * đang cố nói "mình sẽ im đi".
 *
 * Trả `true` nếu giành được (đã ghi `notice_sent=1` NGAY, TRƯỚC khi gửi thật),
 * `false` nếu đã có ai giành trước (hoặc đã gửi thật từ trước). Gửi hỏng thì
 * gọi `revertCapNotice` để trả quyền lại cho job/tick sau.
 */
export function tryReserveCapNotice(accountId: string, threadId: string, dayKey: string): boolean {
  return tryReserveNoticeStmt.run(accountId, threadId, dayKey).changes > 0;
}

const revertNoticeStmt = db.prepare(`
  UPDATE proactive_send_counters SET notice_sent = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE account_id = ? AND thread_id = ? AND day_key = ?
`);

/** Trả lại quyền gửi thông báo chạm trần đã giành ở `tryReserveCapNotice` nhưng cuối cùng gửi hỏng - job/tick sau còn cơ hội thử lại */
export function revertCapNotice(accountId: string, threadId: string, dayKey: string): void {
  revertNoticeStmt.run(accountId, threadId, dayKey);
}

/** Chỉ dùng cho test - xoá sạch bảng để mỗi ca test bắt đầu từ 0 */
export function resetAllProactiveCounters(): void {
  db.exec("DELETE FROM proactive_send_counters");
}
