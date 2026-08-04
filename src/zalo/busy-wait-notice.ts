import type { API } from "zca-js";
import type { ThreadType } from "zca-js";
import { getTuning } from "../config/runtime-tuning-settings.js";
import { dangGuiTren } from "../middleware/rate-limiter.js";
import { daBanBaoLau } from "../middleware/thread-run-chain.js";
import { createLogger } from "../shared/logger.js";
import { sendReplyInParts } from "./send-reply-in-parts.js";

/**
 * Nói một câu trấn an khi người ta nhắn vào lúc bot đã bận RẤT lâu.
 *
 * Vì sao hẹp như vậy chứ không báo bận mọi lúc: người nhắn đã có sẵn ba tín
 * hiệu - dấu "đang nhập..." chạy suốt lượt, biên nhận "đã xem", và reaction tự
 * động. Chồng thêm một tin text vào đó vừa là nhiễu, vừa tốn thêm một lượt gọi
 * API không chính thức mà `CLAUDE.md` dặn hạn chế.
 *
 * Tin nhắn thêm giữa lượt nhận đủ cả ba tín hiệu CHỈ KHI nó được kéo vào lượt
 * (`sendSeenReceipt` + `sendAutoReaction` nằm trong `layTinChen` của
 * `message-turn-processor.ts`). Lượt KHÔNG gọi tool chỉ có đúng một step nên
 * `prepareStep` chạy một lần ở đầu, lúc chưa ai kịp nhắn thêm - tin đỗ nguyên
 * tới hết lượt và chỉ có mỗi biên nhận "đã nhận" của router. Đó lại đúng là ca
 * sinh dài nhất (model viết thẳng một mạch), tức ca chờ lâu nhất.
 *
 * Khe hở thật nằm ở chỗ khác: `typing-indicator.ts` tự tắt sau 10 phút, còn
 * `LLM_TURN_TIMEOUT_MS` cho lượt chạy tới 15 phút. Khoảng giữa hai mốc đó là im
 * lặng hoàn toàn, và nó đã xảy ra thật - log 2026-08-04 lúc 12:21:22 ghi
 * "Typing chạy quá lâu - tự tắt", một phút sau lượt mới chết. Câu này lấp đúng
 * khoảng đó.
 */

const log = createLogger("busy-wait-notice");

export const CAU_TRAN_AN =
  "Mình vẫn đang xử lý yêu cầu trước, hơi lâu một chút. Tin của bạn mình nhận rồi, xong mình trả lời ngay nhé.";

/**
 * Lần cuối đã trấn an mỗi thread. Không nhắc lại trong cùng một quãng chờ - nói
 * hai lần cùng một câu chỉ làm người ta sốt ruột thêm.
 */
const lanTranAnCuoi = new Map<string, number>();

export type MucTieuTranAn = {
  api: API;
  threadKey: string;
  threadId: string;
  threadType: ThreadType;
};

/**
 * Gửi câu trấn an nếu đáng gửi. Trả `true` nếu đã gửi.
 *
 * Fire-and-forget ở call site: đây là việc phụ, không được làm chậm hay chặn
 * đường nhận tin.
 */
export async function maybeNotifyBusyWait(muc: MucTieuTranAn): Promise<boolean> {
  const nguong = getTuning("BUSY_ACK_AFTER_MS");
  if (nguong <= 0) return false;

  const daCho = daBanBaoLau(muc.threadKey);
  if (daCho === null || daCho < nguong) return false;

  // Thread đang có tin đi ra thì IM. `sendReplyInParts` xếp hàng từng đoạn một,
  // nên giữa hai đoạn hàng đợi rỗng và câu này chen được vào giữa một câu trả
  // lời đang cắt làm nhiều tin - lúc đó nội dung của nó ("vẫn đang xử lý") còn
  // sai sự thật vì bot đang GỬI chứ không còn đang xử lý. Cùng khe hở với
  // khoảng 60-135 giây giữa tin "đang vẽ ảnh" và ảnh thật của `create_image`.
  if (dangGuiTren(muc.threadKey)) {
    log.debug({ threadId: muc.threadId }, "Thread đang có tin đi ra - hoãn câu trấn an");
    return false;
  }

  // Cùng ngưỡng dùng luôn làm khoảng lặng: chờ thêm bấy nhiêu nữa mới đáng nói
  // lần hai. Một hằng số, một ý nghĩa - đỡ phải chỉnh hai chỗ cho khớp nhau.
  const lanCuoi = lanTranAnCuoi.get(muc.threadKey) ?? 0;
  const bayGio = Date.now();
  if (bayGio - lanCuoi < nguong) return false;

  // Đánh dấu TRƯỚC khi gửi: gửi là async, hai tin tới sát nhau có thể cùng qua
  // được các cửa trên rồi cùng gửi.
  lanTranAnCuoi.set(muc.threadKey, bayGio);

  log.info({ threadId: muc.threadId, daChoMs: daCho }, "Bắt chờ quá lâu - nhắn một câu trấn an");
  const ket = await sendReplyInParts(muc, CAU_TRAN_AN);
  return ket.sentParts > 0;
}

/** Xóa bộ nhớ khoảng lặng - chỉ test dùng */
export function resetTranAn(): void {
  lanTranAnCuoi.clear();
}
