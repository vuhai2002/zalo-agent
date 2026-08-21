import { botTimeZone, getTuning } from "../../config/runtime-tuning-settings.js";
import { parseSchedule, type ParsedSchedule } from "../../scheduler/schedule-parser.js";
import {
  createJob,
  deleteJob,
  getJob,
  listJobsForThread,
  updateJob,
  type ScheduledJob,
} from "../../scheduler/scheduled-job-store.js";
import { checkThreadJobCap } from "../../scheduler/scheduled-job-thread-cap.js";
import { getDateTimeParts } from "../../shared/current-datetime.js";
import { senderTrustFrom } from "../history-to-model-messages.js";
import { timLichHenTrung } from "./tim-lich-hen-trung.js";
import { ketQuaLoi, type KetQuaLoiTool } from "./tool-failure-result.js";
import type { ToolContext } from "./index.js";
import type { CreateScheduleTaskInput, UpdateScheduleTaskInput } from "./schedule-task-tool-schema.js";

/**
 * Logic 4 action của `schedule_task`, tách khỏi `schedule-task-tool.ts` (giữ
 * phần wiring `tool()`) để mỗi file chỉ lo một việc. PHẠM VI THREAD
 * `(accountId, threadId)` đã ràng buộc sẵn ở TẦNG STORE
 * (`scheduled-job-store.ts`) - các hàm ở đây chỉ việc gọi đúng hàm có phạm vi,
 * không tự viết lại điều kiện WHERE.
 */

/**
 * Chỉ người trong allowlist tạo được job - lớp chặn ĐẦU trong 4 lớp của mục
 * "An toàn" (thiet-ke-scheduler.md): 1 tin soạn khéo mới đủ để đẻ ra tác vụ
 * lặp lại không ai để ý. Dùng lại chính điều kiện `allowlist-filter.ts` đang
 * xác định "người này có trong danh sách không" qua `senderTrustFrom` (đã
 * export sẵn, dùng ở `agent-turn-content.ts`) - không viết lại luật allowlist
 * ở một chỗ thứ hai.
 */
function isAllowedToCreate(ctx: ToolContext): boolean {
  return !senderTrustFrom(ctx.account.allowlist).isUnverified(ctx.message.senderId);
}

/**
 * Mô tả lịch bằng lời, đọc từ `nextRunAt` ĐÃ LƯU thay vì suy lại từ input gốc:
 * đây là nguồn đáng tin nhất để đọc lại cho người dùng xác nhận, vì đã đi qua
 * đúng `computeNextRun` mà store dùng để quyết khi nào job thật sự chạy - đúng
 * dặn dò của persona "đọc lại là cách rẻ nhất để bắt lỗi hiểu sai ý".
 */
function describeSchedule(job: ScheduledJob): string {
  if (!job.nextRunAt) return "không còn lần chạy nào sắp tới";
  const p = getDateTimeParts(botTimeZone(), new Date(job.nextRunAt));
  const mocKe = `lần kế tiếp ${p.time} ngày ${p.date} (giờ Việt Nam)`;
  if (job.scheduleKind === "once") return `chạy 1 lần lúc ${p.time} ngày ${p.date} (giờ Việt Nam)`;
  if (job.scheduleKind === "every") return `lặp mỗi ${job.everyMinutes} phút, ${mocKe}`;
  return `theo lịch cron "${job.cronExpr}", ${mocKe}`;
}

