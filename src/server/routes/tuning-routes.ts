import { Hono } from "hono";
import { z } from "zod";
import {
  listTuning,
  setTuning,
  validateTuning,
  type TuningValue,
} from "../../config/runtime-tuning-settings.js";
import { TUNING_DEFS, TUNING_GROUPS, type TuningKey } from "../../config/tuning-definitions.js";
import { isValidTimezone } from "../../shared/current-datetime.js";
import { createLogger } from "../../shared/logger.js";

const log = createLogger("tuning-routes");

/**
 * /api/tuning - các tham số vốn chỉ sửa được trong `.env`.
 *
 * Trả cả ĐỊNH NGHĨA (nhãn, gợi ý, khoảng cho phép) lẫn giá trị, để giao diện
 * không phải chép lại danh mục. Thêm tham số mới ở `tuning-definitions.ts` là
 * tự hiện trên web, không cần đụng file này.
 */
export const tuningRoutes = new Hono()

  .get("/", (c) =>
    c.json({
      groups: TUNING_GROUPS,
      defs: TUNING_DEFS,
      values: listTuning(),
    }),
  )

  .put("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = z
      .object({ values: z.record(z.string(), z.union([z.number(), z.boolean(), z.string(), z.null()])) })
      .safeParse(body);
    if (!parsed.success) return c.json({ error: "Dữ liệu không hợp lệ" }, 400);

    const { values } = parsed.data;

    // Chặn key lạ: `setTuning` ghi thẳng vào runtime_settings nên key bịa sẽ
    // thành rác vĩnh viễn trong bảng
    const la = Object.keys(values).filter((k) => !(k in TUNING_DEFS));
    if (la.length > 0) return c.json({ error: `Không có tham số: ${la.join(", ")}` }, 400);

    // Kiểm khoảng cho phép của TỪNG tham số trước, rồi mới kiểm ràng buộc chéo
    const loi: string[] = [];
    for (const [key, value] of Object.entries(values)) {
      if (value === null) continue;
      const def = TUNING_DEFS[key]!;
      if (def.kind === "number") {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          loi.push(`${def.label}: phải là số`);
        } else if (value < def.min || value > def.max) {
          loi.push(`${def.label}: phải trong khoảng ${def.min} - ${def.max}`);
        }
      } else if (def.kind === "boolean" && typeof value !== "boolean") {
        loi.push(`${def.label}: phải là true hoặc false`);
      } else if (def.kind === "enum" && !def.options.includes(String(value))) {
        loi.push(`${def.label}: chỉ nhận ${def.options.join(", ")}`);
      } else if (def.kind === "timezone" && !isValidTimezone(String(value))) {
        // Zone hỏng lọt vào DB thì luxon rơi về UTC ÂM THẦM - lịch hẹn lệch 7
        // tiếng mà không có lỗi nào chỉ ra nguyên nhân. Chặn ngay tại cửa.
        loi.push(`${def.label}: "${String(value)}" không phải tên timezone IANA hợp lệ (vd Asia/Ho_Chi_Minh)`);
      }
    }
    if (loi.length > 0) return c.json({ error: loi.join("\n") }, 400);

    // Ràng buộc GIỮA các tham số: người dùng có thể chỉ sửa một ô, nên phải
    // kiểm trên bộ giá trị đã gộp chứ không chỉ phần vừa gửi lên
    const gop = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v !== null),
    ) as Record<string, TuningValue>;
    const loiCheo = validateTuning(gop);
    if (loiCheo.length > 0) return c.json({ error: loiCheo.join("\n") }, 400);

    for (const [key, value] of Object.entries(values)) {
      setTuning(key as TuningKey, value);
    }
    log.info({ keys: Object.keys(values) }, "Đã đổi cấu hình từ dashboard");
    return c.json({ values: listTuning() });
  });
