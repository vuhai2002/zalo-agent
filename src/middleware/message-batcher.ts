import type { ParsedMessage } from "../zalo/zalo-message-parser.js";
import { getTuning } from "../config/runtime-tuning-settings.js";
import { createLogger } from "../shared/logger.js";
import { dangBanThread, khiThreadRanh, runOnThreadChain, soThreadDangChay } from "./thread-run-chain.js";

/**
 * Gộp các tin nhắn đến gần nhau CỦA CÙNG MỘT NGƯỜI thành 1 lượt agent.
 *
 * "Cùng một người" chứ không phải "cùng một thread": xem khối doc của `pending`
 * bên dưới. Trong nhóm, mỗi người có hàng chờ riêng và lượt riêng.
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
  /**
   * Khóa KHOÁ của thread. Khác khóa của Map (`khoaGop`, có thêm người gửi):
   * gộp tin thì theo TỪNG NGƯỜI, còn chống race lịch sử thì theo cả THREAD.
   */
  threadKey: string;
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

/**
 * Hàng chờ gộp, khóa theo `(thread, NGƯỜI GỬI)` chứ không theo thread.
 *
 * Lý do gộp vốn là gộp tin của MỘT người: Zalo tách ảnh và chú thích thành hai
 * tin, người ta gõ thêm vài câu làm rõ ý. Gộp theo thread thì trong nhóm hai
 * người cùng @mention bot trong một nhịp sẽ chung một lượt, và bot trả một câu
 * cho cả hai - không ai biết câu đó dành cho ai.
 *
 * Cả Hermes lẫn goclaw đều một-tin-một-lượt (goclaw còn cho 3 run song song
 * trong nhóm). Bộ gộp theo thread của mình là chỗ khác biệt, và nó chỉ đúng
 * cho phần "một người nhắn nhiều tin".
 *
 * Khóa KHOÁ vẫn theo thread: chống race lịch sử là chuyện của cả cuộc trò
 * chuyện, không phải của từng người.
 */
const pending = new Map<string, PendingBatch>();

/** Khóa gộp: mỗi người trong một thread có hàng chờ riêng */
function khoaGopCua(threadKey: string, senderId: string): string {
  return `${threadKey}:${senderId}`;
}

/**
 * Nhận 1 tin vào hàng gộp.
 *
 * Trả `false` khi tin BỊ BỎ vì chạm trần. Tin đó không bao giờ tới
 * `processBatch`, nên caller phải tự lo phần việc mà lượt agent lẽ ra làm hộ.
 *
 * Từ khi tin được ghi vào lịch sử NGAY LÚC NHẬN
 * (`record-incoming-message.ts`), phần việc đó rút xuống còn TẢI ẢNH - lịch sử
 * đã có tin rồi. Trước đây `processBatch` là nơi DUY NHẤT ghi history cho nhánh
 * có-trả-lời nên bỏ qua giá trị này là mất hẳn tin.
 */
