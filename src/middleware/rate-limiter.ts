import { env } from "../config/env.js";

// Gửi tuần tự theo từng thread + delay ngẫu nhiên trước mỗi lần gửi.
// Mục đích: hành vi giống người, giảm nguy cơ Zalo đánh dấu spam.

const queues = new Map<string, Promise<unknown>>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function randomSendDelay(): number {
  const range = env.SEND_DELAY_MAX_MS - env.SEND_DELAY_MIN_MS;
  return env.SEND_DELAY_MIN_MS + Math.floor(Math.random() * (range + 1));
}

export function enqueueSend<T>(threadKey: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(threadKey) ?? Promise.resolve();
  const run = previous.then(async () => {
    await sleep(randomSendDelay());
    return task();
  });
  // Giữ queue sống kể cả khi task lỗi (lỗi vẫn ném về caller của run)
  queues.set(
    threadKey,
    run.catch(() => undefined),
  );
  return run;
}
