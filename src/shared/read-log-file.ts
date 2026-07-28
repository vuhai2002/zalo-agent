import fs from "node:fs";
import path from "node:path";

/**
 * Đọc lại log đã ghi ra file để hiện trên dashboard.
 *
 * pino ghi mỗi dòng một object JSON (ndjson), `level` là SỐ theo quy ước pino:
 * 10 trace, 20 debug, 30 info, 40 warn, 50 error, 60 fatal.
 *
 * Module THUẦN: nhận thư mục qua tham số, không đụng env - test chạy thẳng và
 * caller nào cũng dùng được.
 *
 * Đọc cả file rồi lọc trong bộ nhớ, không stream: file xoay vòng mỗi ngày nên
 * mỗi file chỉ là log của một ngày. Đổi lại có thêm trần MAX_BYTES_PER_FILE để
 * một ngày bất thường không kéo sập trang.
 */

/** Chỉ đọc phần ĐUÔI của file lớn - dòng mới nhất nằm ở cuối */
const MAX_BYTES_PER_FILE = 4 * 1024 * 1024;

export const LOG_LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 } as const;

export type LogEntry = {
  time: number;
  /** Số theo quy ước pino - UI tự đổi sang nhãn */
  level: number;
  scope: string;
  msg: string;
  /** Mọi trường phụ còn lại (threadId, accountId, err...) - chỗ chứa ngữ cảnh */
  fields: Record<string, unknown>;
};

export type ReadLogsOptions = {
  limit: number;
  /** Chỉ lấy từ mức này trở lên (số pino) */
  minLevel?: number;
  scope?: string;
  /** Tìm chữ trong toàn bộ dòng log, không phân biệt hoa thường */
  search?: string;
};

export type ReadLogsResult = {
  entries: LogEntry[];
  /**
   * Scope xuất hiện trong các file ĐÃ ĐỌC - để dashboard dựng ô lọc, không
   * hardcode. Không phải toàn bộ scope từng có: file cũ chưa cần mở thì không mở.
   */
  scopes: string[];
  /** Số file đã phải mở - cho biết kết quả trải dài bao nhiêu ngày */
  filesRead: number;
};

/** Đọc đuôi file, bỏ dòng đầu nếu bị cắt giữa chừng */
function docDuoiFile(filePath: string): string {
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

function tachDong(raw: string): LogEntry | null {
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

export function readRecentLogs(dir: string, options: ReadLogsOptions): ReadLogsResult {
  let files: string[];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".log"))
      // Tên pino-roll dạng bot.<ngày>.<số>.log nên sắp theo tên là theo thời gian.
      // Đảo lại để đi từ MỚI NHẤT về cũ và dừng được sớm.
      .sort()
      .reverse();
  } catch {
    return { entries: [], scopes: [], filesRead: 0 };
  }

  const timKiem = options.search?.toLowerCase();
  const khop = (e: LogEntry): boolean => {
    if (options.minLevel !== undefined && e.level < options.minLevel) return false;
    if (options.scope && e.scope !== options.scope) return false;
    if (timKiem) {
      const trongDong = `${e.msg} ${e.scope} ${JSON.stringify(e.fields)}`.toLowerCase();
      if (!trongDong.includes(timKiem)) return false;
    }
    return true;
  };

  // Đi từ file mới nhất về cũ, DỪNG ngay khi đủ dòng. Bản cũ đọc và parse toàn
  // bộ log 7 ngày (đo thật ~6.5MB) mỗi lần vào trang, chỉ để trả về 200 dòng.
  const entries: LogEntry[] = [];
  const scopes = new Set<string>();
  let filesRead = 0;

  for (const f of files) {
    if (entries.length >= options.limit) break;
    filesRead++;

    // Trong một file: dòng cuối là mới nhất nên duyệt ngược
    const dong = docDuoiFile(path.join(dir, f)).split("\n");
    const cuaFile: LogEntry[] = [];
    for (let i = dong.length - 1; i >= 0; i--) {
      const raw = dong[i]!;
      if (!raw.trim()) continue;
      const e = tachDong(raw);
      if (!e) continue;
      // Scope gom từ MỌI dòng của file đã mở, kể cả dòng bị lọc bỏ - không thì
      // lọc theo một scope xong là ô chọn chỉ còn đúng scope đó
      if (e.scope) scopes.add(e.scope);
      if (khop(e)) cuaFile.push(e);
    }
    entries.push(...cuaFile);
  }

  return { entries: entries.slice(0, options.limit), scopes: [...scopes].sort(), filesRead };
}