export function enqueueMessage(
  threadKey: string,
  message: ParsedMessage,
  handler: BatchHandler,
  debounceMs = getTuning("MESSAGE_BATCH_DEBOUNCE_MS"),
): boolean {
  const khoaGop = khoaGopCua(threadKey, message.senderId);
  const existing = pending.get(khoaGop);

  if (existing) {
    if (existing.messages.length >= TRAN_TIN_DON) {
      existing.soTinBoQua++;
      // Log ĐÚNG MỘT lần cho mỗi lần chạm trần, không phải mỗi tin bị bỏ: lượt
      // treo 15 phút cộng một nhóm đang nói chuyện sôi nổi sẽ đẻ ra hàng trăm
      // dòng WARN cho cùng một sự kiện, đẩy trôi mất chính phần log đang cần
      // đọc. Tổng số tin bị bỏ ghi lại một lần lúc chốt batch.
      if (existing.soTinBoQua === 1) {
        log.warn(
          { threadKey, nguoiGui: message.senderId, dangCho: existing.messages.length },
          "Hàng chờ gộp tin đã chạm trần - BỎ tin mới kể từ đây. Lượt đang chạy nhiều khả năng bị treo.",
        );
      }
      return false;
    }
    if (existing.timer) clearTimeout(existing.timer);
    existing.messages.push(message);
    existing.handler = handler;
    existing.timer = setTimeout(() => flush(khoaGop), debounceMs);
    return true;
  }

  pending.set(khoaGop, {
    threadKey,
    messages: [message],
    handler,
    soTinBoQua: 0,
    timer: setTimeout(() => flush(khoaGop), debounceMs),
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
function flush(khoaGop: string): void {
  const batch = pending.get(khoaGop);
  if (!batch) return;

  batch.timer = null;
  // Khoá theo THREAD chứ không theo khóa gộp: hai người trong cùng nhóm có hai
  // hàng chờ riêng nhưng vẫn dùng chung một cuộc trò chuyện, nên lượt của họ
  // phải nối tiếp nhau để không đọc lịch sử chồng lên nhau
  if (dangBanThread(batch.threadKey)) return; // `danhThucHangCho` sẽ gọi lại khi thread rảnh

  pending.delete(khoaGop);
  if (batch.soTinBoQua > 0) {
    log.warn(
      { threadKey: batch.threadKey, soTinBoQua: batch.soTinBoQua, soTinChay: batch.messages.length },
      "Chốt batch chạm trần - số tin bị bỏ khỏi lượt này (vẫn được ghi vào history)",
    );
  }
  void runOnThreadChain(batch.threadKey, () => batch.handler(batch.messages));
}

/**
 * Lấy hết tin đang ĐỖ của CHÍNH NGƯỜI đang được trả lời và xóa khỏi hàng chờ.
 *
 * Dùng cho đường tiêm tin giữa lượt (`mid-turn-injection.ts`): lượt đang chạy
 * tự kéo tin mới vào thay vì để chúng nằm đợi thành một lượt nữa.
 *
 * Theo NGƯỜI GỬI chứ không theo cả thread: từ khi mỗi người có hàng chờ riêng,
 * tin của người khác trong nhóm sẽ có lượt riêng của họ - kéo vào đây là vừa
 * cướp mất lượt đó vừa trộn hai câu hỏi làm một.
 *
 * Trả rỗng khi cụm tin CÒN ĐANG GÕ DỞ (`timer` chưa hết). Cùng một bất biến
 * với `danhThucHangCho`: chưa im lặng đủ thì chưa ai được đụng vào batch. Kéo
 * sớm sẽ cắt đôi đúng cụm tin người ta đang gõ - model nhận nửa câu rồi nửa
 * còn lại tới ở step sau, tệ hơn là cứ để nguyên.
 *
 * KHÔNG cần kiểm thread có bận hay không: chỉ lượt đang chạy mới gọi hàm này,
 * mà nó chạy được nghĩa là nó đang giữ khoá.
 */
export function layTinDangDo(threadKey: string, senderId: string): ParsedMessage[] {
  const khoaGop = khoaGopCua(threadKey, senderId);
  const batch = pending.get(khoaGop);
  if (!batch || batch.timer) return [];

  pending.delete(khoaGop);
  if (batch.soTinBoQua > 0) {
    log.warn(
      { threadKey, nguoiGui: senderId, soTinBoQua: batch.soTinBoQua, soTinChen: batch.messages.length },
      "Tin chen giữa lượt lấy từ hàng chờ đã chạm trần - số tin bị bỏ (vẫn được ghi vào history)",
    );
  }
  return batch.messages;
}

/**
 * id các dòng lịch sử của MỌI tin đang chờ trong thread, bất kể người gửi.
 *
 * Lượt agent dùng để loại chúng khỏi phần lịch sử của mình. Tin đã được ghi vào
 * lịch sử NGAY LÚC NHẬN, nên tin còn đang chờ vẫn hiện ra trong `getRecentMessages`
 * dù chưa lượt nào xử lý.
 *
 * PHẠM VI THREAD chứ không phải người gửi - và đây là chỗ đã đo sai một lần.
 * Lý lẽ "chỉ loại những tin mà lượt này SẼ chèn lại" nghe chắc nhưng sai: tin
 * đang chờ của NGƯỜI KHÁC vào prompt như một câu hỏi chưa ai trả lời, model trả
 * lời luôn cả câu đó, rồi lượt của người kia chạy và trả lời lần nữa. Đo thật
 * trên prompt lượt 1 khi Hải và Nam cùng @mention trong một nhịp:
 *
 *   user: [08/08 00:12] Nam: Nam hỏi tỉ giá     <- đang chờ, lọt vào như lịch sử
 *   user: [08/08 00:12] Hải: Hải hỏi giá vàng   <- nội dung lượt hiện tại
 *
 * Nhóm ba người cùng hỏi là bot bắn ba tin, trong đó hai câu trả lời trùng nội
 * dung - đúng cái nhiễu mà việc gộp theo người sinh ra để dẹp, cộng ba lần
 * token và ba lần gọi API không chính thức.
 *
 * Tin của người khác chỉ vắng mặt TẠM: chốt batch xong nó thành lịch sử thật và
 * mọi lượt sau đều thấy.
 *
 * `layTinDangDo` thì ngược lại, giữ phạm vi NGƯỜI GỬI - nó LẤY tin đi, mà lấy
 * của người khác là cướp mất lượt của họ. Hai hàm cố ý khác phạm vi.
 *
 * KHÔNG đụng tới hàng chờ: chỉ đọc. Cũng cố ý không dùng điều kiện "còn gõ dở"
 * của `layTinDangDo` - tin đang gõ dở cũng chưa thuộc lịch sử của lượt này.
 */
export function idTinDangCho(threadKey: string): number[] {
  const id: number[] = [];
  for (const batch of pending.values()) {
    if (batch.threadKey !== threadKey) continue;
    for (const m of batch.messages) {
      if (m.historyRowId !== undefined) id.push(m.historyRowId);
    }
  }
  return id;
}

/**
 * Thread vừa rảnh: chạy MỌI batch đang đỗ của thread đó (nếu có).
 *
 * Duyệt cả Map chứ không tra một khóa: một thread nay có nhiều hàng chờ, mỗi
 * người một cái. Nhóm ba người cùng nhắn lúc bot đang bận là ba batch cùng đỗ;
 * bỏ sót cái nào thì người đó không bao giờ được trả lời.
 *
 * Thực tế chỉ batch ĐẦU TIÊN chạy được: `runOnThreadChain` đặt khoá NGAY và
 * đồng bộ, nên vòng kế tiếp thấy thread bận và `flush` đỗ lại. Những cái còn
 * lại được đánh thức lần lượt, mỗi lần một cái, nhờ `release` của lượt trước
 * bắn hook này. Vòng lặp vẫn giữ vì nó không sai và vì đợt cho chạy song song
 * sau này sẽ dùng đúng nó - nhưng đừng đọc nó như một phép fan-out.
 *
 * Thứ tự chạy là thứ tự chèn Map, tức thứ tự tin ĐẦU TIÊN của mỗi người tới.
 *
 * Còn timer nghĩa là người ta vẫn đang gõ dở một cụm tin - để timer tự lo, đừng
 * cướp cò. Nhờ vậy bất biến "chưa im lặng đủ `debounceMs` thì chưa chạy lượt"
 * đúng cho cả đường bận lẫn đường rảnh, không phải hai luật khác nhau.
 */
function danhThucHangCho(threadKey: string): void {
  // Chụp danh sách TRƯỚC khi flush: `flush` xóa khỏi Map, sửa Map trong lúc
  // đang duyệt nó là mảnh đất của lỗi bỏ sót
  const canChay = [...pending.entries()]
    .filter(([, b]) => b.threadKey === threadKey && b.timer === null)
    .map(([khoa]) => khoa);
  for (const khoa of canChay) flush(khoa);
}

khiThreadRanh(danhThucHangCho);

// Re-export để `proactive-send-guard.ts`, test và mọi call site cũ vẫn import
// từ "message-batcher.js" như trước.
export { runOnThreadChain };

/**
 * Tổng số entry còn sống trong hai Map - dùng cho test rò rỉ bộ nhớ.
 *
 * KHÔNG phải "số thread": hàng chờ nay khóa theo `(thread, người gửi)` nên một
 * nhóm ba người cùng nhắn đếm thành ba, và một thread vừa có batch đang đỗ vừa
 * đang chạy lượt còn được đếm thêm lần nữa. Điều đó không sao với công dụng
 * thật của hàm (bằng 0 nghĩa là đã dọn sạch), nhưng đừng đọc con số này như số
 * hội thoại đang hoạt động.
 */
export function activeThreadCount(): number {
  return pending.size + soThreadDangChay();
}

/**
 * Hủy tin đang chờ của ĐÚNG một thread. Dùng khi xóa sạch ngữ cảnh thread đó.
 *
 * Không có bước này thì xóa xong, cái batch đang đỗ trong hàng chờ vẫn chạy
 * tiếp: bot trả lời một câu hỏi thuộc ngữ cảnh vừa bị dọn, và câu trả lời đó
 * ghi ngược vào lịch sử trống - người dùng bấm xóa rồi vẫn thấy tin xuất hiện
 * lại, không hiểu vì sao. (Tin của NGƯỜI DÙNG thì đã vào lịch sử từ lúc nhận
 * nên chính lệnh xóa đã dọn nó đi rồi.)
 *
 * KHÔNG đụng tới lượt đang CHẠY: cắt ngang giữa chừng thì tool đang gửi file
 * hay đang vẽ ảnh bị bỏ dở, mà lượt đó vẫn ghi kết quả lúc kết thúc. Lượt đang
 * chạy tự kết thúc rồi thôi; chỗ này chỉ chặn phần chưa bắt đầu.
 */
export function huyBatchCuaThread(threadKey: string): number {
  // Duyệt cả Map: một thread nay có nhiều hàng chờ, mỗi người một cái. Hủy đúng
  // một khóa là bỏ sót tin của những người còn lại trong nhóm, và chúng vẫn
  // chạy tiếp trên ngữ cảnh vừa bị dọn.
  let soTin = 0;
  for (const [khoa, batch] of [...pending.entries()]) {
    if (batch.threadKey !== threadKey) continue;
    if (batch.timer) clearTimeout(batch.timer);
    pending.delete(khoa);
    soTin += batch.messages.length;
  }
  return soTin;
}

/** Hủy toàn bộ tin đang chờ - dùng khi shutdown để không treo process */
export function clearPendingBatches(): void {
  for (const batch of pending.values()) {
    if (batch.timer) clearTimeout(batch.timer);
  }
  pending.clear();
}
