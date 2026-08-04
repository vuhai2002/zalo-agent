/**
 * "Chạy thử ngay" (dashboard, phase 05) - chạy 1 lượt job qua ĐÚNG đường ống
 * `runScheduledJob` (guard/gửi/trace y hệt lượt thật do vòng tick kích hoạt),
 * nhưng KHÔNG được làm lệch LỊCH THẬT của job.
 *
 * Không thể chỉ né `next_run_at`: `markRun()` (scheduled-job-store.ts) cộng
 * `run_count` RỒI so với `max_runs` - job 'once' luôn có `max_runs = 1` (bất
 * biến ở `createJob`), nên MỘT lượt CHẠY THỬ dùng hết đúng suất DUY NHẤT của
 * lịch, tự tắt job (`enabled = 0`, `next_run_at = NULL`) TRƯỚC KHI lịch thật
 * kịp chạy - đúng thứ brief cấm ("chạy thử không được làm lệch lịch thật"),
 * chỉ là nặng hơn câu chữ literal (không chỉ next_run_at đổi, job còn bị tắt
 * hẳn). Cùng lý do, `delivery_attempts` (đếm gửi hỏng liên tiếp, xem
 * `delivery-attempt-store.ts`) cũng bị lượt thử động vào - trộn với chuỗi gửi
 * hỏng THẬT sẽ làm job chạm trần `MAX_DELIVERY_ATTEMPTS` sớm hơn đáng lẽ.
 *
 * BẢN ĐẦU chỉ snapshot/restore mà KHÔNG giành job trước - có race thật (vòng
 * review 2): job `kind='agent'` gọi LLM dễ chạy lâu hơn `SCHEDULER_TICK_MS`
 * (mặc định 30s). Nếu job đang QUÁ HẠN lúc bấm "Chạy thử ngay", `next_run_at`
 * trong DB vẫn đứng nguyên ở mốc quá hạn suốt lúc trial chạy (trial không
 * clear-before-dispatch như tick) - một tick THẬT xen vào giữa vẫn thấy job
 * "due", dispatch THẬT một lần nữa (clear next_run_at + markRun thật). Trial
 * xong, `restoreStmt` ghi đè VÔ ĐIỀU KIỆN về snapshot cũ, xoá mất next_run_at
 * MỚI mà tick thật vừa tính - tick kế tiếp nhặt lại mốc cũ (đã quá hạn) và
 * GỬI TRÙNG tin thật cho người dùng cuối. Cùng cơ chế, PATCH tắt job/đổi lịch
 * ở tab khác trong lúc trial chạy cũng bị đè mất.
 *
 * Sửa: GIÀNH job trước khi dispatch, đúng bài clear-before-dispatch của
 * `scheduler-loop.ts` - đặt `next_run_at = NULL` NGAY trước khi gọi
 * `runScheduledJob`. `listDueJobs()` lọc `next_run_at IS NOT NULL` nên claim
 * này đóng HOÀN TOÀN cửa sổ đụng độ với TICK TƯƠNG LAI: trong suốt lúc trial
 * chạy, không tick nào SAU ĐÓ còn thấy job "due" để dispatch thêm lần nữa.
 *
 * NHƯNG claim KHÔNG đóng được cửa sổ với lượt ĐÃ dispatch TRƯỚC lúc bấm thử
 * (phát hiện ở vòng review toàn nhánh, sau khi đoạn trên từng viết nhầm là
 * "đóng hoàn toàn"): job đang QUÁ HẠN + `kind='agent'` chạy lâu hơn
 * `SCHEDULER_TICK_MS` là ca thật - tick thật đã dispatch, đang chạy dở (row
 * `scheduled_job_runs` còn `status='running'`), rồi user mới bấm thử. Snapshot
 * của trial chụp TRÚNG lúc lượt thật còn dở, claim/restore của trial không hề
 * biết tới lượt đó. Ba kết cục xấu tuỳ thời điểm 2 lượt hoàn tất trước/sau
 * nhau: (1) job 'once' bị `markRun` 2 lần - nhắn trùng RỒI kẹt xác sống
 * (`restoreStmt` ghi đè `run_count`/`enabled` của lượt thật về giá trị snapshot
 * cũ); (2) kết quả `last_status`/`last_error` của lượt THẬT biến mất khỏi row
 * job vì bị restore ghi đè sau; (3) 2 tab cùng bấm thử trúng đúng lúc nhau làm
 * job chết im lặng (`next_run_at` cuối cùng là NULL của tab restore sau).
 *
 * Vá THÊM (không thay claim, mà đứng TRƯỚC claim): route
 * `POST /api/schedule/:id/run` (`schedule-routes.ts`) từ chối với 409 ngay khi
 * `scheduled_job_runs` còn dòng `status='running'` của đúng job - chặn được cả
 * 2 nguồn "lượt đang chạy dở": tick thật đang dispatch, VÀ một lần "Chạy thử"
 * khác đang chạy (2 tab). Vẫn còn 1 khe TOCTOU cực hẹp giữa lúc route kiểm
 * xong và lúc `claimStmt` chạy (một câu SQL) - không phải "đóng tuyệt đối",
 * nhưng đủ hẹp để loại ca thật đã nêu (lượt agent dài phút, không phải mili-giây).
 *
 * Không chọn "chặn trial khi job đang due": vẫn hở với job SẮP due trong lúc
 * trial chạy, và chặn đúng lúc người dùng cần thử nhất (job hỏng, đang quá
 * hạn, badge đỏ). Không chọn "luồn cờ dry-run xuyên `runScheduledJob`/
 * `conclude`/`sendAndConclude`": 3 file đó của task 3 vừa qua nhiều vòng
 * review mới ổn định, thêm nhánh vào đó rủi ro hơn lợi.
 *
 * Cột `restoreStmt` ghi lại CHỈ gồm cột `runScheduledJob` (qua markRun/
 * setNextRun/incrementDeliveryAttempts/resetDeliveryAttempts) thực sự có thể
 * đổi: `run_count`, `next_run_at`, `last_run_at`, `last_status`, `last_error`,
 * `delivery_attempts`, và `enabled` (CHỈ đổi trong nhánh hitMax của markRun).
 * KHÔNG đụng cột PATCH sở hữu (`name`, `payload`, cột lịch, `max_runs`) - route
 * PATCH không hề nằm trong danh sách phục hồi này. Khe hẹp còn lại: `enabled`
 * cũng là cột `PATCH .../schedule/:id` ghi qua `setEnabled` - nếu người dùng
 * bật/tắt job ở tab khác ĐÚNG lúc trial đang chạy (cửa sổ vài trăm ms tới vài
 * giây), restore có thể ghi đè lại đúng lúc đó. Chấp nhận được (tần suất cực
 * hiếm, tự sửa đúng ở lần bật/tắt kế tiếp) nhưng không giả vờ là đã đóng kín.
 *
 * Không đặt hàm này vào `scheduled-job-store.ts` (giữ nguyên, tách riêng ở
 * phase khác) nên phải tự viết SQL chụp/giành/phục hồi ở đây - không có hàm
 * nào của store cho phép ghi đè run_count, các cột last_..., hay
 * delivery_attempts về một giá trị tuỳ ý.
 */

