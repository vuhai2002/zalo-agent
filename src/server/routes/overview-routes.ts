import { Hono } from "hono";
import { listAccounts } from "../../config/account-store.js";
import { botTimeZone } from "../../config/runtime-tuning-settings.js";
import { getDailyUsage } from "../../conversation/usage-store.js";
import { startOfDayUtc, todayKey } from "../../shared/zone-time.js";
import { getRunningAccounts } from "../../zalo/account-manager.js";
import { getAccountStats, getSystemInfo } from "../overview-stats.js";

const MOT_NGAY_MS = 24 * 60 * 60 * 1000;

/**
 * Cửa sổ ngày cho biểu đồ mức dùng. Chỉ nhận vài giá trị định sẵn thay vì số
 * tùy ý: `?days=100000` sẽ quét toàn bộ bảng `agent_turns` rồi gộp trong JS,
 * biến một tham số URL thành cách làm nghẽn cả tiến trình.
 */
const SO_NGAY_CHO_PHEP = [7, 14, 30] as const;
const SO_NGAY_MAC_DINH = 7;

function soNgayTu(raw: string | undefined): number {
  const n = Number(raw);
  return (SO_NGAY_CHO_PHEP as readonly number[]).includes(n) ? n : SO_NGAY_MAC_DINH;
}

/**
 * /api/overview - trang tổng quan: account (DB + trạng thái online) + usage 7
 * ngày. Mọi mốc "hôm nay" tính theo BOT_TIMEZONE (không phải ngày UTC hay giờ
 * trình duyệt) - trả kèm `todayKey` + `timezone` để frontend dùng nguyên thay
 * vì tự suy ra ngày từ `new Date()` của trình duyệt, dễ lệch với giờ VN của bot.
 */
export const overviewRoutes = new Hono().get("/", (c) => {
  const runningById = new Map(getRunningAccounts().map((a) => [a.id, a]));

  const accounts = listAccounts().map((a) => ({
    id: a.id,
    label: a.label,
    enabled: a.enabled,
    online: runningById.has(a.id),
  }));

  const soNgay = soNgayTu(c.req.query("days"));
  const startOfToday = startOfDayUtc(botTimeZone());
  // Đầu ngày VN, lùi N ngày - không phải "N*24 giờ trước" (mốc đó cắt ngang một
  // ngày VN, làm ngày xa nhất trong biểu đồ hụt vài tiếng dữ liệu).
  const since = startOfDayUtc(botTimeZone(), new Date(Date.now() - soNgay * MOT_NGAY_MS));

  const usageByAccount = accounts.map((a) => ({
    accountId: a.id,
    daily: getDailyUsage(a.id, since, botTimeZone()),
  }));
  const statsByAccount = accounts.map((a) => ({
    accountId: a.id,
    stats: getAccountStats(a.id, startOfToday),
  }));

  return c.json({
    accounts,
    usageByAccount,
    statsByAccount,
    system: getSystemInfo(),
    todayKey: todayKey(botTimeZone()),
    timezone: botTimeZone(),
    // Trả lại số ngày ĐANG hiệu lực (đã kẹp về giá trị hợp lệ), không phải số
    // client gửi lên - gửi `days=999` mà UI vẫn ghi "999 ngày" là nói dối
    days: soNgay,
  });
});
