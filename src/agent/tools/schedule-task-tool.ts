import { tool } from "ai";
import type { z } from "zod";
import { createLogger } from "../../shared/logger.js";
import { doCancel, doCreate, doList, doUpdate } from "./schedule-task-actions.js";
import { SCHEDULE_TASK_DESCRIPTION } from "./schedule-task-tool-description.js";
import {
  scheduleTaskInputSchema,
  scheduleTaskWireSchema,
  type ScheduleTaskWireInput,
} from "./schedule-task-tool-schema.js";
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

/**
 * Nhắc lại yêu cầu của từng action bằng lời, để câu báo thiếu tham số ĐỦ cho
 * model gọi lại đúng ngay lần sau thay vì phải đoán. Danh sách trường sai lấy
 * từ chính `issues` của zod, phần này chỉ bổ nghĩa.
 */
const YEU_CAU_THEO_ACTION: Record<ScheduleTaskWireInput["action"], string> = {
  create: "action='create' cần đủ: name, kind ('message' hoặc 'agent'), payload, schedule.",
  list: "action='list' không nhận tham số nào khác.",
  cancel: "action='cancel' cần id - gọi action='list' để lấy id, đừng tự đoán.",
  update: "action='update' cần id, kèm ít nhất một trong name/payload/schedule.",
};

/**
 * Ghép câu báo thiếu tham số. Nêu ĐÍCH DANH trường hỏng: câu chung chung kiểu
 * "tham số không hợp lệ" bắt model thử mò, mà mỗi lần mò là một lượt gọi tool.
 */
function cauThieuThamSo(action: ScheduleTaskWireInput["action"], loi: z.ZodError): string {
  const truong = [...new Set(loi.issues.map((i) => i.path.join(".")).filter(Boolean))];
  const ke = truong.length > 0 ? `Thiếu hoặc sai tham số: ${truong.join(", ")}. ` : "Tham số không hợp lệ. ";
  return `${ke}${YEU_CAU_THEO_ACTION[action]} Gọi lại tool với đủ tham số, đừng báo với người dùng là đã xong.`;
}

export function createScheduleTaskTool(ctx: ToolContext) {
  return tool({
    description: SCHEDULE_TASK_DESCRIPTION,
    // Hình dạng PHẲNG đi ra nhà cung cấp (lý do đầy đủ ở
    // `schedule-task-tool-schema.ts`) - union ở nút gốc làm DeepSeek chối cả
    // request nên bot câm với mọi tin nhắn, không riêng lượt đụng lịch hẹn
    inputSchema: scheduleTaskWireSchema,
    execute: async (wire) => {
      try {
        // Ràng buộc chéo theo action được ép ở ĐÂY chứ không phải ở schema:
        // schema từ chối thì AI SDK dựng lỗi đầu vào trước khi tới được dòng
        // này, model không đọc được câu nào để tự sửa trong cùng lượt
        const daThuHep = scheduleTaskInputSchema.safeParse(wire);
        if (!daThuHep.success) {
          log.warn({ action: wire.action, issues: daThuHep.error.issues }, "schedule_task thiếu tham số");
          return ketQuaLoi(cauThieuThamSo(wire.action, daThuHep.error));
        }
        const input = daThuHep.data;

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
        // `wire.action` chứ không phải `input.action`: `input` chỉ tồn tại
        // trong try, mà nhánh catch này còn phải bắt cả lỗi ném ra TRƯỚC lúc
        // thu hẹp kiểu
        log.error({ err, action: wire.action }, "Tool schedule_task lỗi");
        return ketQuaLoi(
          `Thao tác lịch hẹn thất bại (${reason}). Nói thật với người dùng, đừng coi như đã làm xong.`,
        );
      }
    },
  });
}
