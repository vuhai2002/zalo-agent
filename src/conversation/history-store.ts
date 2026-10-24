import { closeDatabase, db } from "./database.js";
import { getTuning } from "../config/runtime-tuning-settings.js";

export type StoredMessage = {
  /**
   * id của dòng trong bảng `messages` - có khi ĐỌC, không có khi ghi.
   *
   * Dùng để nhận ra "dòng này chính là tin của lượt đang chạy": tin người dùng
   * nay được ghi ngay lúc NHẬN, nên lúc lượt agent đọc lịch sử thì tin của
   * chính nó đã nằm sẵn trong đó. Không lọc ra thì model thấy tin lặp hai lần.
   */
  id?: number;
  role: "user" | "assistant";
  content: string;
  senderName?: string;
  senderId?: string;
  /** Đường dẫn ảnh đã lưu trong data/media (tương đối DATA_DIR) - nạp lại cho model xem */
  images?: string[];
  /**
   * ISO UTC - có sẵn khi đọc.
   *
   * Khi GHI: truyền vào thì lấy đúng giá trị đó, bỏ trống thì DB tự sinh giờ
   * hiện tại. Tin đến từ Zalo PHẢI truyền `msg.sentAt` (giờ người ta bấm gửi):
   * để DB tự sinh là lấy giờ tin TỚI LISTENER, mà mốc này là nhãn
   * `[dd/mm hh:mm]` model đọc để hiểu "vừa nãy", "sáng nay". Khoảng lệch nhỏ
   * hơn từ khi tin được ghi ngay lúc nhận thay vì cuối lượt, nhưng vẫn có -
   * và tin cũ về muộn sau khi listener nối lại thì lệch hẳn hàng giờ.
   */
  createdAt?: string;
};

const insertStmt = db.prepare(
  `INSERT INTO messages (account_id, thread_id, role, sender_name, sender_id, content, images)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);

/**
 * Bản có `created_at` tường minh. Hai câu lệnh riêng thay vì một câu dùng
 * `COALESCE(?, strftime(...))`: viết COALESCE là chép lại biểu thức mặc định
 * của schema ở chỗ thứ hai, đổi một bên quên bên kia thì hai đường ghi ra hai
 * định dạng khác nhau mà không gì đỏ.
 */
const insertWithCreatedAtStmt = db.prepare(
  `INSERT INTO messages (account_id, thread_id, role, sender_name, sender_id, content, images, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);

const recentStmt = db.prepare(
  `SELECT id, role, sender_name, sender_id, content, images, created_at FROM messages
   WHERE account_id = ? AND thread_id = ?
   ORDER BY id DESC LIMIT ?`,
);

/** Cột images là JSON array; NULL hoặc JSON hỏng đều coi như không có ảnh */
function parseImages(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed.map(String) : undefined;
  } catch {
    return undefined;
  }
}

// Giữ N tin mới nhất của thread, xóa phần cũ hơn. Subquery lấy id của tin thứ
// N+1 tính từ mới nhất; thread có ít hơn N+1 tin thì trả NULL và không xóa gì.
// Cả DELETE lẫn subquery đều chạy trên index (account_id, thread_id, id).
//
// NHƯNG không xóa tin mà bản tóm tắt CHƯA phủ (id > `summary_covers_to_message_id`),
// trừ khi đã vượt trần cứng 2N. Lý do đo trên DB thật (2026-10-24): nhóm nghe
// thụ động chạm trần 500 dòng, khoảng trống dài nhất giữa hai lần bot trả lời
// là 385 tin. Bộ tóm tắt chỉ chạy SAU một lượt bot trả lời và chỉ đọc được tin
// còn trong DB - nên nhóm nói quá ~N tin giữa hai lần bot lên tiếng là phần cũ
// nhất bị xóa trước khi kịp vào bản tóm tắt, mất trí nhớ câm. Cùng ý goclaw
// 1d68a21f (lưu trữ trong cùng giao dịch với lúc bỏ khỏi bộ đệm). Trần 2N giữ
// DB không phình vô hạn ở thread mà bot không bao giờ trả lời.
const pruneStmt = db.prepare(
  `DELETE FROM messages
   WHERE account_id = ? AND thread_id = ?
     AND id <= (SELECT id FROM messages
                WHERE account_id = ? AND thread_id = ?
                ORDER BY id DESC LIMIT 1 OFFSET ?)
     AND (
       id <= COALESCE((SELECT summary_covers_to_message_id FROM threads
                       WHERE account_id = ? AND thread_id = ?), 0)
       OR id <= COALESCE((SELECT id FROM messages
                          WHERE account_id = ? AND thread_id = ?
                          ORDER BY id DESC LIMIT 1 OFFSET ?), 0)
     )`,
);

