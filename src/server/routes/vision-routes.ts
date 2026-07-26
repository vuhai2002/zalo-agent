import { Hono } from "hono";
import { z } from "zod";
import {
  clearSidecarSettings,
  getVisionSettingsForApi,
  updateVisionSettings,
} from "../../config/runtime-vision-settings.js";
import { createLogger } from "../../shared/logger.js";

const log = createLogger("vision-routes");

const updateSchema = z.object({
  mode: z.enum(["auto", "on", "off"]).optional(),
  // Chuỗi rỗng tường minh = xóa (quay về env)
  sidecarBaseUrl: z.union([z.string().startsWith("http"), z.literal("")]).optional(),
  sidecarModel: z.string().optional(),
  // Bỏ trống (undefined) = giữ key; chuỗi rỗng = xóa key
  sidecarApiKey: z.string().optional(),
});

/** Trạng thái phát hiện vision của model chính (cấu hình chung, không tính override agent) */
async function detectionState() {
  const { resolveImageContextMode } = await import("../../agent/agent-turn-content.js");
  const imageMode = await resolveImageContextMode();
  return { imageMode };
}

/** /api/vision - cấu hình đọc ảnh. Key sidecar KHÔNG BAO GIỜ trả về plaintext. */
export const visionRoutes = new Hono()

  .get("/", async (c) => {
    return c.json({ ...getVisionSettingsForApi(), ...(await detectionState()) });
  })

  .patch("/", async (c) => {
    const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Dữ liệu không hợp lệ", issues: parsed.error.issues }, 400);
    }

    updateVisionSettings(parsed.data);
    // Đổi cấu hình phải thấy hiệu lực ngay, không đợi cache /models hết hạn
    const { clearVisionDetectionCache } = await import("../../agent/model-vision-detection.js");
    clearVisionDetectionCache();

    // Audit: ghi field nào đổi, không ghi giá trị (tránh lộ key vào log)
    log.info(
      { changedFields: Object.keys(parsed.data).filter((k) => parsed.data[k as never] !== undefined) },
      "Đổi cấu hình vision từ dashboard",
    );
    return c.json({ ok: true, ...getVisionSettingsForApi(), ...(await detectionState()) });
  })

  // Xóa sạch cấu hình sidecar KỂ CẢ key: đường PATCH quy ước "key trống = giữ
  // key cũ" nên không gỡ được key qua PATCH, phải có hành động riêng
  .delete("/sidecar", async (c) => {
    clearSidecarSettings();
    const { clearVisionDetectionCache } = await import("../../agent/model-vision-detection.js");
    clearVisionDetectionCache();
    log.info("Xóa cấu hình vision sidecar từ dashboard");
    return c.json({ ok: true, ...getVisionSettingsForApi(), ...(await detectionState()) });
  })

  // Gọi sidecar với ảnh test 1x1 - chứng minh đường đọc ảnh chạy thật, không chỉ auth
  .post("/test", async (c) => {
    try {
      const { testSidecar } = await import("../../agent/vision-sidecar.js");
      const reply = await testSidecar();
      return c.json({ ok: true, reply: reply.trim().slice(0, 200) });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
    }
  });
