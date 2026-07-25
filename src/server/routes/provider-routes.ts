import { generateText } from "ai";
import { Hono } from "hono";
import { z } from "zod";
import {
  clearLlmSettings,
  getEffectiveLlmSettings,
  maskApiKey,
  updateLlmSettings,
} from "../../config/runtime-llm-settings.js";
import { createLogger } from "../../shared/logger.js";

const log = createLogger("provider-routes");

const updateSchema = z.object({
  provider: z.enum(["openai-compatible", "anthropic"]).optional(),
  baseUrl: z.string().startsWith("http").optional(),
  model: z.string().min(1).optional(),
  // Bỏ trống = giữ key cũ. Key mới đi 1 chiều lên server, lưu DB mã hóa.
  apiKey: z.string().optional(),
});

/** /api/provider - xem/sửa LLM runtime. Key KHÔNG BAO GIỜ trả về plaintext. */
export const providerRoutes = new Hono()

  .get("/", (c) => {
    const s = getEffectiveLlmSettings();
    return c.json({
      provider: s.provider,
      baseUrl: s.baseUrl ?? "",
      model: s.model,
      apiKeyMasked: maskApiKey(s.apiKey),
      hasOverride: s.hasOverride,
    });
  })

  .patch("/", async (c) => {
    const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Dữ liệu không hợp lệ", issues: parsed.error.issues }, 400);
    }

    updateLlmSettings(parsed.data);
    // Audit: ghi field nào đổi, không ghi giá trị (tránh lộ key vào log)
    log.info(
      { changedFields: Object.keys(parsed.data).filter((k) => parsed.data[k as never] !== undefined) },
      "Đổi cấu hình LLM từ dashboard",
    );

    const s = getEffectiveLlmSettings();
    return c.json({
      ok: true,
      provider: s.provider,
      baseUrl: s.baseUrl ?? "",
      model: s.model,
      apiKeyMasked: maskApiKey(s.apiKey),
      hasOverride: s.hasOverride,
    });
  })

  .delete("/", (c) => {
    clearLlmSettings();
    log.info("Xóa override LLM - quay về cấu hình env");
    const s = getEffectiveLlmSettings();
    return c.json({ ok: true, provider: s.provider, model: s.model, hasOverride: s.hasOverride });
  })

  // Gọi 1 completion tối thiểu bằng cấu hình hiệu lực - nút "Test kết nối" trên UI
  .post("/test", async (c) => {
    try {
      const { resolveLanguageModel } = await import("../../agent/llm-provider.js");
      const result = await generateText({
        model: resolveLanguageModel(),
        prompt: "Trả lời đúng 1 từ: ok",
        maxOutputTokens: 200,
        maxRetries: 0,
      });
      return c.json({ ok: true, reply: result.text.trim().slice(0, 100) });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
    }
  });
