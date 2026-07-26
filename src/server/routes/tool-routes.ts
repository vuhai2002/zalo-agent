import { Hono } from "hono";
import { z } from "zod";
import { TOOL_DEFINITIONS } from "../../agent/tools/index.js";
import {
  getFetchSettings,
  getSearchSettingsForApi,
  updateFetchSettings,
  updateSearchSettings,
} from "../../config/runtime-tool-settings.js";
import { createLogger } from "../../shared/logger.js";

const log = createLogger("tool-routes");

const searchUpdateSchema = z.object({
  provider: z.enum(["duckduckgo", "brave"]).optional(),
  // Bỏ trống = giữ key cũ; chuỗi rỗng tường minh = xóa key. Key đi 1 chiều
  // lên server, lưu DB mã hóa, không bao giờ trả về nguyên văn.
  braveApiKey: z.string().optional(),
});

const fetchUpdateSchema = z.object({
  fallbackEnabled: z.boolean().optional(),
});

/**
 * /api/tools - catalog tool + cấu hình chuỗi nguồn cho web_search/web_fetch.
 * Một nguồn duy nhất từ tool-registry (giống reaction-icons) - frontend không
 * chép lại. Trạng thái bật/tắt tool per account nằm trong GET /api/accounts.
 */
export const toolRoutes = new Hono()

  .get("/", (c) =>
    c.json({
      items: TOOL_DEFINITIONS.map((t) => {
        // available = hạ tầng đã sẵn sàng chưa (khác với bật/tắt per account).
        // Thiếu cờ này thì UI hiện tool bật sẵn trong khi model không hề nhận
        // được nó - người dùng tưởng bot có khả năng đó mà không có.
        const available = t.available ? t.available() : true;
        return {
          key: t.key,
          label: t.label,
          description: t.description,
          group: t.group,
          hasSettings: Boolean(t.hasSettings),
          available,
          unavailableHint: available ? undefined : t.unavailableHint,
        };
      }),
      search: getSearchSettingsForApi(),
      fetch: getFetchSettings(),
    }),
  )

  .patch("/search", async (c) => {
    const parsed = searchUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Dữ liệu không hợp lệ", issues: parsed.error.issues }, 400);
    }

    try {
      const search = updateSearchSettings(parsed.data);
      // Audit: ghi field nào đổi, KHÔNG ghi giá trị key
      log.info(
        { provider: search.provider, changedKey: parsed.data.braveApiKey !== undefined },
        "Đổi cấu hình web search từ dashboard",
      );
      return c.json({ ok: true, search: getSearchSettingsForApi() });
    } catch (err) {
      // Chọn brave mà chưa có key - lỗi của người dùng, không phải lỗi server
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  })

  .patch("/fetch", async (c) => {
    const parsed = fetchUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Dữ liệu không hợp lệ", issues: parsed.error.issues }, 400);
    }

    const fetchSettings = updateFetchSettings(parsed.data);
    log.info(fetchSettings, "Đổi cấu hình web fetch từ dashboard");
    return c.json({ ok: true, fetch: fetchSettings });
  });
