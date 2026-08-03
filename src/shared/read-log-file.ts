import fs from "node:fs";
import path from "node:path";
import { docDuoiFile, tachDong } from "./log-file-lines.js";
import { doiConTroThanhChuoi, type ConTroLog } from "./log-cursor.js";

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
  /**
   * Chỉ lấy dòng CŨ HƠN vị trí này - nút "Xem thêm". Xem `log-cursor.ts` để
   * biết vì sao con trỏ cần cả `daLay` chứ không chỉ mốc thời gian.
   */
  before?: ConTroLog;
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
  /**
   * Con trỏ cho lần bấm "Xem thêm" kế tiếp; `null` = đã hết log để đọc.
   *
   * Biết là hết bằng cách lấy DƯ một dòng (`limit + 1`) rồi cắt bớt - rẻ hơn
   * hẳn so với đếm tổng số dòng khớp, vốn phải parse hết mọi file.
   */
  nextCursor: string | null;
};

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
    return { entries: [], scopes: [], filesRead: 0, nextCursor: null };
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
  //
  // Lấy DƯ 1 dòng để biết còn log phía sau hay không mà không phải đếm tổng.
  const canLay = options.limit + 1;
  const before = options.before;
  const entries: LogEntry[] = [];
  const scopes = new Set<string>();
  let filesRead = 0;
  /**
   * Số dòng khớp bộ lọc có ĐÚNG mốc `time` của dòng cuối cùng đã duyệt, đếm từ
   * đầu luồng (kể cả dòng bị con trỏ bỏ qua). Đây chính là `daLay` của con trỏ
   * trang sau - xem `log-cursor.ts`.
   */
  let cungMoc = 0;
  let mocDangDem = -1;

  for (const f of files) {
    if (entries.length >= canLay) break;
    filesRead++;

    // Trong một file: dòng cuối là mới nhất nên duyệt ngược
    const dong = docDuoiFile(path.join(dir, f)).split("\n");
    for (let i = dong.length - 1; i >= 0; i--) {
      const raw = dong[i]!;
      if (!raw.trim()) continue;
      const e = tachDong(raw);
      if (!e) continue;
      // Scope gom từ MỌI dòng của file đã mở, kể cả dòng bị lọc bỏ - không thì
      // lọc theo một scope xong là ô chọn chỉ còn đúng scope đó
      if (e.scope) scopes.add(e.scope);
      if (!khop(e)) continue;

      // Đếm phải chạy TRƯỚC khi con trỏ loại dòng, vì `daLay` tính từ đầu luồng
      if (e.time !== mocDangDem) {
        mocDangDem = e.time;
        cungMoc = 0;
      }
      cungMoc++;

      if (before) {
        // Dòng mới hơn con trỏ: đã trả ở trang trước
        if (e.time > before.time) continue;
        // Cùng mốc: bỏ qua đúng số dòng đã trả, phần còn lại mới là của trang này
        if (e.time === before.time && cungMoc <= before.daLay) continue;
      }

      entries.push(e);
      if (entries.length >= canLay) break;
    }
  }

  const conNua = entries.length > options.limit;
  const trang = entries.slice(0, options.limit);
  const cuoi = trang[trang.length - 1];
  // `cungMoc` lúc này ứng với dòng DƯ (nếu có) chứ không phải dòng cuối trang,
  // nên đếm lại trong phạm vi trang thay vì dùng thẳng biến đó.
  const nextCursor =
    conNua && cuoi
      ? doiConTroThanhChuoi({
          time: cuoi.time,
          daLay: soDongCungMocTinhTuDau(trang, cuoi.time, before),
        })
      : null;

  return { entries: trang, scopes: [...scopes].sort(), filesRead, nextCursor };
}

/**
 * Tổng số dòng có mốc `time` đã trả TỪ ĐẦU luồng, gồm cả các trang trước.
 *
 * Trang trước đã trả `before.daLay` dòng ở mốc đó rồi, nên nếu trang này vẫn
 * còn dòng cùng mốc thì phải cộng dồn - không cộng thì trang sau bỏ qua thiếu
 * và trả lại đúng những dòng vừa xem.
 */
function soDongCungMocTinhTuDau(
  trang: LogEntry[],
  moc: number,
  before: ConTroLog | undefined,
): number {
  let n = 0;
  for (const e of trang) if (e.time === moc) n++;
  return before?.time === moc ? before.daLay + n : n;
}
