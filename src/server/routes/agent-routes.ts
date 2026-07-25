import { Hono } from "hono";
import { z } from "zod";
import {
  createAgent,
  deleteAgent,
  ensureDefaultAgent,
  getAgent,
  listAgents,
  updateAgent,
} from "../../config/agent-store.js";
import { createLogger } from "../../shared/logger.js";

const log = createLogger("agent-routes");

const createSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "id phải là kebab-case"),
  name: z.string().min(1).max(100),
  icon: z.string().min(1).max(8).optional(),
  persona: z.string().max(8000).optional(),
});

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  icon: z.string().min(1).max(8).optional(),
  persona: z.string().max(8000).optional(),
  // null = bỏ override, quay về cấu hình Providers chung
  modelProvider: z.enum(["openai-compatible", "anthropic"]).nullable().optional(),
  modelName: z.string().min(1).nullable().optional(),
  maxSteps: z.number().int().min(1).max(30).nullable().optional(),
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