export function doCreate(
  ctx: ToolContext,
  input: CreateScheduleTaskInput,
): string | KetQuaLoiTool {
  if (!isAllowedToCreate(ctx)) {
    return ketQuaLoi(
      "Chỉ người trong danh sách được phép (allowlist) mới đặt được lịch hẹn. Nói thật với người dùng là bạn không tạo được lịch này.",
    );
  }

  const parsed = parseSchedule(input.schedule, {
    timeZone: botTimeZone(),
    minIntervalMinutes: getTuning("SCHEDULER_MIN_INTERVAL_MINUTES"),
  });
  if (!parsed.ok) return ketQuaLoi(parsed.error);

  // KHỬ TRÙNG trước cả trần job/thread - cố ý. Lời gọi trùng khít KHÔNG thêm
  // job nào, nên chặn nó bằng "đã chạm trần" là báo sai chuyện: người dùng chỉ
  // muốn biết lịch đã đặt chưa, mà lại nhận câu bảo đi hủy bớt lịch cũ. Đổi
  // lại `parseSchedule` phải chạy sớm hơn một bậc - nó thuần, không tác dụng phụ.
  //
  // Vì sao cần: model KHÔNG thấy tool call của lượt trước trong lịch sử, nên
  // nó "kiểm tra lịch đã đặt chưa" bằng cách gọi create lần nữa. Xem
  // `tim-lich-hen-trung.ts` cho ca thật và số đo.
  const trung = timLichHenTrung({
    jobs: listJobsForThread(ctx.account.id, ctx.message.threadId),
    name: input.name,
    kind: input.kind,
    schedule: parsed.schedule,
  });
  if (trung.trungKhit) {
    const j = trung.trungKhit;
    // Chuỗi trần, KHÔNG `ketQuaLoi`: trạng thái người dùng muốn ĐÃ CÓ SẴN nên
    // đây là thành công, không phải hỏng. Nói rõ "không tạo thêm" để model
    // đừng báo với người dùng là vừa đặt thêm một lịch nữa.
    return (
      `Lịch này ĐÃ CÓ SẴN, không tạo thêm bản trùng: "${j.name}" (id: ${j.id}) - ${describeSchedule(j)}. ` +
      `Nói với người dùng là lịch đã được đặt từ trước và vẫn còn hiệu lực - ĐỪNG nói bạn vừa đặt thêm một lịch mới.`
    );
  }

  const cap = checkThreadJobCap(ctx.account.id, ctx.message.threadId);
  if (!cap.ok) {
    return ketQuaLoi(
      `${cap.reason} Gọi action='list' rồi hủy bớt lịch cũ (action='cancel') trước khi đặt lịch mới.`,
    );
  }

  const job = createJob({
    accountId: ctx.account.id,
    threadId: ctx.message.threadId,
    threadType: ctx.message.threadType,
    name: input.name,
    kind: input.kind,
    payload: input.payload,
    schedule: parsed.schedule,
    createdBy: ctx.message.senderId,
  });

  // Cùng lịch chạy mà KHÁC tên thì vẫn tạo - một người hoàn toàn có thể hẹn
  // hai việc khác nhau vào cùng một giờ. Chỉ NÓI RA cho model biết: đây là
  // lưới đỡ cho lúc phép so theo tên trượt (model đặt tên lệch một chữ), và
  // cũng là thông tin người dùng đáng được nghe.
  const nhacCungLich =
    trung.cungLich.length > 0
      ? ` LƯU Ý: cuộc trò chuyện này đã có ${trung.cungLich.length} lịch khác chạy cùng nhịp/mốc giờ đó` +
        ` (${trung.cungLich.map((j) => `"${j.name}"`).join(", ")}) - nói cho người dùng biết để họ tự quyết có trùng ý không.`
      : "";

  return `Đã tạo lịch "${job.name}" (id: ${job.id}) - ${describeSchedule(job)}. Đọc lại mốc giờ này cho người dùng nghe để họ xác nhận đúng ý.${nhacCungLich}`;
}

export function doList(ctx: ToolContext): string {
  const jobs = listJobsForThread(ctx.account.id, ctx.message.threadId);
  if (jobs.length === 0) return "Cuộc trò chuyện này chưa có lịch hẹn nào.";

  return jobs
    .map(
      (j) => `- id: ${j.id} | "${j.name}" | ${j.kind} | ${j.enabled ? "đang bật" : "đã tắt"} | ${describeSchedule(j)}`,
    )
    .join("\n");
}

export function doCancel(ctx: ToolContext, id: string): string | KetQuaLoiTool {
  const job = getJob(ctx.account.id, ctx.message.threadId, id);
  if (!job) {
    return ketQuaLoi(
      `Không tìm thấy lịch hẹn id "${id}" trong cuộc trò chuyện này. Gọi action='list' để lấy đúng id trước khi hủy.`,
    );
  }
  deleteJob(ctx.account.id, ctx.message.threadId, id);
  return `Đã hủy lịch "${job.name}" (id: ${job.id}).`;
}

export function doUpdate(
  ctx: ToolContext,
  input: UpdateScheduleTaskInput,
): string | KetQuaLoiTool {
  const existing = getJob(ctx.account.id, ctx.message.threadId, input.id);
  if (!existing) {
    return ketQuaLoi(
      `Không tìm thấy lịch hẹn id "${input.id}" trong cuộc trò chuyện này. Gọi action='list' để lấy đúng id trước khi sửa.`,
    );
  }

  let schedule: ParsedSchedule | undefined;
  if (input.schedule) {
    const parsed = parseSchedule(input.schedule, {
      timeZone: botTimeZone(),
      minIntervalMinutes: getTuning("SCHEDULER_MIN_INTERVAL_MINUTES"),
    });
    if (!parsed.ok) return ketQuaLoi(parsed.error);
    schedule = parsed.schedule;
  }

  updateJob(ctx.account.id, ctx.message.threadId, input.id, {
    name: input.name,
    payload: input.payload,
    schedule,
  });

  const updated = getJob(ctx.account.id, ctx.message.threadId, input.id)!;
  return `Đã cập nhật lịch "${updated.name}" (id: ${updated.id}) - ${describeSchedule(updated)}. Đọc lại mốc giờ này cho người dùng nghe để họ xác nhận đúng ý.`;
}
