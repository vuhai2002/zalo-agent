/**
 * Ngày giờ hiện tại theo timezone IANA. Module thuần - KHÔNG import env để
 * config/env.ts dùng được isValidTimezone lúc validate mà không tạo vòng import;
 * caller tự truyền env.BOT_TIMEZONE vào.
 *
 * Thứ trong tuần do server tính - LLM tự suy thứ từ ngày rất hay sai, nên tool
 * trả sẵn và dặn dùng nguyên văn (học từ datetime tool của GoClaw:
 * "authoritative, never infer").
 */

const WEEKDAY_VI: Record<string, string> = {
  Mon: "Thứ hai",
  Tue: "Thứ ba",
  Wed: "Thứ tư",
  Thu: "Thứ năm",
  Fri: "Thứ sáu",
  Sat: "Thứ bảy",
  Sun: "Chủ nhật",
};

/** Các phần ngày giờ tách sẵn tại 1 thời điểm, theo 1 timezone */
export type DateTimeParts = {
  /** vd "25/07/2026" */
  date: string;
  /** vd "22:15" */
  time: string;
  /** vd "Thứ bảy" - server tính, không để model tự suy */
  weekday: string;
  timezone: string;
};

/** Lấy field theo tên từ Intl.formatToParts - thiếu thì chuỗi rỗng */
function partsOf(now: Date, timeZone: string): Record<string, string> {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  return Object.fromEntries(formatted.map((p) => [p.type, p.value]));
}

/**
 * Timezone từ env đã được kiểm hợp lệ lúc boot, nhưng vẫn fallback UTC phòng
 * hờ - 1 giá trị hỏng không được làm chết lượt agent.
 */
export function getDateTimeParts(timeZone: string, now = new Date()): DateTimeParts {
  let p: Record<string, string>;
  let tz = timeZone;
  try {
    p = partsOf(now, tz);
  } catch {
    tz = "UTC";
    p = partsOf(now, tz);
  }
  return {
    date: `${p.day}/${p.month}/${p.year}`,
    time: `${p.hour}:${p.minute}`,
    weekday: WEEKDAY_VI[p.weekday ?? ""] ?? (p.weekday || "?"),
    timezone: tz,
  };
}

/**
 * Dòng ngày cho system prompt: CHỈ ngày + thứ, không có giờ - có chủ đích.
 * System prompt đổi mỗi phút là prompt cache của provider vỡ mỗi phút;
 * chỉ ngày thì cache sống nguyên ngày (pattern của GoClaw). Giờ chính xác
 * agent lấy qua tool get_datetime khi thật sự cần.
 */
export function currentDateLine(timeZone: string, now = new Date()): string {
  const p = getDateTimeParts(timeZone, now);
  return `Hôm nay là ${p.weekday}, ngày ${p.date} (giờ Việt Nam). Cần giờ chính xác thì dùng tool get_datetime, đừng tự đoán.`;
}

/** Kiểm timezone IANA có hợp lệ không - dùng trong schema env lúc boot */
export function isValidTimezone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return true;
  } catch {
    return false;
  }
}
