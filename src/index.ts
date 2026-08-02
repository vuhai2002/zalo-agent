import { env } from "./config/env.js";
import { getEffectiveLlmSettings } from "./config/runtime-llm-settings.js";
import { closeHistoryStore } from "./conversation/history-store.js";
import { startMediaCleanupSchedule } from "./conversation/media-store.js";
import { startScheduler, stopScheduler } from "./scheduler/scheduler-loop.js";
import { startDashboardServer, stopDashboardServer } from "./server/dashboard-server.js";
import { createLogger } from "./shared/logger.js";
import { startTempFileCleanupSchedule } from "./shared/temp-file-store.js";
import { startAllAccounts, stopAllAccounts } from "./zalo/account-manager.js";

// Vòng đời tiến trình cũng cần scope: không có thì badge scope trên trang Logs
// trống trơn và KHÔNG LỌC ĐƯỢC - đúng lúc cần nhất là khi có uncaughtException
const logger = createLogger("bootstrap");

logger.info(
  { nodeEnv: env.NODE_ENV, provider: env.LLM_PROVIDER, model: env.LLM_MODEL },
  "Khởi động zalo-agent",
);

// Thiếu API key không chặn boot (nhập được ở dashboard) nhưng phải nói rõ, nếu
// không thì im lặng tới lúc có tin nhắn đầu tiên mới lộ ra
{
  const llm = getEffectiveLlmSettings();
  const thieu = [!llm.apiKey && "API key", !llm.model && "model"].filter(Boolean);
  if (thieu.length > 0) {
    logger.warn(
      `Chưa cấu hình LLM (thiếu ${thieu.join(" và ")}) - bot sẽ không trả lời được. Nhập ở trang Providers trên dashboard.`,
    );
  }
}

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Đang tắt zalo-agent...");
  stopScheduler();
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

/**
 * Heartbeat: xác nhận process còn sống trong log, cho những khoảng bot rảnh
 * hàng giờ không có tin nhắn nào.
 *
 * Nhịp 15 phút chứ không phải 1 phút, và có scope riêng. Bản cũ để 1 phút với
 * lập luận "debug level nên prod không noise" - lập luận đó VỠ khi log bắt đầu
 * ghi ra file ở mức trace: đo trên file thật, heartbeat chiếm 32% số dòng và tỉ
 * lệ đó còn tăng khi bot rảnh (1440 dòng/ngày trên vài trăm dòng thật).
 * Scope riêng để lọc nó ra khỏi trang Logs khi cần.
 */
const heartbeatLog = createLogger("heartbeat");
setInterval(() => heartbeatLog.debug("còn sống"), 15 * 60_000).unref();

// Dọn ảnh nhận được đã quá MEDIA_RETENTION_DAYS (chạy ngay + mỗi 24h)
startMediaCleanupSchedule();
// Dọn file tạm mồ côi của tool send_file (process bị kill giữa lượt gửi)
startTempFileCleanupSchedule();

startDashboardServer();
startAllAccounts()
  // Scheduler cần account đã sẵn sàng để lấy api lúc dispatch - khởi động SAU,
  // không phải song song. SCHEDULER_ENABLED=false thì hàm này tự no-op.
  .then(() => startScheduler())
  .catch((err) => {
    logger.fatal({ err }, "Khởi động thất bại");
    process.exit(1);
  });
