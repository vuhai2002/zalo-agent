import { Hono } from "hono";
import { deleteMemoryFact, listMemories } from "../../conversation/memory-store.js";

/** /api/memories - xem/xóa fact bot đã ghi nhớ (xóa là quyền của user) */
export const memoryRoutes = new Hono()

  .get("/", (c) => {
    // accountId bỏ trống = mọi account
    const accountId = c.req.query("accountId") ?? "";
    const page = Math.max(0, Number(c.req.query("page") ?? 0));
    const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") ?? 50)));

    const rows = listMemories({
      accountId,
      query: c.req.query("q") ?? "",
      limit: pageSize + 1,
      offset: page * pageSize,
    });
    return c.json({ items: rows.slice(0, pageSize), hasMore: rows.length > pageSize });
  })

  .delete("/:id", (c) => {
    const accountId = c.req.query("accountId") ?? "";
    if (!accountId) return c.json({ error: "Thiếu accountId" }, 400);

    const ok = deleteMemoryFact(accountId, Number(c.req.param("id")));
    if (!ok) return c.json({ error: "Fact không tồn tại" }, 404);
    return c.json({ ok: true });
  });
