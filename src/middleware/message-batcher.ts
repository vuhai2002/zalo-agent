import type { ParsedMessage } from "../zalo/zalo-message-parser.js";
import { getTuning } from "../config/runtime-tuning-settings.js";
import { createLogger } from "../shared/logger.js";
import { dangBanThread, khiThreadRanh, runOnThreadChain, soThreadDangChay } from "./thread-run-chain.js";

/**
 * Gộp các tin nhắn đến gần nhau trong cùng 1 thread thành 1 lượt agent.
 *
 * Giải quyết 3 vấn đề:
 * 1. Zalo tách ảnh và caption thành 2 tin riêng - xử lý rời sẽ khiến lượt hỏi
 *    "ảnh này là gì" không nhìn thấy ảnh.
 * 2. Xử lý song song gây race: lượt sau đọc history trước khi lượt trước ghi
 *    câu trả lời, dẫn tới trả lời mâu thuẫn nhau.
 * 3. Tin đến TRONG LÚC một lượt đang chạy không được tách thành lượt riêng.
 *
 * Một batch chỉ được chốt khi CẢ HAI điều kiện cùng đúng:
 *   (a) đã im lặng đủ `debounceMs` kể từ tin cuối, VÀ
 *   (b) không còn ai đang GIỮ KHOÁ thread (`thread-run-chain.ts`).
 *
 * (b) nói về khoá, không phải về "mọi lượt agent". Lượt agent theo LỊCH cố ý
 * chạy NGOÀI khoá này (`scheduler-loop.ts` không bọc `runOnThreadChain` - xem
 * doc đầu file đó, lý do là deadlock); chỉ bước GỬI của nó mới vào khoá qua
 * `deliverProactively`. Nên một job `kind='agent'` đang chạy KHÔNG chặn lượt
 * chat khởi động. Chấp nhận được vì lượt lịch chạy `isolated: true` (không đọc
 * history) nên hai bên không giẫm lên ngữ cảnh của nhau, còn phần ghi history
 * và gửi thật thì vẫn nằm trong khoá. Đừng đọc (b) như một bảo đảm loại trừ
 * lẫn nhau giữa mọi lượt agent - nó không phải vậy.
 *
 * Bản đầu chỉ có điều kiện (a). Hệ quả đo được trên log thật ngày 2026-08-04:
 * một lượt tạo tài liệu chạy 249 giây; hai tin người dùng gửi trong lúc đó
 * thành HAI lượt agent riêng, mỗi lượt lại làm lại từ đầu toàn bộ web_search và
 * dựng lại tài liệu 18.000 ký tự. Cả hai lượt thừa đó đều chết vì timeout, và
 * người nhắn nhận hai tin báo lỗi giống hệt nhau.
 */
export type BatchHandler = (batch: ParsedMessage[]) => Promise<void>;

const log = createLogger("message-batcher");

/**
 * Trần số tin dồn vào MỘT batch. Lấy con số của Hermes
 * (`_BUSY_QUEUE_MAX_PENDING`, `gateway/run.py`).
 *
 * Vì sao phải có: lượt treo tới hết `LLM_TURN_TIMEOUT_MS` (mặc định 15 phút)
 * cộng một người gõ liên tục là mảng này phình không giới hạn.
 *
 * Trần này CHỈ chặn bộ nhớ, không chặn lượt chạy loạn: batch dù to vẫn là ĐÚNG
 * MỘT lượt agent, và phần input gửi model đã có `catNguCanhTheoNganSach` cắt
 * theo ngân sách token. Khác với Hermes - ở đó mỗi tin dồn là một LƯỢT riêng
 * nên trần của họ chặn cả số lần gọi model.
 */
export const TRAN_TIN_DON = 32;

