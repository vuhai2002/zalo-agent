import { z } from "zod";

/**
 * Lịch chạy - union RỜI theo `kind`, KHÔNG dùng `z.discriminatedUnion`: 'once'
 * có 2 dạng ({date,time} và {inMinutes}) cùng chia sẻ discriminant "once", mà
 * `z.discriminatedUnion` ném "Duplicate discriminator value" ở MỌI LẦN PARSE
 * khi có 2 nhánh trùng giá trị phân biệt - đã dính đúng lỗi này ở
 * `document-content-schema.ts`'s `spreadsheetCellSchema` (làm create_excel_file
 * chết 100% trên Zalo thật trong khi test vẫn xanh). Hình dạng khớp 1-1 với
 * `ScheduleInput` của `schedule-parser.ts` để truyền thẳng, không chuyển đổi.
 */
export const scheduleInputSchema = z
  .union([
    z.object({
      kind: z.literal("once"),
      date: z.string().describe('Ngày dạng YYYY-MM-DD theo giờ Việt Nam, vd "2026-08-01"'),
      time: z.string().describe('Giờ dạng HH:mm (24h) theo giờ Việt Nam, vd "15:00"'),
    }),
    z.object({
      kind: z.literal("once"),
      // Trần 525600 (1 năm) - thiếu trần này thì `new Date(now + inMinutes *
      // 60000)` ở schedule-parser.ts ném RangeError khi vượt biên Date; tool
      // có try/catch nhưng route POST /api/schedule (dùng chung schema này)
      // thì không, lỗi lọt thành 500 thay vì 400 có lý do rõ ràng.
      inMinutes: z.number().int().positive().max(525600).describe("Số phút kể từ bây giờ, vd 30 = 30 phút nữa"),
    }),
    z.object({
      kind: z.literal("every"),
      // Cùng trần 525600 (1 năm) với `inMinutes` ở trên - cùng đường vỡ:
      // `computeNextRun`/`computeEveryNext` (next-run.ts) cộng `steps * intervalMs`
      // vào `new Date(...)`, vượt biên Date ném RangeError. Route POST /api/schedule
      // dùng chung schema này, không có try/catch quanh createJob nên lỗi lọt
      // thành 500 thay vì 400 có lý do rõ ràng.
      minutes: z.number().int().positive().max(525600).describe("Lặp lại mỗi bấy nhiêu phút"),
    }),
    z.object({
      kind: z.literal("cron"),
      expr: z
        .string()
        .min(1)
        .describe('Biểu thức cron 5 trường theo giờ Việt Nam, vd "0 7 * * *" = 7h sáng mỗi ngày'),
    }),
  ])
  .describe(
    "Đúng 1 trong 4 dạng: once theo mốc giờ tuyệt đối (date+time), once tương đối (inMinutes), " +
      "every lặp theo phút, hoặc cron theo biểu thức cron - cả 4 đều hiểu theo giờ Việt Nam.",
  );

/**
 * Nhãn hiển thị trên dashboard/action list - không phải nội dung gửi đi.
 * Export để `schedule-routes.ts` (API dashboard, phase 05) dùng lại đúng
 * ngưỡng này thay vì khai một con số thứ hai dễ lệch.
 */
export const MAX_NAME_CHARS = 100;
/**
 * Trần ký tự payload - CHÍNH SÁCH tự đặt (không phải giới hạn của Zalo), đủ
 * rộng cho nhắc hẹn dài lẫn prompt agent chi tiết. Cùng độ lớn với
 * `MAX_PROMPT_CHARS` của `create-image-tool.ts` cho nhất quán trong catalog.
 */
export const MAX_PAYLOAD_CHARS = 4000;

export const scheduleTaskInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z
      .string()
      .min(1)
      .max(MAX_NAME_CHARS)
      .describe("Nhãn ngắn để nhận ra lịch này trong action='list'"),
    kind: z
      .enum(["message", "agent"])
      .describe(
        "'message' = gửi nguyên văn payload lúc tới giờ, không tốn lượt LLM. 'agent' = chạy 1 lượt agent có tool với payload là prompt.",
      ),
    payload: z
      .string()
      .min(1)
      .max(MAX_PAYLOAD_CHARS)
      .describe(
        "Nội dung gửi (kind='message') hoặc prompt cho lượt agent (kind='agent') - phải TỰ CHỨA đủ ngữ cảnh",
      ),
    schedule: scheduleInputSchema,
  }),
  z.object({
    action: z.literal("list"),
  }),
  z.object({
    action: z.literal("cancel"),
    id: z.string().min(1).describe("id lấy từ action='list' - TUYỆT ĐỐI không tự đoán"),
  }),
  z.object({
    action: z.literal("update"),
    id: z.string().min(1).describe("id lấy từ action='list' - TUYỆT ĐỐI không tự đoán"),
    name: z.string().min(1).max(MAX_NAME_CHARS).optional().describe("Bỏ trống = giữ nguyên tên cũ"),
    payload: z.string().min(1).max(MAX_PAYLOAD_CHARS).optional().describe("Bỏ trống = giữ nguyên nội dung cũ"),
    schedule: scheduleInputSchema.optional().describe("Bỏ trống = giữ nguyên lịch cũ"),
  }),
]);

export type ScheduleTaskInput = z.infer<typeof scheduleTaskInputSchema>;
export type CreateScheduleTaskInput = Extract<ScheduleTaskInput, { action: "create" }>;
export type UpdateScheduleTaskInput = Extract<ScheduleTaskInput, { action: "update" }>;
