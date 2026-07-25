import { Hono } from "hono";
import { listAccounts } from "../../config/account-store.js";
import { getDailyUsage } from "../../conversation/usage-store.js";
import { getRunningAccounts } from "../../zalo/account-manager.js";
import { getAccountStats, getSystemInfo } from "../overview-stats.js";

/** /api/overview - trang tổng quan: account (DB + trạng thái online) + usage 7 ngày */
export const overviewRoutes = new Hono().get("/", (c) => {
  const runningById = new Map(getRunningAccounts().map((a) => [a.id, a]));

  const accounts = listAccounts().map((a) => ({
    id: a.id,
    label: a.label,
    enabled: a.enabled,
    online: runningById.has(a.id),
  }));

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const usageByAccount = accounts.map((a) => ({
    accountId: a.id,
    daily: getDailyUsage(a.id, since),
  }));
  const statsByAccount = accounts.map((a) => ({
    accountId: a.id,
    stats: getAccountStats(a.id),
  }));

  return c.json({ accounts, usageByAccount, statsByAccount, system: getSystemInfo() });
});
