import { env } from "../config/env.js";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";

/**
 * Gộp các tin nhắn đến gần nhau trong cùng 1 thread thành 1 lượt agent.
 *
 * Giải quyết 2 vấn đề:
 * 1. Zalo tách ảnh và caption thành 2 tin riêng - xử lý rời sẽ khiến lượt hỏi
 *    "ảnh này là gì" không nhìn thấy ảnh.
 * 2. Xử lý song song gây race: lượt sau đọc history trước khi lượt trước ghi
 *    câu trả lời, dẫn tới trả lời mâu thuẫn nhau.
 *
 * Cách hoạt động: tin đến thì chờ `debounceMs`; có tin mới cùng thread trong lúc
 * chờ thì gộp vào và reset đồng hồ. Hết chờ mới chạy 1 lượt agent duy nhất, và
 * các lượt của cùng thread luôn chạy tuần tự (không chồng lấn).
 */
export type BatchHandler = (batch: ParsedMessage[]) => Promise<void>;

type PendingBatch = {
  messages: ParsedMessage[];
  timer: NodeJS.Timeout;
};

const pending = new Map<string, PendingBatch>();
// Đảm bảo mỗi thread chỉ có tối đa 1 lượt agent đang chạy
const threadChains = new Map<string, Promise<unknown>>();

export function enqueueMessage(
  threadKey: string,
  message: ParsedMessage,
  handler: BatchHandler,
  debounceMs = env.MESSAGE_BATCH_DEBOUNCE_MS,
): void {
  const existing = pending.get(threadKey);

  if (existing) {
    clearTimeout(existing.timer);
    existing.messages.push(message);
    existing.timer = setTimeout(() => flush(threadKey, handler), debounceMs);
    return;
  }

  pending.set(threadKey, {
    messages: [message],
    timer: setTimeout(() => flush(threadKey, handler), debounceMs),
  });
}

function flush(threadKey: string, handler: BatchHandler): void {
  const batch = pending.get(threadKey);
  if (!batch) return;
  pending.delete(threadKey);

  const previous = threadChains.get(threadKey) ?? Promise.resolve();
  const run = previous.then(() => handler(batch.messages));
  threadChains.set(
    threadKey,
    run.catch(() => undefined),
  );
}

/** Hủy toàn bộ tin đang chờ - dùng khi shutdown để không treo process */
export function clearPendingBatches(): void {
  for (const batch of pending.values()) {
    clearTimeout(batch.timer);
  }
  pending.clear();
}
