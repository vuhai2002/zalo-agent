import { db } from "./database.js";
import { xoaMoTaAnhTheoDuongDan } from "./image-description-store.js";
import { xoaMediaCuaThread } from "./media-store.js";
import { createLogger } from "../shared/logger.js";

/**
 * Xóa sạch ngữ cảnh của MỘT cuộc trò chuyện: bot quên hẳn, như chưa từng nói
 * chuyện với người này.
 *
 * VÌ SAO PHẢI GOM VÀO MỘT CHỖ: DB này KHÔNG có khóa ngoại nào (kiểm cả 14 bảng:
 * 0 foreign key), nên không có cascade - mỗi bảng phải xóa tay. Rải lệnh xóa ra
 * nhiều nơi là kiểu bỏ sót không ai phát hiện: dữ liệu nằm lại âm thầm, người
 * dùng tưởng đã sạch, rồi bot nhắc lại chuyện cũ ở lượt sau.
 *
 * GIỮ LẠI có chủ đích, không phải quên:
 *   - Dòng `threads`: giữ tên hiển thị và công tắc bật/tắt bot. Đây là "reset"
 *     theo nghĩa của goclaw (xóa lịch sử, GIỮ session), không phải "delete".
 *   - `scheduled_jobs`: lịch hẹn là LỜI ĐÃ HỨA với người dùng, khác hẳn ngữ
 *     cảnh. Xóa trí nhớ mà nuốt luôn lời hẹn là kết cục không ai lường trước.
 *   - `contacts`: theo account, không theo thread.
 *   - `agent_turns`: SỔ CHI TIÊU token, không chứa chữ nào của hội thoại. Nội
 *     dung trace nằm ở `agent_steps` và bị xóa - xem `xoaBuocAgent`.
 *   - `memories`: CHỈ xóa khi người dùng tick riêng - xem `xoaTriNho`.
 *
 * Phần DB chạy trong MỘT giao dịch: xóa nửa chừng rồi hỏng còn tệ hơn không
 * xóa, vì lúc đó không ai biết bot còn nhớ những gì. Riêng file trên đĩa nằm
 * ngoài giao dịch (không thể rollback được) nên xóa SAU khi DB đã cam kết -
 * mất file mà DB còn dòng thì chỉ là ảnh hỏng; ngược lại là dòng trỏ vào hư vô.
 */

const log = createLogger("wipe-thread");

export type TuyChonXoa = {
  /**
   * Xóa luôn fact bền đã học TRONG thread này (`memories.learned_in_thread_id`).
   *
   * Mặc định KHÔNG xóa: trí nhớ gắn với CON NGƯỜI (`subject_id`) chứ không gắn
   * với cuộc trò chuyện, nên xóa lịch sử một thread mà bốc hơi luôn "anh Hải ở
   * TP.HCM" là mất thứ người dùng không hề định bỏ. Lọc theo
   * `learned_in_thread_id` nên fact học ở thread khác về cùng người vẫn còn.
   */
  xoaTriNho?: boolean;
};

export type KetQuaXoaNguCanh = {
  tinNhan: number;
  /** Số step trace đã xóa. Dòng đếm token (`agent_turns`) GIỮ NGUYÊN - xem `xoaBuocAgent` */
  buocAgent: number;
  anh: number;
  moTaAnh: number;
  triNho: number;
  soDemChuDong: number;
  /** Epoch mới sau khi tăng - khóa phiên gửi router đổi theo số này */
  epochMoi: number;
};

const xoaTinNhan = db.prepare("DELETE FROM messages WHERE account_id = ? AND thread_id = ?");

/**
 * Xóa NỘI DUNG trace (`agent_steps`), GIỮ dòng đếm (`agent_turns`).
 *
 * Hai bảng này khác hẳn bản chất: `agent_steps` chứa nguyên văn tin nhắn, suy
 * luận, tham số và kết quả tool - đúng thứ phải quên. Còn `agent_turns` chỉ có
 * `input_tokens/output_tokens/created_at/source`, KHÔNG một chữ nào của hội
 * thoại - nó là SỔ CHI TIÊU, và nó là nguồn duy nhất của thống kê token
 * (`usage-store.ts`).
 *
 * Bản đầu xóa cả hai, và đo trên máy người dùng sau 4 lần xóa thử: trang Tổng
 * quan báo hôm nay dùng 0 token trong khi bot chạy ~30 lượt. Xóa một cuộc trò
 * chuyện thì phải quên nội dung, nhưng không có lý do gì để viết lại số tiền đã
 * tiêu.
 *
 * Đổi lại tab Trace của thread đã xóa liệt kê lượt cũ mà mở ra không có step -
 * giao diện đã có sẵn dòng "Lượt này không có step nào được ghi". Như vậy còn
 * trung thực hơn: lượt đó có chạy thật và có tốn ngần ấy token.
 */
