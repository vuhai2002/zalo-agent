import { env } from "./config/env.js";
import { closeHistoryStore } from "./conversation/history-store.js";
import { startDashboardServer, stopDashboardServer } from "./server/dashboard-server.js";
import { logger } from "./shared/logger.js";
import { startAllAccounts, stopAllAccounts } from "./zalo/account-manager.js";

logger.info(
  { nodeEnv: env.NODE_ENV, provider: env.LLM_PROVIDER, model: env.LLM_MODEL },
  "Khởi động zalo-agent",
);

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Đang tắt zalo-agent...");
  stopDashboardServer();
  stopAllAccounts();
  closeHistoryStore();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (err) => logger.error({ err }, "unhandledRejection"));
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaughtException - thoát để process manager restart");
  process.exit(1);
});

// Heartbeat: xác nhận process còn sống trong log (debug level để prod không noise)
setInterval(() => logger.debug("heartbeat"), 60_000).unref();

startDashboardServer();
startAllAccounts().catch((err) => {
  logger.fatal({ err }, "Khởi động thất bại");
  process.exit(1);
});