type PendingBatch = {
  messages: ParsedMessage[];
  /**
   * `null` = đã hết thời gian chờ gộp, giờ chỉ còn đợi thread rảnh.
   *
   * Đây là toàn bộ máy trạng thái: có timer nghĩa là điều kiện (a) chưa xong
   * nên cứ để timer lo; hết timer mà batch vẫn nằm đây nghĩa là (a) xong rồi và
   * đang kẹt ở (b), lúc đó `danhThucHangCho` mới có việc để làm.
   */
  timer: NodeJS.Timeout | null;
  /**
   * Giữ handler MỚI NHẤT, không phải handler của tin đầu batch.
   *
   * `routeIncomingMessage` đọc lại `getAccount()` cho từng tin nên mỗi lần gọi
   * là một closure ôm cấu hình mới. Giữ closure cũ là lượt chạy bằng cấu hình
   * đã lỗi thời - sửa policy trên dashboard giữa chừng sẽ không ăn.
   */
  handler: BatchHandler;
  /** Số tin đã bị bỏ vì chạm trần - gộp lại báo một lần lúc chốt batch */
  soTinBoQua: number;
};

const pending = new Map<string, PendingBatch>();

/**
 * Nhận 1 tin vào hàng gộp.
 *
 * Trả `false` khi tin BỊ BỎ vì chạm trần. Caller PHẢI xử lý giá trị này: tin bị
 * bỏ không bao giờ tới `processBatch`, mà đó lại là nơi DUY NHẤT ghi history
 * cho nhánh có-trả-lời. Bỏ qua giá trị trả về nghĩa là tin biến mất khỏi cả
 * cuộc hội thoại lẫn trí nhớ của bot, trong khi người nhắn đã nhận dấu "đã
 * nhận" từ trước và đinh ninh bot có nghe.
 */
export function enqueueMessage(
  threadKey: string,
  message: ParsedMessage,
  handler: BatchHandler,
  debounceMs = getTuning("MESSAGE_BATCH_DEBOUNCE_MS"),
): boolean {
  const existing = pending.get(threadKey);

  if (existing) {
    if (existing.messages.length >= TRAN_TIN_DON) {
      existing.soTinBoQua++;
      // Log ĐÚNG MỘT lần cho mỗi lần chạm trần, không phải mỗi tin bị bỏ: lượt
      // treo 15 phút cộng một nhóm đang nói chuyện sôi nổi sẽ đẻ ra hàng trăm
      // dòng WARN cho cùng một sự kiện, đẩy trôi mất chính phần log đang cần
      // đọc. Tổng số tin bị bỏ ghi lại một lần lúc chốt batch.
      if (existing.soTinBoQua === 1) {
        log.warn(
          { threadKey, dangCho: existing.messages.length },
          "Hàng chờ gộp tin đã chạm trần - BỎ tin mới kể từ đây. Lượt đang chạy nhiều khả năng bị treo.",
        );
      }
      return false;
    }
    if (existing.timer) clearTimeout(existing.timer);
    existing.messages.push(message);
    existing.handler = handler;
    existing.timer = setTimeout(() => flush(threadKey), debounceMs);
    return true;
  }

  pending.set(threadKey, {
    messages: [message],
    handler,
    soTinBoQua: 0,
    timer: setTimeout(() => flush(threadKey), debounceMs),
  });
  return true;
}

/**
 * Hết thời gian chờ gộp. Chốt batch nếu thread rảnh, còn bận thì ĐỖ LẠI.
 *
 * Đỗ lại chứ không xếp hàng sau lượt đang chạy: xếp hàng là chốt cứng danh sách
 * tin ngay lúc này, nên tin tới sau đó không còn chỗ nào để gộp vào và lại đẻ
 * ra một lượt nữa - đúng cái hỏng cần chữa.
 */
function flush(threadKey: string): void {
  const batch = pending.get(threadKey);
  if (!batch) return;

  batch.timer = null;
  if (dangBanThread(threadKey)) return; // `danhThucHangCho` sẽ gọi lại khi thread rảnh

  pending.delete(threadKey);
  if (batch.soTinBoQua > 0) {
    log.warn(
      { threadKey, soTinBoQua: batch.soTinBoQua, soTinChay: batch.messages.length },
      "Chốt batch chạm trần - số tin bị bỏ khỏi lượt này (vẫn được ghi vào history)",
    );
  }
  void runOnThreadChain(threadKey, () => batch.handler(batch.messages));
}

