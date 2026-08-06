import { Hono } from "hono";
import { z } from "zod";
import { listMessagesPaged } from "../../conversation/history-store.js";
import {
  getThreadSummary,
  listThreads,
  setBotEnabled,
  setThreadSummary,
} from "../../conversation/thread-store.js";
import { getThreadUsageTotals } from "../../conversation/usage-store.js";
import { xoaNguCanhThread } from "../../conversation/wipe-thread-context.js";
import { huyBatchCuaThread } from "../../middleware/message-batcher.js";

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
  })

  /**
   * Xóa bản tóm tắt hội thoại cũ của 1 thread.
   *
   * Đặt `summary_covers_to_message_id` về 0 chứ KHÔNG chỉ xóa chữ: cột đó là
   * mốc "đã gộp tới tin nào". Giữ nguyên mốc thì lần tóm tắt sau chỉ gộp phần
   * backlog MỚI, và toàn bộ đoạn hội thoại cũ mất hẳn thay vì được viết lại -
   * tức là xóa một bản tóm tắt sai lại thành xóa luôn trí nhớ về đoạn đó.
   *
   * Về 0 thì lần gộp sau đọc lại từ đầu và dựng bản mới. Tốn ĐÚNG một lần gọi
   * LLM (đường tóm tắt vốn chỉ chạy khi backlog đủ lớn, và chạy sau khi đã trả
   * lời nên không làm chậm ai).
   */
  .delete("/:threadId/summary", (c) => {
    const accountId = c.req.query("accountId") ?? "";
    if (!accountId) return c.json({ error: "Thiếu accountId" }, 400);

    setThreadSummary(accountId, c.req.param("threadId"), "", 0);
    return c.json({ ok: true });
  })

  /**
   * Xóa SẠCH ngữ cảnh cuộc trò chuyện: tin nhắn, tóm tắt, trace, ảnh đã tải.
   * `xoaTriNho=true` xóa thêm fact bền đã học trong thread này.
   *
   * Hủy hàng chờ TRƯỚC khi xóa DB: đảo thứ tự thì một batch đang đỗ có thể
   * chạy xen vào giữa và ghi lại tin cũ vào lịch sử vừa dọn.
   *
   * KHÔNG có lệnh tương ứng trong chat (goclaw có `/reset` nhưng phải giới hạn
   * "chỉ writer trong nhóm"). Bot này đọc tin người lạ, nên một lệnh xóa qua
   * chat là bề mặt tấn công không đáng đánh đổi - dashboard đã có mật khẩu.
   */
  .delete("/:threadId/history", (c) => {
    const accountId = c.req.query("accountId") ?? "";
    if (!accountId) return c.json({ error: "Thiếu accountId" }, 400);
    const threadId = c.req.param("threadId");

    const tinDangCho = huyBatchCuaThread(`${accountId}:${threadId}`);
    const ketQua = xoaNguCanhThread(accountId, threadId, {
      xoaTriNho: c.req.query("xoaTriNho") === "true",
    });

    return c.json({ ok: true, ...ketQua, tinDangCho });
  });
