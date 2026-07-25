import { Hono } from "hono";
import { z } from "zod";
import { listMessagesPaged } from "../../conversation/history-store.js";
import { getThreadSummary, listThreads, setBotEnabled } from "../../conversation/thread-store.js";
import { getThreadUsageTotals } from "../../conversation/usage-store.js";

/** /api/threads - màn Sessions: list, xem hội thoại, bật/tắt bot per thread */
export const threadRoutes = new Hono()

  .get("/", (c) => {
    // accountId bỏ trống = xem trộn mọi account (lọc bằng dropdown trong trang)
    const accountId = c.req.query("accountId") ?? "";
    const page = Math.max(0, Number(c.req.query("page") ?? 0));
    const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") ?? 50)));

    const rows = listThreads({
      accountId,
      query: c.req.query("q") ?? "",
      limit: pageSize + 1, // lấy dư 1 để biết còn trang sau không
      offset: page * pageSize,
    });

    const items = rows.slice(0, pageSize).map((t) => ({
      ...t,
      usage: getThreadUsageTotals(t.accountId, t.threadId),
      summary: getThreadSummary(t.accountId, t.threadId).summary,
    }));
    return c.json({ items, hasMore: rows.length > pageSize });
  })

  .get("/:threadId/messages", (c) => {
    const accountId = c.req.query("accountId") ?? "";
    if (!accountId) return c.json({ error: "Thiếu accountId" }, 400);

    const beforeIdRaw = c.req.query("beforeId");
    const items = listMessagesPaged(accountId, c.req.param("threadId"), {
      limit: Math.min(200, Math.max(1, Number(c.req.query("limit") ?? 50))),
      beforeId: beforeIdRaw ? Number(beforeIdRaw) : undefined,
    });
    return c.json({ items });
  })

  .patch("/:threadId", async (c) => {
    const bodySchema = z.object({ accountId: z.string().min(1), botEnabled: z.boolean() });
    const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Body cần { accountId, botEnabled }" }, 400);

    const ok = setBotEnabled(parsed.data.accountId, c.req.param("threadId"), parsed.data.botEnabled);
    if (!ok) return c.json({ error: "Thread không tồn tại" }, 404);
    return c.json({ ok: true, botEnabled: parsed.data.botEnabled });
  });
