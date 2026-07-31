/**
 * Trần `SCHEDULER_MAX_JOBS_PER_THREAD` job ĐANG BẬT mỗi thread - lớp chặn
 * spam job (mục 7 "An toàn", `thiet-ke-scheduler.md`). Dùng CHUNG cho cả 2
 * đường tạo job: tool `schedule_task` (`schedule-task-actions.ts`) và route
 * dashboard (`schedule-routes.ts`) - trước đây mỗi nơi tự chép lại đoạn đếm +
 * so sánh này, 2 bản chép sớm muộn lệch nhau, mà lệch ở đây nghĩa là một
 * trong hai đường tạo job NÉ ĐƯỢC trần (vòng review 2, mục Minor).
 *
 * Không đặt vào `scheduled-job-store.ts` (giữ nguyên, tách riêng ở phase
 * khác) nên để file riêng, chỉ gọi lại `listJobsForThread` đã export sẵn.
 *
 * Chỉ trả LÝ DO GỐC, không kèm hướng dẫn tiếp theo - mỗi caller có ngữ cảnh
 * khác nhau để nói "làm gì tiếp" (tool gợi ý action='list'/'cancel', dashboard
 * không có khái niệm đó).
 */

import { getTuning } from "../config/runtime-tuning-settings.js";
import { listJobsForThread } from "./scheduled-job-store.js";

export type ThreadJobCapResult = { ok: true } | { ok: false; reason: string };

export function checkThreadJobCap(accountId: string, threadId: string): ThreadJobCapResult {
  const maxJobs = getTuning("SCHEDULER_MAX_JOBS_PER_THREAD");
  const activeCount = listJobsForThread(accountId, threadId).filter((j) => j.enabled).length;
  if (activeCount < maxJobs) return { ok: true };
  return { ok: false, reason: `Cuộc trò chuyện này đã có đủ ${maxJobs} lịch hẹn đang bật - đã chạm trần.` };
}