/** Ghi 1 tin, trả về id của row để cập nhật bổ sung sau (vd gắn ảnh tải xong muộn) */
export function appendMessage(
  accountId: string,
  threadId: string,
  message: StoredMessage,
): number {
  const cot = [
    accountId,
    threadId,
    message.role,
    message.senderName ?? null,
    message.senderId ?? null,
    message.content,
    message.images && message.images.length > 0 ? JSON.stringify(message.images) : null,
  ] as const;
  const result = message.createdAt
    ? insertWithCreatedAtStmt.run(...cot, message.createdAt)
    : insertStmt.run(...cot);
  // Dọn ngay thread vừa ghi: không cần cron, và thread im lặng thì không tốn gì
  const tran = getTuning("HISTORY_MAX_MESSAGES_PER_THREAD");
  pruneStmt.run(accountId, threadId, accountId, threadId, tran, accountId, threadId, accountId, threadId, tran * 2);
  return Number(result.lastInsertRowid);
}

const setImagesStmt = db.prepare(`UPDATE messages SET images = ? WHERE id = ?`);

/** Gắn ảnh vào tin đã ghi - dùng cho passive listen (ghi tin ngay, ảnh tải xong sau) */
export function setMessageImages(messageId: number, images: string[]): void {
  if (images.length === 0) return;
  setImagesStmt.run(JSON.stringify(images), messageId);
}

export function getRecentMessages(
  accountId: string,
  threadId: string,
  limit = getTuning("HISTORY_CONTEXT_LIMIT"),
): StoredMessage[] {
  type Row = {
    id: number;
    role: "user" | "assistant";
    sender_name: string | null;
    sender_id: string | null;
    content: string;
    images: string | null;
    created_at: string;
  };
  const rows = recentStmt.all(accountId, threadId, limit) as unknown as Row[];
  // DESC để lấy N tin mới nhất, đảo lại thành thứ tự thời gian cho LLM
  return rows.reverse().map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    senderName: r.sender_name ?? undefined,
    senderId: r.sender_id ?? undefined,
    images: parseImages(r.images),
    createdAt: r.created_at,
  }));
}

const pagedStmt = db.prepare(
  `SELECT id, role, sender_name, content, images, created_at FROM messages
   WHERE account_id = ? AND thread_id = ? AND id < ?
   ORDER BY id DESC LIMIT ?`,
);

export type PagedMessage = StoredMessage & { id: number };

/**
 * Đọc tin nhắn phân trang cho dashboard - keyset theo id (ổn định khi có tin
 * mới chen vào, không lệch trang như OFFSET). beforeId bỏ trống = từ tin mới nhất.
 */
export function listMessagesPaged(
  accountId: string,
  threadId: string,
  options: { limit?: number; beforeId?: number } = {},
): PagedMessage[] {
  type Row = {
    id: number;
    role: "user" | "assistant";
    sender_name: string | null;
    content: string;
    images: string | null;
    created_at: string;
  };
  const rows = pagedStmt.all(
    accountId,
    threadId,
    options.beforeId ?? Number.MAX_SAFE_INTEGER,
    options.limit ?? 50,
  ) as unknown as Row[];
  return rows.reverse().map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    senderName: r.sender_name ?? undefined,
    images: parseImages(r.images),
    createdAt: r.created_at,
  }));
}

export function closeHistoryStore(): void {
  closeDatabase();
}
