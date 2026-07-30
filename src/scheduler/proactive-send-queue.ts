/**
 * Hàng đợi rải đều TOÀN CỤC giữa các tin CHỦ ĐỘNG (`SCHEDULER_SEND_GAP_MS`) -
 * khác `middleware/rate-limiter.ts` hiện có vốn chỉ xếp hàng TRONG một
 * thread. Tách khỏi `proactive-send-guard.ts` (giữ phần kiểm điều kiện) để
 * file đó không vượt ngưỡng 200 dòng.
 */

import { getTuning } from "../config/runtime-tuning-settings.js";
import { runOnThreadChain } from "../middleware/message-batcher.js";

let queueTail: Promise<unknown> = Promise.resolve();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Chặn TRÊN cho 1 phần tử trong hàng đợi - KHÔNG phải tham số chỉnh được từ
 * dashboard, chỉ để 1 lần gửi hỏng/treo không giữ hàng đợi TOÀN CỤC (mọi
 * account, mọi thread) mãi mãi. Rộng rãi hơn nhiều lần gửi bình thường
 * (SEND_DELAY_MAX_MS 2500ms x tối đa ZALO_MAX_MESSAGE_PARTS đoạn + thời gian
 * mạng thật). `let` (không phải `const`) chỉ để test đổi ngưỡng thấp xuống -
 * test thật không thể chờ 60 giây.
 */
let queueElementTimeoutMs = 60_000;

/** Chỉ dùng cho test - hạ ngưỡng timeout để không phải chờ 60 giây thật */
export function setQueueElementTimeoutForTest(ms: number): void {
  queueElementTimeoutMs = ms;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Gửi chủ động quá ${ms}ms - bỏ qua để hàng đợi toàn cục không bị kẹt theo`)),
      ms,
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e as Error);
      },
    );
  });
}

/**
 * Xếp 1 việc vào hàng đợi TOÀN CỤC, cách nhau `SCHEDULER_SEND_GAP_MS`. Chỉ lo
 * phần THỜI ĐIỂM - không tự vào xâu thread nào (xem `deliverProactively` bên
 * dưới, đó mới là chỗ THẬT SỰ dùng hàm này để gửi).
 */
export function enqueueProactiveSend<T>(task: () => Promise<T>): Promise<T> {
  const run = queueTail.then(async () => {
    await sleep(getTuning("SCHEDULER_SEND_GAP_MS"));
    return withTimeout(task(), queueElementTimeoutMs);
  });
  // Giữ hàng đợi sống dù task lỗi/treo hay thành công - lỗi của task này vẫn
  // trả đúng ra cho caller qua `run`, chỉ riêng "đuôi hàng đợi" không vỡ theo.
  queueTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Chỉ dùng cho test - đưa hàng đợi rải đều về trạng thái sạch giữa các ca test */
export function resetProactiveSendQueue(): void {
  queueTail = Promise.resolve();
}

/**
 * Gửi 1 tin CHỦ ĐỘNG đúng cách: chờ lượt ở hàng đợi TOÀN CỤC TRƯỚC (KHÔNG giữ
 * khoá thread trong lúc chờ), giành được lượt rồi mới vào xâu thread
 * (`runOnThreadChain`) để làm `fn` (gửi + ghi history).
 *
 * ĐẢO NGƯỢC thứ tự lồng so với thiết kế ban đầu (rà lại phát hiện: xâu thread
 * NGOÀI, hàng đợi toàn cục TRONG khiến 1 job đang chờ hàng đợi toàn cục giữ
 * luôn khoá thread của chính nó - tin nhắn THẬT của người dùng trên CHÍNH
 * thread đó phải xếp hàng chờ theo, có thể tới hàng phút nếu hàng đợi sâu).
 * Giờ hàng đợi toàn cục bọc NGOÀI: chờ ở đây không đụng gì tới thread nào cả,
 * chỉ khi TỚI LƯỢT mới xin vào xâu thread - cửa sổ giữ khoá co lại còn đúng
 * thời gian gửi thật.
 */
export function deliverProactively<T>(threadKey: string, fn: () => Promise<T>): Promise<T> {
  return enqueueProactiveSend(() => runOnThreadChain(threadKey, fn));
}