const xoaBuocAgent = db.prepare(
  `DELETE FROM agent_steps
   WHERE turn_id IN (SELECT id FROM agent_turns WHERE account_id = ? AND thread_id = ?)`,
);

const xoaSoDemChuDong = db.prepare(
  "DELETE FROM proactive_send_counters WHERE account_id = ? AND thread_id = ?",
);

const xoaTriNhoCuaThread = db.prepare(
  "DELETE FROM memories WHERE account_id = ? AND learned_in_thread_id = ?",
);

/**
 * Dọn summary và tăng epoch trong CÙNG một câu lệnh.
 *
 * Gộp chung chứ không tách hai lệnh: quên tăng epoch thì router vẫn giữ tiền tố
 * đã cache của cuộc trò chuyện vừa xóa, mà đó là kiểu sót không lộ ra ở bất kỳ
 * phép kiểm nào trong DB. Cũng đặt lại `message_count` vì lịch sử đã trống -
 * để nguyên thì trang Sessions hiện "465 tin" cho một thread không còn tin nào.
 */
const datLaiThread = db.prepare(
  `UPDATE threads
      SET summary = '', summary_covers_to_message_id = 0,
          message_count = 0, context_epoch = context_epoch + 1
    WHERE account_id = ? AND thread_id = ?`,
);

const docEpoch = db.prepare(
  "SELECT context_epoch FROM threads WHERE account_id = ? AND thread_id = ?",
);

/**
 * Chạy trong một giao dịch. Viết tay vì `node:sqlite` KHÔNG có
 * `db.transaction()` như better-sqlite3 - gọi nhầm hàm đó là lỗi biên dịch,
 * nhưng đây là chỗ ĐẦU TIÊN trong repo dùng giao dịch nên ghi rõ ra.
 *
 * `BEGIN IMMEDIATE` chứ không phải `BEGIN`: lấy khóa ghi ngay từ đầu thay vì
 * nâng cấp giữa chừng. Cả process dùng CHUNG một connection và chưa chỗ nào
 * khác mở giao dịch, nên không có lồng nhau - thêm giao dịch ở nơi khác thì
 * phải kiểm lại điều đó.
 */
function trongGiaoDich<T>(viec: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const ketQua = viec();
    db.exec("COMMIT");
    return ketQua;
  } catch (err) {
    // Rollback hỏng thì nuốt: ném đè lên lỗi gốc là giấu mất nguyên nhân thật
    try {
      db.exec("ROLLBACK");
    } catch {
      /* giữ nguyên lỗi gốc */
    }
    throw err;
  }
}

export function xoaNguCanhThread(
  accountId: string,
  threadId: string,
  tuyChon: TuyChonXoa = {},
): KetQuaXoaNguCanh {
  const ketQua = trongGiaoDich((): Omit<KetQuaXoaNguCanh, "anh" | "moTaAnh"> => {
    const buocAgent = Number(xoaBuocAgent.run(accountId, threadId).changes);
    const tinNhan = Number(xoaTinNhan.run(accountId, threadId).changes);
    const soDemChuDong = Number(xoaSoDemChuDong.run(accountId, threadId).changes);
    const triNho = tuyChon.xoaTriNho ? Number(xoaTriNhoCuaThread.run(accountId, threadId).changes) : 0;

    datLaiThread.run(accountId, threadId);
    const row = docEpoch.get(accountId, threadId) as { context_epoch?: number } | undefined;

    return { tinNhan, buocAgent, triNho, soDemChuDong, epochMoi: row?.context_epoch ?? 0 };
  });

  // Ngoài giao dịch, và CỐ Ý chạy sau: file mất mà DB còn dòng chỉ là ảnh hỏng,
  // còn DB xóa rồi mà file còn thì dọn rác định kỳ sẽ lo (media có TTL sẵn).
  const duongDanAnh = xoaMediaCuaThread(accountId, threadId);
  const moTaAnh = xoaMoTaAnhTheoDuongDan(duongDanAnh);

  const day = { ...ketQua, anh: duongDanAnh.length, moTaAnh };
  log.info({ accountId, threadId, ...day, xoaTriNho: Boolean(tuyChon.xoaTriNho) }, "Đã xóa ngữ cảnh thread");
  return day;
}
