import { streamText } from "ai";
import { chayStream } from "../../agent/stream-text-result.js";
import { Hono } from "hono";
import { z } from "zod";
import { LLM_PROVIDER_KINDS } from "../../config/llm-provider-kind.js";
import {
  clearLlmSettings,
  getEffectiveLlmSettings,
  maskApiKey,
  updateLlmSettings,
} from "../../config/runtime-llm-settings.js";
import { createLogger } from "../../shared/logger.js";

const log = createLogger("provider-routes");

/**
 * Ô rỗng từ form nghĩa là "chưa nhập", KHÔNG phải "giá trị rỗng hợp lệ".
 *
 * Trang Providers gửi cả form mỗi lần lưu, nên ô chưa điền đi lên dưới dạng
 * chuỗi rỗng. `.min(1)` thẳng thì cả request bị 400 và người dùng mất luôn thứ
 * họ VỪA gõ ở ô khác. Trạng thái đó là mặc định của lần cài đầu kể từ khi
 * `LLM_MODEL` hết bắt buộc trong `.env`: vào dashboard, dán base URL + API key,
 * chưa biết tên model nên để trống, bấm Lưu -> mất cả API key vừa dán.
 */
const oRong = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const updateSchema = z.object({
  provider: z.enum(LLM_PROVIDER_KINDS).optional(),
  // `null` = XÓA base URL đang lưu (dashboard gửi khi đổi sang nhà cung cấp gọi
  // thẳng hãng). Khác hẳn bỏ trống, vốn nghĩa là giữ nguyên - xem
  // `LlmSettingsUpdate.baseUrl`. `oRong` vẫn biến chuỗi rỗng thành undefined để
  // ô để trống không vô tình xóa mất cấu hình.
  baseUrl: z.preprocess(oRong, z.string().startsWith("http", "phải bắt đầu bằng http").nullish()),
  model: z.preprocess(oRong, z.string().min(1).optional()),
  // Bỏ trống = giữ key cũ. Key mới đi 1 chiều lên server, lưu DB mã hóa.
  apiKey: z.string().optional(),
});

/** Câu lỗi CHỈ ĐÚNG Ô, không phải "Dữ liệu không hợp lệ" trống trơn */
function cauLoiTruong(issues: { path: PropertyKey[]; message: string }[]): string {
  const nhan: Record<string, string> = {
    provider: "Nhà cung cấp",
    baseUrl: "Base URL",
    model: "Model",
    apiKey: "API key",
  };
  const phan = issues.map((i) => `${nhan[String(i.path[0])] ?? String(i.path[0])}: ${i.message}`);
  return phan.length > 0 ? phan.join("; ") : "Dữ liệu không hợp lệ";
}

/** /api/provider - xem/sửa LLM runtime. Key KHÔNG BAO GIỜ trả về plaintext. */
export const providerRoutes = new Hono()

  .get("/", (c) => {
    const s = getEffectiveLlmSettings();
    return c.json({
      provider: s.provider,
      baseUrl: s.baseUrl ?? "",
      model: s.model,
      // Phân biệt "chưa nhập bao giờ" với "đã nhập nhưng giải mã hỏng": hai
      // bên đều không có khóa dùng được, nhưng cách sửa khác hẳn nhau
      apiKeyMasked: s.apiKeyHong ? "lỗi giải mã - nhập lại" : maskApiKey(s.apiKey),
      hasOverride: s.hasOverride,
    });
  })

  .patch("/", async (c) => {
    const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: cauLoiTruong(parsed.error.issues), issues: parsed.error.issues }, 400);
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
      // Phân biệt "chưa nhập bao giờ" với "đã nhập nhưng giải mã hỏng": hai
      // bên đều không có khóa dùng được, nhưng cách sửa khác hẳn nhau
      apiKeyMasked: s.apiKeyHong ? "lỗi giải mã - nhập lại" : maskApiKey(s.apiKey),
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
      // Streaming để nút này đi ĐÚNG đường vận chuyển mà bot dùng. Test một
      // đằng bot chạy một nẻo thì nút báo xanh trong khi bot đang chết vì 524,
      // hoặc ngược lại - đúng lúc người ta bấm nó để tìm nguyên nhân.
      const result = await chayStream((onError) =>
        streamText({
          model: resolveLanguageModel(),
          prompt: "Trả lời đúng 1 từ: ok",
          maxOutputTokens: 200,
          maxRetries: 0,
          onError,
        }),
      );
      return c.json({ ok: true, reply: result.text.trim().slice(0, 100) });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
    }
  });
