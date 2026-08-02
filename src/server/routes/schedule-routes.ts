import { Hono } from "hono";
import { z } from "zod";
import { MAX_NAME_CHARS, MAX_PAYLOAD_CHARS, scheduleInputSchema } from "../../agent/tools/schedule-task-tool-schema.js";
import { getAccount } from "../../config/account-store.js";
import { botTimeZone, getTuning } from "../../config/runtime-tuning-settings.js";
import { findThreadStatus } from "../../conversation/thread-store.js";
import { hasRunningRun, listRuns } from "../../scheduler/job-run-log-store.js";
import { runScheduledJobTrial } from "../../scheduler/run-scheduled-job-trial.js";
import { parseSchedule, type ParsedSchedule } from "../../scheduler/schedule-parser.js";
import { listJobsForAccount } from "../../scheduler/scheduled-job-list-store.js";
import { createJob, deleteJob, getJob, setEnabled, updateJob } from "../../scheduler/scheduled-job-store.js";
import { checkThreadJobCap } from "../../scheduler/scheduled-job-thread-cap.js";
import { createLogger } from "../../shared/logger.js";

const log = createLogger("schedule-routes");

/**
 * /api/schedule - trang Lịch hẹn (dashboard): xem/tạo/sửa/xóa/chạy thử job
 * lịch hẹn mà không cần qua chat. Route ghi đi qua ĐÚNG store
 * `scheduled-job-store.ts` mà tool `schedule_task` dùng nên dính CÙNG ràng
 * buộc (trần job/thread, ngưỡng lịch dày) - không có luật riêng cho "job tạo
 * từ web".
 *
 * accountId/threadId của job ĐÃ TỒN TẠI luôn lấy từ CHÍNH request (query cho
 * đọc, body cho ghi) rồi đưa thẳng vào hàm CÓ PHẠM VI của store - KHÔNG BAO
 * GIỜ tra ngược từ id qua `getJobUnscoped` (đường nội bộ dành riêng cho vòng
 * tick). Dùng nó với id đến từ HTTP là mở lại đúng lỗ IDOR đã vá ở tầng store
 * (phase 02): mọi hàm get/update/delete/setEnabled ở đó đều bắt buộc khớp CẢ
 * (accountId, threadId) mới thấy job, sai một trong hai coi như không tồn tại
 * - đúng nếp `PATCH /api/threads/:threadId` đã làm (accountId trong body,
 * threadId trong URL). Vì patch/update không hề nhận field accountId/threadId
 * để GHI, job không thể bị đổi đích gửi qua route này dù client gửi gì.
 */

const createSchema = z.object({
  accountId: z.string().min(1),
  threadId: z.string().min(1),
  threadType: z.number().int(),
  name: z.string().min(1).max(MAX_NAME_CHARS),
  kind: z.enum(["message", "agent"]),
  payload: z.string().min(1).max(MAX_PAYLOAD_CHARS),
  schedule: scheduleInputSchema,
});

const patchSchema = z.object({
  accountId: z.string().min(1),
  threadId: z.string().min(1),
  name: z.string().min(1).max(MAX_NAME_CHARS).optional(),
  payload: z.string().min(1).max(MAX_PAYLOAD_CHARS).optional(),
  schedule: scheduleInputSchema.optional(),
  enabled: z.boolean().optional(),
});

/** Tham số parseSchedule dùng chung cho create/update - đúng cấu hình tool đang dùng */
function scheduleParseParams() {
  return { timeZone: botTimeZone(), minIntervalMinutes: getTuning("SCHEDULER_MIN_INTERVAL_MINUTES") };
}