import { db } from "../conversation/database.js";
import { listRuns, type JobRun } from "./job-run-log-store.js";
import { runScheduledJob } from "./run-scheduled-job.js";
import type { ScheduledJob } from "./scheduled-job-store.js";

type BookkeepingRow = {
  run_count: number;
  enabled: number;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  delivery_attempts: number;
};

const snapshotStmt = db.prepare(`
  SELECT run_count, enabled, next_run_at, last_run_at, last_status, last_error, delivery_attempts
  FROM scheduled_jobs WHERE id = ?
`);

/** Giành job TRƯỚC dispatch - clear-before-dispatch của riêng trial, đóng cửa sổ đụng độ với tick thật tương lai */
const claimStmt = db.prepare(`UPDATE scheduled_jobs SET next_run_at = NULL WHERE id = ?`);

const restoreStmt = db.prepare(`
  UPDATE scheduled_jobs
  SET run_count = ?, enabled = ?, next_run_at = ?, last_run_at = ?, last_status = ?, last_error = ?,
      delivery_attempts = ?
  WHERE id = ?
`);

/**
 * Chạy thử 1 job NGAY - gửi thật, tính vào trần ngày, để lại run log thật,
 * nhưng KHÔNG đổi bất kỳ cột "lịch thật" nào trên `scheduled_jobs`. Trả về
 * dòng lịch sử vừa ghi (nếu có) để route trả kết quả cho web.
 */
export async function runScheduledJobTrial(job: ScheduledJob): Promise<JobRun | undefined> {
  const before = snapshotStmt.get(job.id) as BookkeepingRow | undefined;
  // Job đã bị xoá ngay trước lúc snapshot (cực hiếm) - không có gì để giành
  // hay phục hồi, cứ chạy thẳng qua runScheduledJob (nó tự no-op an toàn khi
  // job không còn trong DB) rồi trả về run log rỗng.
  if (!before) {
    // Chạy thử TAY từ dashboard: mốc là giờ THẬT lúc bấm nút, đúng nghĩa
    // "chạy ngay bây giờ". Chốt MỘT lần rồi truyền vào để mọi sổ sách trần
    // trong lượt này dùng chung.
    await runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt ?? new Date().toISOString(), now: new Date() });
    return listRuns(job.id, 1)[0];
  }

  claimStmt.run(job.id);
  try {
    await runScheduledJob(job, {
      late: false,
      scheduledFor: job.nextRunAt ?? new Date().toISOString(),
      now: new Date(),
    });
  } finally {
    // finally, không phải sau await: runScheduledJob cam kết không bao giờ
    // ném lỗi ra ngoài (đã tự try/catch nội bộ), nhưng lỡ có bất ngờ thì job
    // vẫn phải được TRẢ LẠI, không kẹt vĩnh viễn ở next_run_at=NULL.
    restoreStmt.run(
      before.run_count,
      before.enabled,
      before.next_run_at,
      before.last_run_at,
      before.last_status,
      before.last_error,
      before.delivery_attempts,
      job.id,
    );
  }

  return listRuns(job.id, 1)[0];
}
