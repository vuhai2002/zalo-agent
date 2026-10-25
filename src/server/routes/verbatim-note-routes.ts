import { Hono } from "hono";
import { listGhiChuDashboard, xoaGhiChuDashboard } from "../../conversation/verbatim-note-dashboard-store.js";

/** /api/verbatim-notes - xem/xóa ghi chú nguyên văn bot lưu giùm người dùng */
export const verbatimNoteRoutes = new Hono()

  .get("/", (c) => {
    // accountId bỏ trống = mọi account
    const page = Math.max(0, Number(c.req.query("page") ?? 0));
    const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") ?? 50)));
    const rows = listGhiChuDashboard({
      accountId: c.req.query("accountId") ?? "",
      query: c.req.query("q") ?? "",
      limit: pageSize + 1,
      offset: page * pageSize,
    });
    return c.json({ items: rows.slice(0, pageSize), hasMore: rows.length > pageSize });
  })

  .delete("/:id", (c) => {
    const accountId = c.req.query("accountId") ?? "";
    if (!accountId) return c.json({ error: "Thiếu accountId" }, 400);

    const ok = xoaGhiChuDashboard(accountId, Number(c.req.param("id")));
    if (!ok) return c.json({ error: "Ghi chú không tồn tại" }, 404);
    return c.json({ ok: true });
  });
