import { createLogger } from "../shared/logger.js";
import { backfillContactsFromDirectMessages } from "./contact-store.js";
import { backfillThreadsFromMessages } from "./thread-store.js";

const log = createLogger("startup-backfill");

/**
 * Nâng cấp DB từ bản chưa có dashboard: dựng threads + contacts từ messages
 * sẵn có. Từng backfill tự bỏ qua nếu bảng đích đã có dữ liệu nên gọi mỗi lần
 * khởi động đều an toàn.
 */
export function runStartupBackfill(): void {
  const threads = backfillThreadsFromMessages();
  const contacts = backfillContactsFromDirectMessages();
  if (threads > 0 || contacts > 0) {
    log.info({ threads, contacts }, "Backfill threads/contacts từ messages cũ");
  }
}
