import { Hono } from "hono";
import { listContacts } from "../../conversation/contact-store.js";

/** /api/contacts - danh bạ auto-collected từ mọi tin đến */
export const contactRoutes = new Hono().get("/", (c) => {
  // accountId bỏ trống = mọi account
  const accountId = c.req.query("accountId") ?? "";
  const page = Math.max(0, Number(c.req.query("page") ?? 0));
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") ?? 50)));

  const rows = listContacts({
    accountId,
    query: c.req.query("q") ?? "",
    limit: pageSize + 1,
    offset: page * pageSize,
  });

  return c.json({ items: rows.slice(0, pageSize), hasMore: rows.length > pageSize });
});
