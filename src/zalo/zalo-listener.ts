import type { API } from "zca-js";
import { createLogger } from "../shared/logger.js";

export type RawMessageHandler = (rawMessage: unknown) => Promise<void> | void;

const MAX_RECONNECT_DELAY_MS = 60_000;

/**
 * Start listener cho 1 account, tự reconnect với backoff khi bị đóng.
 * Lưu ý: Zalo chỉ cho 1 web listener/account - mở Zalo Web trên trình duyệt
 * sẽ đá listener này ra (bot sẽ tự reconnect và đá ngược lại phiên web).
 * Trả về hàm stop() để shutdown sạch.
 */
export function startListener(
  accountId: string,
  api: API,
  onMessage: RawMessageHandler,
): () => void {
  const log = createLogger(`listener:${accountId}`);
  let stopped = false;
  let reconnectAttempts = 0;

  api.listener.on("message", (message) => {
    Promise.resolve(onMessage(message)).catch((err) =>
      log.error({ err }, "Lỗi xử lý tin nhắn"),
    );
  });

  api.listener.onConnected(() => {
    reconnectAttempts = 0;
    log.info("Listener đã kết nối");
  });

  api.listener.onError((error: unknown) => {
    log.error({ error }, "Listener báo lỗi");
  });

  api.listener.onClosed(() => {
    if (stopped) return;
    const backoff = Math.min(MAX_RECONNECT_DELAY_MS, 2 ** reconnectAttempts * 1000);
    const delay = backoff + Math.floor(Math.random() * 1000);
    reconnectAttempts += 1;
    log.warn({ attempt: reconnectAttempts, delayMs: delay }, "Listener bị đóng - sẽ kết nối lại");

    setTimeout(() => {
      if (stopped) return;
      try {
        api.listener.stop(); // đảm bảo state sạch trước khi start lại
        api.listener.start();
      } catch (err) {
        log.error({ err }, "Reconnect thất bại - chờ lần onClosed kế tiếp");
      }
    }, delay);
  });

  api.listener.start();

  return () => {
    stopped = true;
    try {
      api.listener.stop();
    } catch {
      /* đã đóng sẵn */
    }
  };
}