export const scheduleRoutes = new Hono()

  .get("/", (c) => {
    const accountId = c.req.query("accountId") ?? "";
    return c.json({ items: listJobsForAccount(accountId), timezone: botTimeZone() });
  })

  .post("/", async (c) => {
    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Dữ liệu không hợp lệ", issues: parsed.error.issues }, 400);
    const input = parsed.data;

    if (!getAccount(input.accountId)) return c.json({ error: "Account không tồn tại" }, 400);
    if (!findThreadStatus(input.accountId, input.threadId)) {
      return c.json({ error: "Cuộc trò chuyện chưa từng ghi nhận trong hệ thống - không tạo lịch được." }, 400);
    }

    const cap = checkThreadJobCap(input.accountId, input.threadId);
    if (!cap.ok) return c.json({ error: cap.reason }, 400);

    const result = parseSchedule(input.schedule, scheduleParseParams());
    if (!result.ok) return c.json({ error: result.error }, 400);

    const job = createJob({
      accountId: input.accountId,
      threadId: input.threadId,
      threadType: input.threadType,
      name: input.name,
      kind: input.kind,
      payload: input.payload,
      schedule: result.schedule,
      createdBy: "dashboard",
    });
    log.info({ jobId: job.id, accountId: job.accountId }, "Tạo lịch hẹn từ dashboard");
    return c.json({ job, timezone: botTimeZone() }, 201);
  })

  .patch("/:id", async (c) => {
    const id = c.req.param("id");
    const parsed = patchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Dữ liệu không hợp lệ", issues: parsed.error.issues }, 400);
    const { accountId, threadId, enabled, schedule: scheduleInput, name, payload } = parsed.data;

    const job = getJob(accountId, threadId, id);
    if (!job) return c.json({ error: "Không tìm thấy lịch hẹn" }, 404);

    // Bật LẠI job đang tắt phải qua đúng trần như lúc tạo mới - thiếu bước này:
    // tạo đủ 20 job, tắt 10, tạo thêm 10, bật lại hết = 30 job đang bật, vượt
    // trần (route tạo job có kiểm, route bật/tắt trước đây thì không).
    if (enabled === true && !job.enabled) {
      const cap = checkThreadJobCap(accountId, threadId);
      if (!cap.ok) return c.json({ error: cap.reason }, 400);
    }

    let schedule: ParsedSchedule | undefined;
    if (scheduleInput) {
      const result = parseSchedule(scheduleInput, scheduleParseParams());
      if (!result.ok) return c.json({ error: result.error }, 400);
      schedule = result.schedule;
    }

    if (name !== undefined || payload !== undefined || schedule !== undefined) {
      updateJob(accountId, threadId, id, { name, payload, schedule });
    }
    if (enabled !== undefined) setEnabled(accountId, threadId, id, enabled);

    return c.json({ job: getJob(accountId, threadId, id)!, timezone: botTimeZone() });
  })

  .delete("/:id", (c) => {
    const id = c.req.param("id");
    const accountId = c.req.query("accountId") ?? "";
    const threadId = c.req.query("threadId") ?? "";
    if (!accountId || !threadId) return c.json({ error: "Thiếu accountId/threadId" }, 400);

    if (!deleteJob(accountId, threadId, id)) return c.json({ error: "Không tìm thấy lịch hẹn" }, 404);
    return c.json({ ok: true });
  })

  // "Chạy thử ngay" - gửi THẬT, qua ĐÚNG guard/trần ngày, nhưng không đổi
  // lịch thật (next_run_at, run_count, enabled...) - xem run-scheduled-job-trial.ts
  .post("/:id/run", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => null)) as { accountId?: string; threadId?: string } | null;
    const accountId = body?.accountId ?? "";
    const threadId = body?.threadId ?? "";
    if (!accountId || !threadId) return c.json({ error: "Thiếu accountId/threadId" }, 400);

    const job = getJob(accountId, threadId, id);
    if (!job) return c.json({ error: "Không tìm thấy lịch hẹn" }, 404);

    // Chặn TỪ TRƯỚC khi trial kịp snapshot/giành job: nếu job này còn 1 lượt
    // 'running' (tick THẬT đang dispatch dở, hoặc 1 lần "Chạy thử" khác đang
    // chạy), claim của trial không đóng được cửa sổ với lượt ĐÃ bắt đầu trước
    // đó - xem doc đầu file run-scheduled-job-trial.ts.
    if (hasRunningRun(id)) {
      return c.json({ error: "Lịch hẹn đang chạy, thử lại sau ít phút." }, 409);
    }

    const run = await runScheduledJobTrial(job);
    log.info({ jobId: id, status: run?.status }, "Chạy thử lịch hẹn từ dashboard");
    return c.json({ run: run ?? null });
  })

  .get("/:id/runs", (c) => {
    const id = c.req.param("id");
    const accountId = c.req.query("accountId") ?? "";
    const threadId = c.req.query("threadId") ?? "";
    if (!accountId || !threadId) return c.json({ error: "Thiếu accountId/threadId" }, 400);
    if (!getJob(accountId, threadId, id)) return c.json({ error: "Không tìm thấy lịch hẹn" }, 404);

    // `Number("abc")` ra NaN, `Math.min/max` với NaN vẫn ra NaN rồi bind param
    // SQLite ném lỗi - dùng `|| MAC_DINH` (đúng pattern trace-routes.ts) để
    // giá trị hỏng/rỗng rơi thẳng về mặc định thay vì trôi xuống NaN.
    const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 50));
    return c.json({ runs: listRuns(id, limit) });
  });
