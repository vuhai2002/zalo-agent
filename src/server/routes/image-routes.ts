import { Hono } from "hono";
import { z } from "zod";
import {
  clearImageSettings,
  getImageSettingsForApi,
  updateImageSettings,
} from "../../config/runtime-image-settings.js";
import { createLogger } from "../../shared/logger.js";

const log = createLogger("image-routes");

const updateSchema = z.object({
  // Chuỗi rỗng tường minh = xóa (quay về env)
  baseUrl: z.union([z.string().startsWith("http"), z.literal("")]).optional(),
  model: z.string().optional(),
  // Bỏ trống (undefined) = giữ key; chuỗi rỗng = xóa key
  apiKey: z.string().optional(),
});

/** /api/image-gen - cấu hình tool vẽ ảnh. Key KHÔNG BAO GIỜ trả về plaintext. */
export const imageRoutes = new Hono()

  .get("/", (c) => c.json(getImageSettingsForApi()))

  .patch("/", async (c) => {
    const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Dữ liệu không hợp lệ", issues: parsed.error.issues }, 400);
    }

    updateImageSettings(parsed.data);
    // Audit: ghi field nào đổi, không ghi giá trị (tránh lộ key vào log)
    log.info(
      { changedFields: Object.keys(parsed.data).filter((k) => parsed.data[k as never] !== undefined) },
      "Đổi cấu hình vẽ ảnh từ dashboard",
    );
    return c.json({ ok: true, ...getImageSettingsForApi() });
  })

  // Xóa sạch KỂ CẢ key: đường PATCH quy ước "key trống = giữ key cũ" nên không
  // gỡ được key qua PATCH, phải có hành động riêng
  .delete("/", (c) => {
    clearImageSettings();
    log.info("Xóa cấu hình vẽ ảnh từ dashboard");
    return c.json({ ok: true, ...getImageSettingsForApi() });
  })

  // Vẽ thật một ảnh nhỏ. Khác nút test của sidecar (chỉ tốn 1 ảnh 1x1), lần
  // này TỐN TIỀN và mất ~1 phút - nhưng đây là cách duy nhất chứng minh tên
  // model đúng: /v1/models của router không liệt kê model vẽ ảnh nên không có
  // gì để đối chiếu ngoài việc gọi thử.
  .post("/test", async (c) => {
    try {
      const { generateImage } = await import("../../images/image-generation-client.js");
      const image = await generateImage({ prompt: "A simple red circle on a white background" });
      return c.json({ ok: true, kb: Math.round(image.data.length / 1024), ext: image.ext });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
    }
  });
