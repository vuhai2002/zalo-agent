import { Hono } from "hono";
import { env } from "../../config/env.js";
import { docConTro } from "../../shared/log-cursor.js";
import { logDir } from "../../shared/logger.js";
import { LOG_LEVELS, readRecentLogs } from "../../shared/read-log-file.js";

/**
 * /api/logs - đọc lại log toàn hệ thống từ file.
 *
 * Chỉ ĐỌC. Không có đường xóa: log là bằng chứng sự cố, xóa được từ trình duyệt
 * thì hết giá trị. Dọn đã có pino-roll tự xoay vòng theo LOG_FILE_KEEP_DAYS.
 */

/** Trần số dòng trả về - đọc nhiều hơn thì trình duyệt lag mà mắt cũng không theo nổi */
const MAX_LIMIT = 500;

export const logRoutes = new Hono().get("/", (c) => {
  if (!env.LOG_FILE_ENABLED) {
    return c.json({
      entries: [],
      scopes: [],
      nextCursor: null,
      disabled: true,
      hint: "LOG_FILE_ENABLED đang tắt nên không có file log để đọc",
    });
  }

  const level = c.req.query("level");
  const scope = c.req.query("scope");
  const search = c.req.query("search");
  const rawCursor = c.req.query("before");

  // Con trỏ hỏng -> TRANG RỖNG, không rơi về trang đầu. Rơi về trang đầu thì
  // client nối thêm đúng những dòng vừa xem và cuộn mãi không tới đáy. Luật lấy
  // từ `list_sessions` của Hermes: "Unknown cursor -> empty page".
  const before = rawCursor ? docConTro(rawCursor) : null;
  if (rawCursor && !before) {
    return c.json({ entries: [], scopes: [], filesRead: 0, nextCursor: null, disabled: false });
  }

  return c.json({
    ...readRecentLogs(logDir, {
      limit: Math.min(MAX_LIMIT, Number(c.req.query("limit")) || 200),
      minLevel: level ? LOG_LEVELS[level as keyof typeof LOG_LEVELS] : undefined,
      scope: scope || undefined,
      search: search || undefined,
      before: before ?? undefined,
    }),
    disabled: false,
  });
});
