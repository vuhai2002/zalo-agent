/**
 * Định dạng/tách mốc giờ theo timezone của BOT (KHÔNG phải giờ trình duyệt).
 * Trang Lịch hẹn PHẢI dùng các hàm này thay vì `toLocaleTimeString` không
 * truyền `timeZone` (đúng lỗi `logs-page.tsx` đang mắc) - "job chạy 7h sáng"
 * là 7h sáng của BOT chứ không phải của người đang xem dashboard.
 *
 * `timeZone` luôn lấy từ API (`/api/schedule` trả kèm `timezone`), không
 * hardcode ở đây - trình duyệt không cần biết BOT_TIMEZONE là gì.
 */

/** "31/07 15:00" từ ISO UTC, đọc theo `timeZone` truyền vào */
export function formatBotTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/**
 * Tách 1 mốc UTC thành ngày (YYYY-MM-DD) + giờ (HH:mm) đọc theo `timeZone` -
 * dùng để tiền điền ô nhập "once" khi mở drawer sửa 1 job đã có `runAt`.
 * `formatToParts` (không phải cộng trừ offset tay) để đúng cả zone có DST.
 */
export function splitBotDateTime(iso: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  // Giờ 24h ở một số locale/engine trả "24" cho nửa đêm thay vì "00" - kẹp lại
  const hour = get("hour") === "24" ? "00" : get("hour");
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${hour}:${get("minute")}` };
}
