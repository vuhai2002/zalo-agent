import type { ThreadType } from "zca-js";
import { env } from "../config/env.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("typing-indicator");

/** Hàm bắn 1 event "đang nhập" - tách ra để test không cần zca-js thật */
export type TypingSender = (threadId: string, threadType: ThreadType) => Promise<unknown>;

export type TypingIndicatorParams = {
  send: TypingSender;
  threadId: string;
  threadType: ThreadType;
  intervalMs?: number;
  /** Chốt chặn: tự tắt sau ngần này kể cả caller quên gọi stop */
  maxDurationMs?: number;
};

const DEFAULT_MAX_DURATION_MS = 2 * 60_000;

/**
 * Giữ chỉ báo "đang nhập" trong suốt lượt xử lý.
 *
 * Zalo KHÔNG có API tắt chỉ báo (đã rà hết zca-js/src/apis) - nó tự hết sau
 * vài giây, nên phải bắn lặp lại. Trả về hàm stop, caller BẮT BUỘC gọi trong
 * finally. Lỗi khi bắn bị nuốt: chỉ báo hỏng không được làm chết lượt trả lời.
 */
export function startTypingIndicator({
  send,
  threadId,
  threadType,
  intervalMs = env.TYPING_REFRESH_MS,
  maxDurationMs = DEFAULT_MAX_DURATION_MS,
}: TypingIndicatorParams): () => void {
  let stopped = false;

  const swallow = (err: unknown) => log.debug({ threadId, err }, "Bắn typing thất bại - bỏ qua");

  const tick = () => {
    if (stopped) return;
    // Gọi thẳng (không bọc Promise.resolve) để lần đầu bắn ngay, không lùi
    // sang microtask; try/catch lo trường hợp send ném lỗi đồng bộ
    try {
      void send(threadId, threadType).catch(swallow);
    } catch (err) {
      swallow(err);
    }
  };

  tick(); // bắn ngay, không đợi hết chu kỳ đầu

  const timer = setInterval(tick, intervalMs);
  const guard = setTimeout(() => {
    log.warn({ threadId }, "Typing chạy quá lâu - tự tắt");
    stop();
  }, maxDurationMs);

  // unref để chỉ báo không giữ process sống lúc shutdown
  timer.unref?.();
  guard.unref?.();

  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    clearTimeout(guard);
  }

  return stop;
}
