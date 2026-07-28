import path from "node:path";
import pino from "pino";
import { dataDir, env } from "../config/env.js";
import { ensureUtf8Console } from "./console-encoding.js";
import { serializeErrorSafely } from "./safe-error-serializer.js";

// Phải chạy trước khi có output đầu tiên, nếu không log tiếng Việt bị vỡ trên Windows
ensureUtf8Console();

/**
 * Log đi ra HAI nơi với hai mức khác nhau:
 *
 * - Terminal: theo LOG_LEVEL, mặc định `info`. Terminal cần GỌN để đọc lướt.
 * - File `data/logs/bot.<ngày>.log`: ghi MỌI mức kể cả debug. File cần ĐỦ, vì
 *   lúc cần tới nó là lúc sự cố đã xảy ra rồi, không quay ngược lại bật debug được.
 *
 * Không có file thì log chỉ tồn tại trong terminal đang chạy bot - đóng terminal
 * là mất sạch, và trên VPS thì không còn gì để lần lại khi có sự cố.
 *
 * `env` import được ở đây mà không sợ vòng phụ thuộc: env.ts chỉ kéo theo
 * current-datetime.ts, mà file đó không import gì cả.
 */

const isDev = process.env.NODE_ENV !== "production";

/** Terminal: dev thì tô màu cho dễ đọc, prod thì JSON thô ra stdout */
const consoleTarget = isDev
  ? {
      target: "pino-pretty",
      level: env.LOG_LEVEL,
      options: { translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
    }
  : { target: "pino/file", level: env.LOG_LEVEL, options: { destination: 1 } };

/** Thư mục chứa file log - dashboard đọc lại từ đây */
export const logDir = path.join(dataDir, "logs");

/**
 * File xoay vòng mỗi ngày, giữ LOG_FILE_KEEP_DAYS file gần nhất.
 * `mkdir: true` vì data/logs chưa tồn tại ở lần chạy đầu.
 */
const fileTarget = {
  target: "pino-roll",
  // trace = thấp nhất, tức là nhận hết. Cố ý khác LOG_LEVEL của terminal.
  level: "trace",
  options: {
    file: path.join(logDir, "bot"),
    extension: ".log",
    frequency: "daily",
    dateFormat: "yyyy-MM-dd",
    mkdir: true,
    limit: { count: env.LOG_FILE_KEEP_DAYS },
  },
};

export const logger = pino({
  // Mức GỐC phải thấp bằng target thấp nhất, không thì dòng debug bị chặn ngay
  // từ đây và target file không bao giờ nhận được
  level: env.LOG_FILE_ENABLED ? "trace" : env.LOG_LEVEL,
  // Đè bộ serialize `err` mặc định: bản gốc chép mọi thuộc tính của error, kéo
  // theo `requestBodyValues` của APICallError = system prompt + hội thoại + ảnh
  // base64 ra thẳng file log. Xem safe-error-serializer.ts để biết chi tiết.
  serializers: { err: serializeErrorSafely },
  transport: {
    targets: env.LOG_FILE_ENABLED ? [consoleTarget, fileTarget] : [consoleTarget],
  },
});

export const createLogger = (scope: string) => logger.child({ scope });
