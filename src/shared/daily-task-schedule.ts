import { createLogger } from "./logger.js";

const log = createLogger("daily-task");
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Chạy 1 tác vụ dọn dẹp ngay lúc gọi rồi lặp lại mỗi 24h. Lỗi bị nuốt và log -
 * tác vụ dọn dẹp hỏng không được làm chết process bot.
 * `unref()` để interval không giữ event loop sống lúc shutdown.
 */
export function startDailyTask(label: string, task: () => void): void {
  const run = (): void => {
    try {
      task();
    } catch (err) {
      log.error({ label, err }, "Tác vụ định kỳ lỗi - bỏ qua lượt này");
    }
  };
  run();
  setInterval(run, ONE_DAY_MS).unref();
}
