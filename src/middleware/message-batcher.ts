import type { ParsedMessage } from "../zalo/zalo-message-parser.js";
import { getTuning } from "../config/runtime-tuning-settings.js";

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
  debounceMs = getTuning("MESSAGE_BATCH_DEBOUNCE_MS"),
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
  void runOnThreadChain(threadKey, () => handler(batch.messages));
}

/**
 * Xâu 1 lần chạy vào ĐÚNG thread: chờ lượt trước của thread đó xong rồi mới
 * chạy `fn`, các lượt cùng thread không bao giờ chồng lấn (race lượt sau đọc
 * history trước khi lượt trước ghi xong).
 *
 * Tách ra dùng CHUNG cho cả 2 nguồn gọi: `flush` ở trên (tin nhắn tới) và
 * `proactive-send-guard.ts` (`deliverProactively` - job lịch hẹn CHỈ giữ khoá
 * này trong lúc gửi thật, không giữ suốt lúc chờ hàng đợi rải đều toàn cục) -
 * job và tin người dùng cùng thread cũng không được chồng nhau, cùng một lý
 * do. Dựng hàng đợi thứ hai song song cho scheduler sẽ mất tác dụng chống race
 * này. Generic để caller lấy lại được kết quả thật của `fn` (vd `ReplyResult`).
 */
export function runOnThreadChain<T>(threadKey: string, fn: () => Promise<T>): Promise<T> {
  const previous = threadChains.get(threadKey) ?? Promise.resolve();
  const run = previous.then(fn);

  // Xóa entry khi thread chạy xong: Map này sống suốt đời process, giữ lại một
  // promise đã settled cho mỗi thread từng nhắn/từng có job là rò rỉ bộ nhớ chậm.
  let tail: Promise<unknown>;
  const release = (): void => {
    if (threadChains.get(threadKey) === tail) threadChains.delete(threadKey);
  };
  tail = run.then(release, release);
  threadChains.set(threadKey, tail);

  return run;
}

/** Số thread đang chờ/đang chạy lượt agent - dùng cho test rò rỉ bộ nhớ */
export function activeThreadCount(): number {
  return pending.size + threadChains.size;
}

/** Hủy toàn bộ tin đang chờ - dùng khi shutdown để không treo process */
export function clearPendingBatches(): void {
  for (const batch of pending.values()) {
    clearTimeout(batch.timer);
  }
  pending.clear();
}
