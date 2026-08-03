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
 *
 * Phân trang bằng CON TRỎ (`?before=<id lượt cuối trang trước>`), không phải
 * offset: trang này sắp theo id giảm dần và lượt mới ghi vào liên tục, nên
 * offset sẽ trượt - bấm "Xem thêm" đúng lúc bot vừa trả lời là lặp lại vài lượt
 * vừa xem. Con trỏ theo id thì không trượt.
 */

/** Số lượt tối đa trả về mỗi lần - chính sách tự đặt, đủ để lần lại vài ngày gần đây */
const MAX_TURNS = 50;

function soLuong(raw: string | undefined): number {
  return Math.min(MAX_TURNS, Number(raw) || MAX_TURNS);
}

/**
 * Đọc `?before=`. Trả `undefined` khi không có, `null` khi có mà hỏng.
 *
 * Phân biệt hai ca đó vì con trỏ hỏng KHÔNG được rơi về trang đầu - client sẽ
 * nối thêm đúng những lượt vừa xem và cuộn mãi không tới đáy. Luật lấy từ
 * `list_sessions` của Hermes: "Unknown cursor -> empty page".
 */
function docConTro(raw: string | undefined): number | undefined | null {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Lấy DƯ một lượt để biết còn dữ liệu phía sau mà không phải chạy thêm câu
 * COUNT trên bảng đang quét toàn phần. Cắt phần dư trước khi trả về.
 */
function catTrang<T extends { id: number }>(
  duLieu: T[],
  limit: number,
): { turns: T[]; nextCursor: number | null } {
  const conNua = duLieu.length > limit;
  const turns = conNua ? duLieu.slice(0, limit) : duLieu;
  return { turns, nextCursor: conNua ? (turns[turns.length - 1]?.id ?? null) : null };
}

export const traceRoutes = new Hono()

  // Lượt gần đây của MỌI thread - nguồn cho trang Trace ở sidebar.
  // Khai TRƯỚC "/:accountId/:threadId" để không bị route đó nuốt mất.
  .get("/", (c) => {
    const before = docConTro(c.req.query("before"));
    if (before === null) return c.json({ turns: [], nextCursor: null });
    const limit = soLuong(c.req.query("limit"));
    return c.json(catTrang(getRecentTurnsAllThreads(limit + 1, before), limit));
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
    const before = docConTro(c.req.query("before"));
    if (before === null) return c.json({ turns: [], nextCursor: null });
    const limit = soLuong(c.req.query("limit"));
    return c.json(
      catTrang(
        getRecentTurns(c.req.param("accountId"), c.req.param("threadId"), limit + 1, before),
        limit,
      ),
    );
  });
