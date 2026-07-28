import { getTuning } from "../config/runtime-tuning-settings.js";

// Gửi tuần tự theo từng thread + delay ngẫu nhiên trước mỗi lần gửi.
// Mục đích: hành vi giống người, giảm nguy cơ Zalo đánh dấu spam.

const queues = new Map<string, Promise<unknown>>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function randomSendDelay(): number {
  const range = getTuning("SEND_DELAY_MAX_MS") - getTuning("SEND_DELAY_MIN_MS");
  return getTuning("SEND_DELAY_MIN_MS") + Math.floor(Math.random() * (range + 1));
}

export function enqueueSend<T>(threadKey: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(threadKey) ?? Promise.resolve();
  const run = previous.then(async () => {
    await sleep(randomSendDelay());
    return task();
  });

  // Giữ queue sống kể cả khi task lỗi (lỗi vẫn ném về caller của run). Xóa entry
  // khi thread gửi xong hết: bot thường trú gặp hàng nghìn thread, giữ lại mỗi
  // thread 1 promise đã settled là rò rỉ bộ nhớ chậm.
  let tail: Promise<unknown>;
  const release = (): void => {
    if (queues.get(threadKey) === tail) queues.delete(threadKey);
  };
  tail = run.then(release, release);
  queues.set(threadKey, tail);

  return run;
}

/** Số thread đang có việc gửi - dùng cho test rò rỉ bộ nhớ */
export function pendingSendThreadCount(): number {
  return queues.size;
}
