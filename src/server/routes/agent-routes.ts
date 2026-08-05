import { Hono } from "hono";
import { z } from "zod";
import { LLM_PROVIDER_KINDS } from "../../config/llm-provider-kind.js";
import {
  createAgent,
  deleteAgent,
  ensureDefaultAgent,
  getAgent,
  listAgents,
  updateAgent,
} from "../../config/agent-store.js";
import { TOOL_KEYS } from "../../agent/tools/tool-registry.js";
import { createLogger } from "../../shared/logger.js";
import { getTuning } from "../../config/runtime-tuning-settings.js";

const log = createLogger("agent-routes");

const createSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "id phải là kebab-case"),
  name: z.string().min(1).max(100),
  icon: z.string().min(1).max(8).optional(),
  persona: z.string().max(8000).optional(),
});

/**
 * Trần ngữ cảnh riêng của agent phải lớn hơn hẳn trần token model được phép
 * viết ra - cùng bất đẳng thức mà `LUAT_CHEO` áp cho cấu hình chung.
 *
 * `null` nghĩa là "theo cấu hình chung", không cần kiểm.
 */
function kiemTranContextCuaAgent(tran: number | null | undefined): string | null {
  if (tran === undefined || tran === null) return null;
  const tranRa = getTuning("LLM_MAX_OUTPUT_TOKENS");
  if (tran * 0.3 > tranRa) return null;
  return `Trần ngữ cảnh của agent (${tran}) quá thấp so với trần token bot viết ra (${tranRa}): bot chừa 30% trần cho phần viết ra và cho kết quả công cụ, nên trần này phải lớn hơn khoảng 3,4 lần.`;
}

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  icon: z.string().min(1).max(8).optional(),
  persona: z.string().max(8000).optional(),
  // null = bỏ override, quay về cấu hình Providers chung
  modelProvider: z.enum(LLM_PROVIDER_KINDS).nullable().optional(),
  modelName: z.string().min(1).nullable().optional(),
  maxSteps: z.number().int().min(1).max(30).nullable().optional(),
  reasoningEffort: z.enum(["off", "low", "medium", "high", "xhigh"]).nullable().optional(),
  // Tool agent này KHÔNG dùng. Chặn key lạ ngay ở biên bằng chính TOOL_KEYS
  // (đúng nếp account-routes.ts) - key rác lọt vào DB thì im lặng vô hại nhưng
  // đọc log lại tưởng tool đó tồn tại.
  disabledTools: z.array(z.enum(TOOL_KEYS as [string, ...string[]])).optional(),
  // null = theo LLM_CONTEXT_WINDOW ở trang Cấu hình. Biên trùng với schema env.
  contextWindow: z.number().int().min(4_000).max(2_000_000).nullable().optional(),
});

/** /api/agents - quản lý "não" (persona + model override), gắn vào account */
export const agentRoutes = new Hono()

  .get("/", (c) => {
    ensureDefaultAgent(); // UI luôn có ít nhất agent mặc định để gắn account
    return c.json({ items: listAgents() });
  })

  .post("/", async (c) => {
    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Dữ liệu không hợp lệ", issues: parsed.error.issues }, 400);
    if (getAgent(parsed.data.id)) return c.json({ error: "Agent id đã tồn tại" }, 409);

    const agent = createAgent(parsed.data);
    log.info({ agentId: agent.id }, "Tạo agent từ dashboard");
    return c.json({ agent }, 201);
  })

  .patch("/:id", async (c) => {
    const parsed = patchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Dữ liệu không hợp lệ", issues: parsed.error.issues }, 400);

    // Ràng buộc chéo GIỐNG trang Cấu hình. Trang đó từ chối lưu khi
    // `LLM_CONTEXT_WINDOW * 0.3 <= LLM_MAX_OUTPUT_TOKENS`, nhưng ô
    // `contextWindow` của agent đi đường này và trước đó không có kiểm nào -
    // tức là đường tài liệu KHUYÊN dùng ("agent chạy model khác đặt riêng được
    // ở trang Agents") lại là đường lách được luật.
    //
    // Ví dụ lọt qua trước đây: contextWindow 4.000 với LLM_MAX_OUTPUT_TOKENS
    // mặc định 16.384 -> ngân sách ngữ cảnh còn 2.800 token trong khi model
    // được phép viết ra 16.384, tức phần chừa đã bị output ăn sạch.
    const loiCheo = kiemTranContextCuaAgent(parsed.data.contextWindow);
    if (loiCheo) return c.json({ error: loiCheo }, 400);

    const agent = updateAgent(c.req.param("id"), parsed.data);
    if (!agent) return c.json({ error: "Agent không tồn tại" }, 404);
    return c.json({ agent });
  })

  .delete("/:id", (c) => {
    const result = deleteAgent(c.req.param("id"));
    if (!result.ok) return c.json({ error: result.reason }, 409);
    log.info({ agentId: c.req.param("id") }, "Xóa agent từ dashboard");
    return c.json({ ok: true });
  });
