import { Hono } from "hono";
import { loadAccounts } from "../../config/accounts.js";
import { getDailyUsage } from "../../conversation/usage-store.js";
import { getRunningAccounts } from "../../zalo/account-manager.js";

/** /api/overview - trang tổng quan: account (config + trạng thái online) + usage 7 ngày */
export const overviewRoutes = new Hono().get("/", (c) => {
  const runningById = new Map(getRunningAccounts().map((a) => [a.id, a]));

  // Từ config để account login Zalo fail vẫn hiện (kèm online=false) cho UI chọn
  let accounts: { id: string; label: string; enabled: boolean; online: boolean }[];
  try {
    accounts = loadAccounts().map((a) => ({
      id: a.id,
      label: a.label,
      enabled: a.enabled,
      online: runningById.has(a.id),
    }));
  } catch {
    // Không đọc được config (chạy dev tách rời) - fallback account đang chạy
    accounts = [...runningById.values()].map((a) => ({
      id: a.id,
      label: a.label,
      enabled: true,
      online: true,
    }));
  }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const usageByAccount = accounts.map((a) => ({
    accountId: a.id,
    daily: getDailyUsage(a.id, since),
  }));

  return c.json({ accounts, usageByAccount });
});
