/**
 * Quy đổi giờ tường (wall clock) theo timezone IANA <-> mốc UTC. Module thuần -
 * không import env, không chạm DB, không tạo logger (module thuần mà tạo logger
 * thì test của nó đẻ file log thật trong data/, lỗi đã dính ở html-to-text) -
 * caller tự truyền timeZone vào, đúng nếp current-datetime.ts đang làm.
 *
 * Vì sao dùng luxon thay vì tự cộng trừ offset: Asia/Ho_Chi_Minh không có DST
 * nên tự cộng 7 tiếng trông "có vẻ dễ", nhưng BOT_TIMEZONE là cấu hình - ai đặt
 * Europe/Paris là gặp DST ngay, offset đổi theo mùa mà phép cộng cứng không biết.
 *
 * Mọi cột thời gian trong DB là UTC có hậu tố Z (đúng dạng toISOString() của
 * JS). Các hàm ở đây luôn trả về UTC qua toJSDate().toISOString() - không dùng
 * thẳng DateTime#toISO() vì kiểu trả về của nó là `string | null`, còn ở đây
 * sau khi đã kiểm isValid thì kết quả CHẮC CHẮN có giá trị.
 */

import { DateTime, IANAZone } from "luxon";

/**
 * Zone hỏng thì rơi về UTC thay vì để luxon tạo ra DateTime "invalid" rồi lan
 * lỗi đi khắp nơi - theo đúng nếp getDateTimeParts: một BOT_TIMEZONE cấu hình
 * sai không được làm chết cả lượt agent hay cả vòng tick của scheduler.
 */
function safeZone(timeZone: string): string {
  return IANAZone.isValidZone(timeZone) ? timeZone : "UTC";
}

/**
 * Giờ tường (ngày + giờ rời, theo timeZone) -> mốc UTC ISO. Đây là chặn duy
 * nhất cho lỗi nguy hiểm nhất khi LLM đưa mốc giờ: nhận chuỗi datetime rồi
 * `new Date(...)` thẳng sẽ bị Node hiểu theo giờ HỆ ĐIỀU HÀNH, trên VPS đặt UTC
 * thì "3h chiều" thành 22:00 giờ VN. Nhận `date`/`time` tách rời + `timeZone`
 * tường minh thì không còn đường nào để cách viết chuỗi làm đổi ý nghĩa.
 *
 * Trả `null` khi ngày/giờ không hợp lệ (sai định dạng, ngày không tồn tại như
 * 30/02, giờ 25:99...) để caller báo lỗi tử tế thay vì cả tiến trình văng lỗi
 * vì một chuỗi model tự bịa.
 */
export function zonedWallClockToUtc(date: string, time: string, timeZone: string): string | null {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone: safeZone(timeZone) });
  return dt.isValid ? dt.toUTC().toJSDate().toISOString() : null;
}

/**
 * Mốc 00:00:00 của "hôm nay" theo timeZone, trả dạng UTC ISO để so trực tiếp
 * với cột `created_at` (cũng UTC). Vá đúng bug "hôm nay tính theo ngày UTC":
 * `strftime(...,'now')` lấy 00:00 UTC = 07:00 sáng giờ VN, sai cả hai chiều
 * tùy thời điểm xem trong ngày.
 */
export function startOfDayUtc(timeZone: string, now: Date = new Date()): string {
  return DateTime.fromJSDate(now, { zone: safeZone(timeZone) })
    .startOf("day")
    .toUTC()
    .toJSDate()
    .toISOString();
}

/**
 * Mốc 00:00:00 của NGÀY MAI theo timeZone - dùng khi 1 job 'once' bị TRẦN
 * NGÀY chặn: phải đẩy hẳn sang ngày kế tiếp (thử lại trong ngày vẫn chạm trần
 * y hệt) thay vì đứng yên ở mốc quá khứ (kẹt vĩnh viễn - 'once' không có "lần
 * kế" tự nhiên như every/cron). Dùng `.plus({days:1})` của luxon thay vì cộng
 * cứng 24 tiếng - đúng NGÀY LỊCH trong zone dù zone đó có DST (giờ mùa hè
 * nhảy 23/25 tiếng, không phải luôn luôn 24).
 */
export function startOfNextDayUtc(timeZone: string, now: Date = new Date()): string {
  return DateTime.fromJSDate(now, { zone: safeZone(timeZone) })
    .plus({ days: 1 })
    .startOf("day")
    .toUTC()
    .toJSDate()
    .toISOString();
}

/**
 * Khóa ngày (`YYYY-MM-DD`) của một mốc UTC, đọc theo timeZone - chiều ngược
 * lại của `startOfDayUtc`: đã biết mốc UTC, giờ hỏi nó thuộc ngày nào theo giờ
 * VN. Dùng để GOM trong JS (usage-store.getDailyUsage) thay vì cắt chuỗi UTC
 * bằng SQL `substr()`, vì cắt chuỗi chỉ đúng khi gom theo ngày UTC chứ không
 * phải ngày VN.
 *
 * `utcIso` luôn do chính hệ thống sinh ra (cột DB hoặc `toISOString()`), không
 * phải input tự do từ người dùng, nên mốc hỏng là lỗi lập trình - ném lỗi rõ
 * ràng thay vì âm thầm trả về khóa "Invalid DateTime" làm bảng gộp sai lặng lẽ.
 */
export function dayKeyOf(utcIso: string, timeZone: string): string {
  const dt = DateTime.fromISO(utcIso, { zone: "utc" }).setZone(safeZone(timeZone));
  if (!dt.isValid) {
    throw new Error(`dayKeyOf: mốc UTC không hợp lệ "${utcIso}" (${dt.invalidReason})`);
  }
  return dt.toFormat("yyyy-LL-dd");
}

/**
 * Khóa ngày của "bây giờ" theo timeZone - tiện dùng thẳng ở API /api/overview
 * và trần tin chủ động theo ngày của scheduler, thay vì mỗi call site tự ghép
 * `dayKeyOf(now.toISOString(), tz)`.
 */
export function todayKey(timeZone: string, now: Date = new Date()): string {
  return dayKeyOf(now.toISOString(), timeZone);
}
