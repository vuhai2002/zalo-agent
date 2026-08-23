import { Hono } from "hono";
import { listContacts, xoaContact } from "../../conversation/contact-store.js";

/** /api/contacts - danh bạ auto-collected từ mọi tin đến */
export const contactRoutes = new Hono()
  .get("/", (c) => {
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
  })

  /**
   * Xóa MỘT dòng danh bạ (không đụng tin nhắn). `accountId` bắt buộc vì khóa là
   * (account_id, user_id) - thiếu nó sẽ xóa nhầm cùng user_id ở account khác.
   */
  .delete("/:userId", (c) => {
    const accountId = c.req.query("accountId") ?? "";
    if (!accountId) return c.json({ error: "Thiếu accountId" }, 400);

    const ok = xoaContact(accountId, c.req.param("userId"));
    return c.json({ ok });
  });
