import { db } from "./database.js";

const daCoTinDenStmt = db.prepare(
  `SELECT 1 FROM messages
   WHERE account_id = ? AND thread_id = ? AND (
     (msg_id = ? AND ? <> '')
     OR (msg_id IS NULL AND role = 'user' AND sender_id = ? AND created_at = ?)
   )
   LIMIT 1`,
);

/**
 * Tin đến này đã nằm trong lịch sử chưa.
 *
 * Vì sao cần: tin lỡ được Zalo gửi lại qua hàng chờ lấy bù (cmd 510/511) có
 * thể trùng tin đã tới trực tiếp; zca-js 2.3.0 còn nhận cả cmd 551 cạnh 501.
 *
 * Hai vế:
 * - cùng mã tin Zalo (mã rỗng thì vế này không khớp);
 * - dòng KHÔNG có mã (`msg_id IS NULL`: ghi trước khi có cột, hoặc tin tới với
 *   mã rỗng - `appendMessage` lưu "" thành NULL): khớp theo người gửi + giờ
 *   gửi. `created_at` của tin đến lưu đúng `sentAt` tới từng ms. Vế này cần
 *   cho lần lấy bù đầu tiên sau deploy, khi mọi dòng cũ đều chưa có mã.
 *   `msg_id IS NULL` là chốt quan trọng: thiếu nó thì hai tin KHÁC NHAU cùng
 *   người cùng ms (giờ gửi bị kẹp về giờ nhận, tin trong một trang lấy bù) bị
 *   coi là trùng và tin thật bị bỏ câm.
 */
export function daCoTinDen(
  accountId: string,
  threadId: string,
  tin: { msgId: string; senderId: string; sentAt: string },
): boolean {
  return daCoTinDenStmt.get(accountId, threadId, tin.msgId, tin.msgId, tin.senderId, tin.sentAt) !== undefined;
}
