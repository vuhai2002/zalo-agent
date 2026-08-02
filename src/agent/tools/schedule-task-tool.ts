import { tool } from "ai";
import { createLogger } from "../../shared/logger.js";
import { doCancel, doCreate, doList, doUpdate } from "./schedule-task-actions.js";
import { SCHEDULE_TASK_DESCRIPTION } from "./schedule-task-tool-description.js";
import { scheduleTaskInputSchema } from "./schedule-task-tool-schema.js";
import { ketQuaLoi } from "./tool-failure-result.js";
import type { ToolContext } from "./index.js";

/**
 * Tool cho model tự đặt/xem/sửa/hủy lịch nhắc hoặc lịch chạy agent qua hội
 * thoại (mục 7, `thiet-ke-scheduler.md`). Logic từng action nằm ở
 * `schedule-task-actions.ts`, schema Zod ở `schedule-task-tool-schema.ts` -
 * tách ra để file này chỉ còn phần wiring `tool()`, không lẫn "làm như thế
 * nào" vào "tool này là gì".
 *
 * PHẠM VI THREAD nằm ở TẦNG STORE (`scheduled-job-store.ts`), không phải ở
 * đây: mọi hàm get/update/delete của store đã tự ràng buộc
 * `(accountId, threadId)` trong SQL WHERE, nên dù logic action ở đây có lỡ
 * quên kiểm gì thì store vẫn chặn được IDOR.
 *
 * `runsInScheduledTurn: false` (khai ở `tool-catalog-action.ts`) - luật số 1
 * của Hermes: job không được đẻ job.
 */
const log = createLogger("schedule-task");

export function createScheduleTaskTool(ctx: ToolContext) {
  return tool({
    description: SCHEDULE_TASK_DESCRIPTION,
    inputSchema: scheduleTaskInputSchema,
    execute: async (input) => {
      try {
        switch (input.action) {
          case "create":
            return doCreate(ctx, input);
          case "list":
            return doList(ctx);
          case "cancel":
            return doCancel(ctx, input.id);
          case "update":
            return doUpdate(ctx, input);
        }
      } catch (err) {
        // Trả thông báo cho model diễn giải, không throw ra agent loop - cùng
        // luật với web_search/read_image (lỗi hạ tầng không được giết cả lượt)
        const reason = err instanceof Error ? err.message : String(err);
        log.error({ err, action: input.action }, "Tool schedule_task lỗi");
        return ketQuaLoi(
          `Thao tác lịch hẹn thất bại (${reason}). Nói thật với người dùng, đừng coi như đã làm xong.`,
        );
      }
    },
  });
}
