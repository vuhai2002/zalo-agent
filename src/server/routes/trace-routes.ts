import { Hono } from "hono";
import {
  getRecentTurns,
  getRecentTurnsAllThreads,
  getTurnTrace,
} from "../../agent/agent-trace-store.js";

/**
 * /api/traces - xem lại từng step của lượt agent.
 *
 * Chỉ ĐỌC, không có đường sửa hay xóa: trace là bằng chứng chẩn đoán, sửa được
 * thì hết giá trị. Dọn thì đã có tác vụ định kỳ theo AGENT_TRACE_RETENTION_DAYS.
 */

/** Số lượt tối đa trả về mỗi lần - chính sách tự đặt, đủ để lần lại vài ngày gần đây */
const MAX_TURNS = 50;

export const traceRoutes = new Hono()

  // Lượt gần đây của MỌI thread - nguồn cho trang Trace ở sidebar.
  // Khai TRƯỚC "/:accountId/:threadId" để không bị route đó nuốt mất.
  .get("/", (c) => {
    const limit = Math.min(MAX_TURNS, Number(c.req.query("limit")) || MAX_TURNS);
    return c.json({ turns: getRecentTurnsAllThreads(limit) });
  })

  .get("/turn/:turnId", (c) => {
    const turnId = Number(c.req.param("turnId"));
    // Chặn trước khi chạm DB: id rác vào prepare statement là lỗi khó đọc
    if (!Number.isInteger(turnId) || turnId <= 0) {
      return c.json({ error: "turnId phải là số nguyên dương" }, 400);
    }
    return c.json({ steps: getTurnTrace(turnId) });
  })

  .get("/:accountId/:threadId", (c) => {
    const limit = Math.min(MAX_TURNS, Number(c.req.query("limit")) || MAX_TURNS);
    return c.json({
      turns: getRecentTurns(c.req.param("accountId"), c.req.param("threadId"), limit),
    });
  });
