import { db } from "./database.js";
import { trongGiaoDich } from "../shared/db-transaction.js";
import { createLogger } from "../shared/logger.js";
import { xoaNguCanhThread } from "./wipe-thread-context.js";

/**
 * XÓA HẲN một session (cuộc trò chuyện) khỏi dashboard.
 *
 * Khác `xoaNguCanhThread` (RESET - xóa nội dung nhưng GIỮ dòng `threads` để giữ
 * tên + công tắc bot): hàm này còn xóa CHÍNH dòng session, tức nó biến mất khỏi
 * trang Sessions.
 *
 * GIỮ LẠI có chủ đích:
 *   - `contacts`: người dùng chốt Phương án A - xóa session không đụng danh bạ.
 *     Có nút xóa contact riêng.
 *   - `memories`: có nút xóa riêng ở trang Memory.
 *   - `agent_turns`: SỔ CHI TIÊU token (không chứa chữ hội thoại). Giữ nguyên để
 *     thống kê token không bị viết lại - đúng như `xoaNguCanhThread` làm.
 *
 * XÓA THÊM so với reset: `scheduled_jobs` của thread. Session đã biến mất mà để
 * lại một lịch nhắc trỏ vào nó thì tới giờ nó bắn ra và DỰNG LẠI session - mâu
 * thuẫn với "đã xóa". Reset thì giữ session nên mới giữ lịch.
 *
 * DB này KHÔNG có khóa ngoại (0 foreign key trên cả 14 bảng) nên không có
 * cascade - phải xóa tay từng bảng. Tái dùng `xoaNguCanhThread` để không sót
 * bảng nào (messages, agent_steps, media, image_descriptions, counters).
 */

const log = createLogger("xoa-session");

const xoaDongThread = db.prepare("DELETE FROM threads WHERE account_id = ? AND thread_id = ?");
const xoaLichCuaThread = db.prepare(
  "DELETE FROM scheduled_jobs WHERE account_id = ? AND thread_id = ?",
);

export type KetQuaXoaSession = {
  /** Số tin nhắn đã xóa (từ bước dọn ngữ cảnh) */
  tinNhan: number;
  /** Số lịch hẹn của thread đã xóa */
  lichHen: number;
  /** Dòng session có tồn tại để xóa không (false = xóa cái vốn không có) */
  coDong: boolean;
};

export function xoaHanSession(accountId: string, threadId: string): KetQuaXoaSession {
  // Bước 1: dọn ngữ cảnh (messages, agent_steps, media, counters). Nó tự chạy
  // trong giao dịch riêng và xóa file ảnh trên đĩa (ngoài giao dịch, cố ý).
  const nguCanh = xoaNguCanhThread(accountId, threadId);

  // Bước 2: xóa CHÍNH dòng session + lịch hẹn trỏ vào nó, trong một giao dịch.
  const kq = trongGiaoDich(db, () => {
    const lichHen = Number(xoaLichCuaThread.run(accountId, threadId).changes);
    const coDong = Number(xoaDongThread.run(accountId, threadId).changes) > 0;
    return { lichHen, coDong };
  });

  log.info(
    { accountId, threadId, tinNhan: nguCanh.tinNhan, lichHen: kq.lichHen, coDong: kq.coDong },
    "Đã xóa hẳn session",
  );
  return { tinNhan: nguCanh.tinNhan, lichHen: kq.lichHen, coDong: kq.coDong };
}
