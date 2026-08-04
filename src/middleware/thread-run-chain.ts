/**
 * Xâu các lần chạy của CÙNG một thread thành hàng nối tiếp: lượt sau chờ lượt
 * trước xong hẳn rồi mới bắt đầu.
 *
 * Chống race lượt sau đọc history trước khi lượt trước ghi câu trả lời xong -
 * hai lượt chồng nhau sẽ trả lời mâu thuẫn nhau.
 *
 * Tách khỏi `message-batcher.ts` vì đây là nguyên thủy dùng CHUNG, không dính
 * gì tới việc gộp tin: `proactive-send-guard.ts` (job lịch hẹn) giữ khoá này
 * mà không hề đi qua bộ gộp. Dựng hàng đợi thứ hai song song cho scheduler sẽ
 * mất tác dụng chống race, nên hai bên phải dùng chung đúng một cái khoá.
 *
 * Module này KHÔNG biết gì về batch. Nó chỉ bắn `khiThreadRanh` mỗi khi một
 * lần chạy kết thúc; ai quan tâm thì tự đăng ký. Nhờ vậy phụ thuộc đi một
 * chiều: bộ gộp biết về khoá, còn khoá không biết về bộ gộp.
 */

const threadChains = new Map<string, Promise<unknown>>();

/** Các hàm muốn được gọi khi một lần chạy của thread kết thúc */
const nguoiChoRanh: ((threadKey: string) => void)[] = [];

/**
 * Đăng ký hàm chạy mỗi khi một lần chạy trên `threadKey` kết thúc.
 *
 * Gọi lúc nạp module, không gỡ ra được - danh sách này cố định theo thiết kế
 * chứ không phải hàng đăng ký động, nên không cần đường hủy.
 */
export function khiThreadRanh(fn: (threadKey: string) => void): void {
  nguoiChoRanh.push(fn);
}

/** Thread có lần chạy nào đang giữ khoá không */
export function dangBanThread(threadKey: string): boolean {
  return threadChains.has(threadKey);
}

/**
 * Chờ lượt trước của `threadKey` xong rồi mới chạy `fn`.
 *
 * Generic để caller lấy lại được kết quả thật của `fn` (vd `ReplyResult`).
 */
export function runOnThreadChain<T>(threadKey: string, fn: () => Promise<T>): Promise<T> {
  const previous = threadChains.get(threadKey) ?? Promise.resolve();
  const run = previous.then(fn);

  // Xóa entry khi thread chạy xong: Map này sống suốt đời process, giữ lại một
  // promise đã settled cho mỗi thread từng nhắn/từng có job là rò rỉ bộ nhớ chậm.
  let tail: Promise<unknown>;
  const release = (): void => {
    if (threadChains.get(threadKey) === tail) threadChains.delete(threadKey);
    // Bắn VÔ ĐIỀU KIỆN, kể cả khi entry trên không phải của mình: lượt khác đã
    // chồng lên thì thread vẫn bận, và bên nghe tự kiểm lại rồi chờ tiếp. Bắn
    // thừa một lần còn hơn bỏ sót một lần - bỏ sót thì batch đang đỗ nằm lại
    // vĩnh viễn và người nhắn không bao giờ được trả lời.
    //
    // Gắn ở CẢ hai nhánh của `then` nên `fn` ném lỗi cũng vẫn nhả khoá.
    for (const fnRanh of nguoiChoRanh) fnRanh(threadKey);
  };
  tail = run.then(release, release);
  threadChains.set(threadKey, tail);

  return run;
}

/** Số entry còn sống - dùng cho test rò rỉ bộ nhớ */
export function soThreadDangChay(): number {
  return threadChains.size;
}
