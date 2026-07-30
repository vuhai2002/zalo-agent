import { Hono } from "hono";
import { listAccounts } from "../../config/account-store.js";
import { env } from "../../config/env.js";
import { getDailyUsage } from "../../conversation/usage-store.js";
import { startOfDayUtc, todayKey } from "../../shared/zone-time.js";
import { getRunningAccounts } from "../../zalo/account-manager.js";
import { getAccountStats, getSystemInfo } from "../overview-stats.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

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

  const startOfToday = startOfDayUtc(env.BOT_TIMEZONE);
  // Đầu ngày VN, lùi 7 ngày - không phải "168 giờ trước" (mốc đó cắt ngang một
  // ngày VN, làm ngày xa nhất trong biểu đồ hụt vài tiếng dữ liệu).
  const since = startOfDayUtc(env.BOT_TIMEZONE, new Date(Date.now() - SEVEN_DAYS_MS));

  const usageByAccount = accounts.map((a) => ({
    accountId: a.id,
    daily: getDailyUsage(a.id, since, env.BOT_TIMEZONE),
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
    todayKey: todayKey(env.BOT_TIMEZONE),
    timezone: env.BOT_TIMEZONE,
  });
});
