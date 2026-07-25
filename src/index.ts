import { env } from "./config/env.js";
import { getEffectiveLlmSettings } from "./config/runtime-llm-settings.js";
import { closeHistoryStore } from "./conversation/history-store.js";
import { startMediaCleanupSchedule } from "./conversation/media-store.js";
import { startDashboardServer, stopDashboardServer } from "./server/dashboard-server.js";
import { logger } from "./shared/logger.js";
import { startTempFileCleanupSchedule } from "./shared/temp-file-store.js";
import { startAllAccounts, stopAllAccounts } from "./zalo/account-manager.js";

logger.info(
  { nodeEnv: env.NODE_ENV, provider: env.LLM_PROVIDER, model: env.LLM_MODEL },
  "Khởi động zalo-agent",
);

// Thiếu API key không chặn boot (nhập được ở dashboard) nhưng phải nói rõ, nếu
// không thì im lặng tới lúc có tin nhắn đầu tiên mới lộ ra
if (!getEffectiveLlmSettings().apiKey) {
  logger.warn(
    "Chưa có LLM API key - bot sẽ không trả lời được. Đặt LLM_API_KEY trong .env hoặc nhập ở trang Providers.",
  );
}

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

// Dọn ảnh nhận được đã quá MEDIA_RETENTION_DAYS (chạy ngay + mỗi 24h)
startMediaCleanupSchedule();
// Dọn file tạm mồ côi của tool send_file (process bị kill giữa lượt gửi)
startTempFileCleanupSchedule();

startDashboardServer();
startAllAccounts().catch((err) => {
  logger.fatal({ err }, "Khởi động thất bại");
  process.exit(1);
});
