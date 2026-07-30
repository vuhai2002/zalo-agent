/**
 * Chuẩn hoá + validate đầu vào lịch hẹn (từ tool cho LLM hoặc dashboard) thành
 * `ParsedSchedule`. Module THUẦN: không DB, không env, không logger - nhận
 * `timeZone` và `minIntervalMinutes` qua tham số (đúng nếp `botEnabledForThread`
 * và `parseIncomingMessage` đã làm). Đổi lại: gọi được từ cả tool, route
 * dashboard lẫn test mà không cần mock gì.
 *
 * Đây là LƯỚI ĐỠ ĐẦU chống bot nhắn quá dày (nguy cơ khoá nick cao nhất của cả
 * dự án): `every` dưới ngưỡng và cron dày hơn ngưỡng đều bị chặn NGAY LÚC TẠO,
 * không đợi tới lúc gửi mới phát hiện. Trần tin ở tầng gửi (phase 03) là lưới
 * đỡ cuối, không phải lưới duy nhất.
 */

import { CronExpressionParser } from "cron-parser";
import { zonedWallClockToUtc } from "../shared/zone-time.js";

/** Đã chuẩn hoá + validate - sẵn sàng cho `next-run.ts` tính mốc chạy kế */
export type ParsedSchedule =
  | { kind: "once"; runAtUtc: string }
  | { kind: "every"; minutes: number }
  | { kind: "cron"; expr: string; timeZone: string };

/**
 * Đầu vào THÔ. `once` KHÔNG nhận chuỗi datetime kiểu "2026-08-01T15:00" - đó là
 * đường LLM làm lệch giờ 7 tiếng khi tiến trình chạy khác zone hệ điều hành
 * (Node hiểu chuỗi thiếu zone theo giờ MÁY CHỦ). Nhận `date`+`time` rời rồi
 * quy đổi tường minh qua `timeZone`, hoặc `inMinutes` (tương đối, không dính zone).
 */
export type ScheduleInput =
  | { kind: "once"; date: string; time: string }
  | { kind: "once"; inMinutes: number }
  | { kind: "every"; minutes: number }
  | { kind: "cron"; expr: string };

export type ParseScheduleParams = {
  /** Zone để hiểu `date`/`time` của `once` và để validate `cron` */
  timeZone: string;
  /** Ngưỡng chặn `every`/`cron` quá dày - truyền `SCHEDULER_MIN_INTERVAL_MINUTES` */
  minIntervalMinutes: number;
  /** Mốc "bây giờ" - mặc định giờ hệ thống, test luôn truyền tường minh */
  now?: Date;
};

export type ParseScheduleResult =
  | { ok: true; schedule: ParsedSchedule }
  | { ok: false; error: string };

export function parseSchedule(input: ScheduleInput, params: ParseScheduleParams): ParseScheduleResult {
  const now = params.now ?? new Date();
  if (input.kind === "once") return parseOnce(input, params.timeZone, now);
  if (input.kind === "every") return parseEvery(input, params.minIntervalMinutes);
  return parseCron(input, params.timeZone, params.minIntervalMinutes, now);
}

function parseOnce(
  input: { kind: "once"; date: string; time: string } | { kind: "once"; inMinutes: number },
  timeZone: string,
  now: Date,
): ParseScheduleResult {
  let runAtUtc: string | null;

  if ("inMinutes" in input) {
    if (!Number.isInteger(input.inMinutes) || input.inMinutes <= 0) {
      return { ok: false, error: "Số phút phải là số nguyên dương, ví dụ 30 (nhắc sau 30 phút)." };
    }
    runAtUtc = new Date(now.getTime() + input.inMinutes * 60_000).toISOString();
  } else {
    runAtUtc = zonedWallClockToUtc(input.date, input.time, timeZone);
    if (runAtUtc === null) {
      return {
        ok: false,
        error: `Ngày hoặc giờ không hợp lệ: "${input.date} ${input.time}". Dùng định dạng ngày YYYY-MM-DD và giờ HH:mm.`,
      };
    }
  }

  // Chặn ngay lúc tạo thay vì để job nằm im chờ mãi không tới lượt (Hermes ném
  // ValueError y vậy). Job ĐÃ TỒN TẠI mà bị lỡ giờ là chuyện khác - đó là việc
  // của `decideDueAction` (grace/fast-forward), không phải của parser.
  if (new Date(runAtUtc).getTime() <= now.getTime()) {
    return { ok: false, error: "Thời điểm đã chọn nằm trong quá khứ - hãy chọn một mốc trong tương lai." };
  }

  return { ok: true, schedule: { kind: "once", runAtUtc } };
}

function parseEvery(
  input: { kind: "every"; minutes: number },
  minIntervalMinutes: number,
): ParseScheduleResult {
  if (!Number.isInteger(input.minutes) || input.minutes <= 0) {
    return { ok: false, error: "Số phút lặp lại phải là số nguyên dương." };
  }
  // `every 1m` = 1440 tin/ngày vào một nick cá nhân - đúng chữ ký để Zalo khoá
  // nick. Chặn ở đây rẻ hơn nhiều so với chặn ở trần gửi lúc job đã chạy dở.
  if (input.minutes < minIntervalMinutes) {
    return {
      ok: false,
      error: `Lặp lại tối thiểu mỗi ${minIntervalMinutes} phút để tránh nhắn quá dày, dễ bị Zalo coi là spam.`,
    };
  }
  return { ok: true, schedule: { kind: "every", minutes: input.minutes } };
}

function parseCron(
  input: { kind: "cron"; expr: string },
  timeZone: string,
  minIntervalMinutes: number,
  now: Date,
): ParseScheduleResult {
  // cron-parser coi chuỗi rỗng là hợp lệ (không throw) nên phải tự chặn trước -
  // đo thật bằng cron-parser@5.6.2 trước khi viết dòng này.
  if (input.expr.trim() === "") {
    return { ok: false, error: "Biểu thức cron không được để trống." };
  }

  let first: Date;
  let second: Date;
  try {
    // BẮT BUỘC truyền `tz`: thiếu nó cron-parser dùng giờ HỆ ĐIỀU HÀNH của tiến
    // trình (đo thật: không truyền tz cho ra kết quả trùng hệt truyền đúng
    // BOT_TIMEZONE trên máy dev đặt UTC+7 - trên VPS đặt UTC sẽ lệch 7 tiếng).
    // `currentDate: now` để hàm này THUẦN - không phụ thuộc đồng hồ hệ thống
    // tại thời điểm gọi (cron-parser mặc định currentDate = giờ thật lúc gọi).
    const interval = CronExpressionParser.parse(input.expr, { tz: timeZone, currentDate: now });
    first = interval.next().toDate();
    second = interval.next().toDate();
  } catch {
    return { ok: false, error: `Biểu thức cron không hợp lệ: "${input.expr}".` };
  }

  // `* * * * *` phải chết ở đây: cùng một luật ngưỡng với `every`, tính bằng
  // khoảng cách giữa 2 mốc kế tiếp thay vì đoán từ cú pháp biểu thức.
  const gapMinutes = (second.getTime() - first.getTime()) / 60_000;
  if (gapMinutes < minIntervalMinutes) {
    return {
      ok: false,
      error: `Lịch cron chạy quá dày (hai lần kế tiếp cách nhau ${gapMinutes} phút) - tối thiểu ${minIntervalMinutes} phút để tránh spam.`,
    };
  }

  return { ok: true, schedule: { kind: "cron", expr: input.expr, timeZone } };
}