/**
 * Lấy hết tin đang ĐỖ của thread và xóa khỏi hàng chờ.
 *
 * Dùng cho đường tiêm tin giữa lượt (`mid-turn-injection.ts`): lượt đang chạy
 * tự kéo tin mới vào thay vì để chúng nằm đợi thành một lượt nữa.
 *
 * Trả rỗng khi cụm tin CÒN ĐANG GÕ DỞ (`timer` chưa hết). Cùng một bất biến
 * với `danhThucHangCho`: chưa im lặng đủ thì chưa ai được đụng vào batch. Kéo
 * sớm sẽ cắt đôi đúng cụm tin người ta đang gõ - model nhận nửa câu rồi nửa
 * còn lại tới ở step sau, tệ hơn là cứ để nguyên.
 *
 * KHÔNG cần kiểm thread có bận hay không: chỉ lượt đang chạy mới gọi hàm này,
 * mà nó chạy được nghĩa là nó đang giữ khoá.
 */
export function layTinDangDo(threadKey: string): ParsedMessage[] {
  const batch = pending.get(threadKey);
  if (!batch || batch.timer) return [];

  pending.delete(threadKey);
  if (batch.soTinBoQua > 0) {
    log.warn(
      { threadKey, soTinBoQua: batch.soTinBoQua, soTinChen: batch.messages.length },
      "Tin chen giữa lượt lấy từ hàng chờ đã chạm trần - số tin bị bỏ (vẫn được ghi vào history)",
    );
  }
  return batch.messages;
}

/**
 * Thread vừa rảnh: chạy batch đang đỗ (nếu có).
 *
 * Còn timer nghĩa là người ta vẫn đang gõ dở một cụm tin - để timer tự lo, đừng
 * cướp cò. Nhờ vậy bất biến "chưa im lặng đủ `debounceMs` thì chưa chạy lượt"
 * đúng cho cả đường bận lẫn đường rảnh, không phải hai luật khác nhau.
 */
function danhThucHangCho(threadKey: string): void {
  const batch = pending.get(threadKey);
  if (!batch || batch.timer) return;
  flush(threadKey);
}

khiThreadRanh(danhThucHangCho);

// Re-export để `proactive-send-guard.ts`, test và mọi call site cũ vẫn import
// từ "message-batcher.js" như trước.
export { runOnThreadChain };

/**
 * Tổng số entry còn sống trong hai Map - dùng cho test rò rỉ bộ nhớ.
 *
 * KHÔNG phải "số thread": một thread vừa có batch đang đỗ vừa đang chạy lượt sẽ
 * được đếm HAI lần. Điều đó không sao với công dụng thật của hàm (bằng 0 nghĩa
 * là đã dọn sạch), nhưng đừng đọc con số này như số hội thoại đang hoạt động.
 */
export function activeThreadCount(): number {
  return pending.size + soThreadDangChay();
}

/**
 * Hủy tin đang chờ của ĐÚNG một thread. Dùng khi xóa sạch ngữ cảnh thread đó.
 *
 * Không có bước này thì xóa xong, cái batch đang đỗ trong hàng chờ vẫn chạy
 * tiếp và ghi ngược tin cũ vào lịch sử vừa dọn - người dùng bấm xóa rồi vẫn
 * thấy tin xuất hiện lại, không hiểu vì sao.
 *
 * KHÔNG đụng tới lượt đang CHẠY: cắt ngang giữa chừng thì tool đang gửi file
 * hay đang vẽ ảnh bị bỏ dở, mà lượt đó vẫn ghi kết quả lúc kết thúc. Lượt đang
 * chạy tự kết thúc rồi thôi; chỗ này chỉ chặn phần chưa bắt đầu.
 */
export function huyBatchCuaThread(threadKey: string): number {
  const batch = pending.get(threadKey);
  if (!batch) return 0;
  if (batch.timer) clearTimeout(batch.timer);
  pending.delete(threadKey);
  return batch.messages.length;
}

/** Hủy toàn bộ tin đang chờ - dùng khi shutdown để không treo process */
export function clearPendingBatches(): void {
  for (const batch of pending.values()) {
    if (batch.timer) clearTimeout(batch.timer);
  }
  pending.clear();
}
