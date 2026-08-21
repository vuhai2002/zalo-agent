/**
 * Đường gửi của MỘT job lịch hẹn, theo ĐÚNG kênh của account.
 *
 * Vì sao là một nhà máy riêng chứ không để mỗi chỗ tự dựng: có BA chỗ cần
 * `ReplyTarget` cho job (đường gửi chính `run-scheduled-job.ts`, thông báo
 * chạm trần ngày `scheduled-job-cap-guard.ts`, và bất cứ đường nào thêm sau
 * này). Ba chỗ tự viết là ba cơ hội quên một trường - đúng lý lẽ đã ghi trong
 * docstring của `duongGuiZcaJs`.
 *
 * Bản trước cả ba chỗ đều gọi `getRunningAccountApi` rồi dựng `duongGuiZcaJs`
 * bằng tay, tức khóa cứng scheduler vào kênh cá nhân. Đó là nguyên nhân THẬT
 * khiến lịch hẹn không chạy trên kênh bot - không phải Bot API thiếu năng lực
 * gửi chủ động (đo thật: 10 tin trong 416ms, không bị chặn). Chỗ thứ hai
 * (`cap-guard`) hỏng CÂM: bot chạm trần ngày thì không ai được báo.
 */

import type { ThreadType } from "zca-js";
import { getRunningAccountKenh } from "../zalo/account-manager.js";
import type { KenhLuot } from "../zalo/kenh-luot.js";
import { replyTargetTuKenh } from "../zalo/reply-target-tu-kenh.js";
import type { ReplyTarget } from "../zalo/send-reply-in-parts.js";
import type { ScheduledJob } from "./scheduled-job-store.js";

export type DichGuiJob = {
  target: ReplyTarget;
  /**
   * Kênh của lượt - `runAgentJob` cần `kenh.api` cho `ToolContext`.
   *
   * Trả kèm ở ĐÂY thay vì để caller gọi `getRunningAccountKenh` lần thứ hai:
   * hai lời gọi là hai cơ hội đọc trúng hai trạng thái khác nhau nếu account
   * bị dừng xen giữa (lượt agent chạy hàng phút), và khi đó target trỏ tới
   * kênh cũ còn `api` lấy từ kênh mới.
   */
  kenh: KenhLuot;
};

/**
 * `undefined` khi account KHÔNG CHẠY (chưa login, đang tắt, đã dừng). Caller
 * xử lý đúng như trước: `concludeBlockedNotRun` - giữ nguyên suất chạy, phục
 * hồi `next_run_at`, thử lại tick sau.
 *
 * Hàm này KHÔNG BAO GIỜ ném: `scheduled-job-cap-guard.ts` gọi nó từ đường
 * chạy KHÔNG-AWAIT của vòng tick. Chỉ đọc một Map trong bộ nhớ và dựng object.
 */
export function taoDichGuiChoJob(job: ScheduledJob): DichGuiJob | undefined {
  const kenh = getRunningAccountKenh(job.accountId);
  if (!kenh) return undefined;

  // Đi qua `replyTargetTuKenh` chứ không tự dựng: các trường mang theo đều là
  // TÙY CHỌN, nên quên một cái là trình biên dịch im lặng còn hậu quả thì câm.
  // KHÔNG có `quote` - job theo lịch không trả lời tin nào cả (luật đã ghi sẵn
  // trong docstring `ReplyTarget.quote`), và nhà máy kia cũng không đặt.
  return {
    kenh,
    target: replyTargetTuKenh({
      kenh,
      threadId: job.threadId,
      threadType: job.threadType as ThreadType,
      threadKey: `${job.accountId}:${job.threadId}`,
    }),
  };
}
