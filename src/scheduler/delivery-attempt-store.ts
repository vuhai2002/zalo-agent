/**
 * Đếm số lần THỬ GỬI THẤT BẠI LIÊN TIẾP của 1 job - cột bền `delivery_attempts`
 * trên chính `scheduled_jobs` (không phải bảng riêng: đây là trạng thái GẮN
 * VỚI job, không phải lịch sử). Bền qua restart để khớp bất biến "một lời
 * nhắc chưa từng gửi được thì không bao giờ được coi là đã chạy" nhưng vẫn có
 * ĐIỂM DỪNG - thiếu cột này thì gửi hỏng liên tục (mạng chết dài) sẽ lặp lại
 * mãi mãi, đúng vòng lặp đốt LLM đã sửa ở phần trần ngày (scheduled-job-cap-guard.ts).
 *
 * KHÔNG đặt hàm này vào `scheduled-job-store.ts` (giữ nguyên, tách riêng ở
 * phase khác) - đây là hàm MỚI của task này nên có file riêng, đúng quy ước.
 */

import { db } from "../conversation/database.js";

/** Thử tối đa 3 lần trước khi tiêu suất chạy + ghi 'error' thật cho dashboard thấy */
export const MAX_DELIVERY_ATTEMPTS = 3;

const incrementStmt = db.prepare(`UPDATE scheduled_jobs SET delivery_attempts = delivery_attempts + 1 WHERE id = ?`);
const resetStmt = db.prepare(`UPDATE scheduled_jobs SET delivery_attempts = 0 WHERE id = ?`);
const getStmt = db.prepare(`SELECT delivery_attempts FROM scheduled_jobs WHERE id = ?`);

/** Tăng bộ đếm rồi trả về giá trị MỚI - gọi mỗi lần 1 lượt CHƯA gửi được GÌ */
export function incrementDeliveryAttempts(jobId: string): number {
  incrementStmt.run(jobId);
  const row = getStmt.get(jobId) as { delivery_attempts: number } | undefined;
  return row?.delivery_attempts ?? 0;
}

/** Đưa về 0 - gọi khi job vừa gửi được (dù chỉ 1 phần) hoặc vừa tiêu suất chạy vì chạm đủ MAX_DELIVERY_ATTEMPTS lần */
export function resetDeliveryAttempts(jobId: string): void {
  resetStmt.run(jobId);
}
