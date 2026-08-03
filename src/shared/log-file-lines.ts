import fs from "node:fs";
import type { LogEntry } from "./read-log-file.js";

/**
 * Đọc file log và tách một dòng ndjson thành `LogEntry`.
 *
 * Tách khỏi `read-log-file.ts` để file kia còn đúng phần chọn file, lọc và
 * phân trang - đây là phần chạm đĩa và parse, không dính luật nghiệp vụ nào.
 */

/** Chỉ đọc phần ĐUÔI của file lớn - dòng mới nhất nằm ở cuối */
const MAX_BYTES_PER_FILE = 4 * 1024 * 1024;

/** Đọc đuôi file, bỏ dòng đầu nếu bị cắt giữa chừng */
export function docDuoiFile(filePath: string): string {
  const { size } = fs.statSync(filePath);
  if (size <= MAX_BYTES_PER_FILE) return fs.readFileSync(filePath, "utf8");

  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(MAX_BYTES_PER_FILE);
    fs.readSync(fd, buf, 0, MAX_BYTES_PER_FILE, size - MAX_BYTES_PER_FILE);
    const text = buf.toString("utf8");
    // Dòng đầu gần như chắc chắn bị cắt dở -> bỏ
    return text.slice(text.indexOf("\n") + 1);
  } finally {
    fs.closeSync(fd);
  }
}

export function tachDong(raw: string): LogEntry | null {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (typeof o.level !== "number") return null;
    const { level, time, scope, msg, pid, hostname, ...fields } = o;
    return {
      level,
      time: typeof time === "number" ? time : 0,
      scope: typeof scope === "string" ? scope : "",
      msg: typeof msg === "string" ? msg : "",
      fields,
    };
  } catch {
    // Dòng hỏng (ghi dở lúc process chết) không được làm chết cả trang
    return null;
  }
}
