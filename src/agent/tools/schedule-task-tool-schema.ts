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

/**
 * HỢP ĐỒNG THẬT của tool - union nghiêm theo `action`. Không còn là thứ gửi ra
 * nhà cung cấp (xem `scheduleTaskWireSchema` bên dưới), mà là thứ `execute`
 * parse lại để thu hẹp kiểu. Mọi kiểu suy ra từ đây vẫn giữ nguyên, nên
 * `schedule-task-actions.ts` không phải biết chuyện này.
 */
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

/**
 * Hình dạng ĐI RA NHÀ CUNG CẤP. Phẳng: `action` là enum, mọi trường còn lại
 * `.optional()` vì trường nào bắt buộc là tùy theo `action`.
 *
 * Vì sao không gửi thẳng `scheduleTaskInputSchema`: union ở nút GỐC dịch ra
 * `{"$schema":..., "oneOf":[...]}` - không có khóa `type`. DeepSeek kiểm
 * `parameters.type` phải bằng `"object"` và chối CẢ REQUEST:
 *
 *   400 Invalid schema for function 'schedule_task':
 *       schema must be a JSON Schema of 'type: "object"', got 'type: null'.
 *
 * Vì bộ tool đi kèm MỌI lượt nên hậu quả là bot CÂM HOÀN TOÀN với DeepSeek, chứ
 * không riêng lượt nào đụng lịch hẹn (log thật: `steps: 0`).
 *
 * Đo trên api.deepseek.com thật (deepseek-v4-flash, 07/08/2026): đủ 13 tool như
 * cũ -> 400; chỉ mình tool này -> 400; đổi mình tool này sang hình dạng phẳng ->
 * 200, kể cả khi gửi kèm 12 tool còn lại. Đi vòng qua 9router KHÔNG cứu được:
 * đường openai-compatible sang openai-compatible chuyển tiếp `parameters`
 * nguyên xi, chỉ 3 đường gemini/antigravity/responses mới có bước chuẩn hóa.
 *
 * Ràng buộc chỉ áp cho nút GỐC: union LỒNG bên trong một object thì mọi nhà
 * cung cấp đều nhận - `schedule` ngay dưới đây, `documentBlockSchema`,
 * `spreadsheetCellSchema` đều vậy và đều qua trong cùng phép đo.
 *
 * Ràng buộc chéo ("create phải có đủ name/kind/payload/schedule") không mất, nó
 * CHUYỂN CHỖ sang `execute`. Cố ý KHÔNG dùng `.superRefine` ở đây: schema mà từ
 * chối thì AI SDK dựng lỗi đầu vào TRƯỚC khi `execute` chạy, tức mất luôn đường
 * trả `ketQuaLoi` cho model đọc rồi tự gọi lại trong cùng lượt.
 *
 * Mô tả từng trường phải tự gánh phần thông tin mà `required` không còn nói hộ.
 * Đo 4 dạng yêu cầu x 2 lần trên DeepSeek: 8/8 lần model điền đủ trường và qua
 * được union nghiêm; ca "hủy lịch X" model còn tự gọi `list` trước để lấy id.
 */
export const scheduleTaskWireSchema = z.object({
  action: z
    .enum(["create", "list", "cancel", "update"])
    .describe(
      "create = đặt lịch mới (cần name, kind, payload, schedule). list = xem lịch đang có, không cần tham số nào khác. " +
        "cancel = hủy (cần id). update = sửa (cần id, kèm trường muốn đổi).",
    ),
  id: z
    .string()
    .min(1)
    .optional()
    .describe("BẮT BUỘC với cancel/update. Lấy từ action='list' - TUYỆT ĐỐI không tự đoán."),
  name: z
    .string()
    .min(1)
    .max(MAX_NAME_CHARS)
    .optional()
    .describe("BẮT BUỘC với create. Nhãn ngắn để nhận ra lịch này trong action='list'. Với update: bỏ trống = giữ tên cũ."),
  kind: z
    .enum(["message", "agent"])
    .optional()
    .describe(
      "BẮT BUỘC với create. 'message' = gửi nguyên văn payload lúc tới giờ, không tốn lượt LLM. " +
        "'agent' = chạy 1 lượt agent có tool với payload là prompt. Không đổi được sau khi tạo.",
    ),
  payload: z
    .string()
    .min(1)
    .max(MAX_PAYLOAD_CHARS)
    .optional()
    .describe(
      "BẮT BUỘC với create. Nội dung gửi (kind='message') hoặc prompt cho lượt agent (kind='agent') - " +
        "phải TỰ CHỨA đủ ngữ cảnh. Với update: bỏ trống = giữ nội dung cũ.",
    ),
  // Nhắc lại nguyên câu mô tả 4 dạng: `.describe()` ở đây ĐÈ mô tả gốc của
  // `scheduleInputSchema` trong JSON Schema xuất ra, viết cụt là model mất phần
  // duy nhất nói cho nó biết có 4 hình dạng nào
  schedule: scheduleInputSchema
    .optional()
    .describe(
      "BẮT BUỘC với create. Với update: bỏ trống = giữ lịch cũ. Đúng 1 trong 4 dạng: once theo mốc giờ " +
        "tuyệt đối (date+time), once tương đối (inMinutes), every lặp theo phút, hoặc cron theo biểu thức " +
        "cron - cả 4 đều hiểu theo giờ Việt Nam.",
    ),
});

export type ScheduleTaskWireInput = z.infer<typeof scheduleTaskWireSchema>;
export type ScheduleTaskInput = z.infer<typeof scheduleTaskInputSchema>;
export type CreateScheduleTaskInput = Extract<ScheduleTaskInput, { action: "create" }>;
export type UpdateScheduleTaskInput = Extract<ScheduleTaskInput, { action: "update" }>;
