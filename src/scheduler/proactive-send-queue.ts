/**
 * Hàng đợi rải đều TOÀN CỤC giữa các tin CHỦ ĐỘNG (`SCHEDULER_SEND_GAP_MS`) -
 * khác `middleware/rate-limiter.ts` hiện có vốn chỉ xếp hàng TRONG một
 * thread. Tách khỏi `proactive-send-guard.ts` (giữ phần kiểm điều kiện) để
 * file đó không vượt ngưỡng 200 dòng.
 *
 * KHÔNG có timeout ở tầng này (có ở bản trước, rồi bỏ hẳn): timeout bọc NGOÀI
 * `runOnThreadChain` chặn đúng CHỖ SAI - nó bọc luôn cả lúc CHỜ khoá thread,
 * mà khoá đó có thể bị 1 lượt agent CỦA NGƯỜI DÙNG giữ hàng phút
 * (`LLM_TURN_TIMEOUT_MS` mặc định 900000ms) - hoàn toàn BÌNH THƯỜNG, không
 * phải treo. Khi timeout bắn, việc BÊN TRONG vẫn tiếp tục chạy không ai huỷ
 * được (Promise JS không cancel), nên tin vẫn ra Zalo nhưng: không tính vào
 * trần (thiếu đếm - còn nguy hiểm hơn thừa đếm), sổ chạy ghi 'error' dù gửi
 * thật thành công, và (kind='agent') usage thật bị đè bằng {0,0,0}. Chặn
 * trên cho lượt gửi thật (nếu vẫn muốn) phải bọc SÁT bên trong
 * `runOnThreadChain`, quanh ĐÚNG bước gửi - không bọc lúc chờ lượt. Undici
 * (zca-js) đã có headersTimeout/bodyTimeout ~300s mỗi request là chặn trên đủ dùng.
 */

import { getTuning } from "../config/runtime-tuning-settings.js";
import { runOnThreadChain } from "../middleware/message-batcher.js";

let queueTail: Promise<unknown> = Promise.resolve();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Xếp 1 việc vào hàng đợi TOÀN CỤC, cách nhau `SCHEDULER_SEND_GAP_MS`. Chỉ lo
 * phần THỜI ĐIỂM - không tự vào xâu thread nào (xem `deliverProactively` bên
 * dưới, đó mới là chỗ THẬT SỰ dùng hàm này để gửi).
 */
export function enqueueProactiveSend<T>(task: () => Promise<T>): Promise<T> {
  const run = queueTail.then(async () => {
    await sleep(getTuning("SCHEDULER_SEND_GAP_MS"));
    return task();
  });
  // Giữ hàng đợi sống dù task lỗi hay thành công - lỗi của task này vẫn trả
  // đúng ra cho caller qua `run`, chỉ riêng "đuôi hàng đợi" không vỡ theo.
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
 * ĐẢO NGƯỢC thứ tự lồng so với thiết kế ban đầu: xâu thread NGOÀI, hàng đợi
 * toàn cục TRONG khiến 1 job đang chờ hàng đợi toàn cục giữ luôn khoá thread
 * của chính nó - tin nhắn THẬT của người dùng trên CHÍNH thread đó phải xếp
 * hàng chờ theo, có thể tới hàng phút nếu hàng đợi sâu. Giờ hàng đợi toàn cục
 * bọc NGOÀI: chờ ở đây không đụng gì tới thread nào cả, chỉ khi TỚI LƯỢT mới
 * xin vào xâu thread - cửa sổ giữ khoá co lại còn đúng thời gian gửi thật.
 */
export function deliverProactively<T>(threadKey: string, fn: () => Promise<T>): Promise<T> {
  return enqueueProactiveSend(() => runOnThreadChain(threadKey, fn));
}
