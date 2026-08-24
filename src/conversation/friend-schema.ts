import type { DatabaseSync } from "node:sqlite";

/**
 * Bảng yêu cầu kết bạn ĐẾN đang chờ duyệt.
 *
 * VÌ SAO PHẢI LƯU: zca-js KHÔNG có API liệt kê request kết bạn ĐẾN (chỉ có
 * `getAllFriends` + `getSentFriendRequest` = request MÌNH gửi đi). Request người
 * khác gửi đến chỉ tới qua sự kiện listener `friend_event` type REQUEST - không
 * lưu lại thì tab Bạn bè không có gì để hiển thị / accept / reject. Xóa dòng khi
 * nhận ADD / REJECT_REQUEST / UNDO_REQUEST, hoặc khi accept / reject thủ công.
 *
 * Hệ quả đã biết: chỉ bắt được request tới SAU khi tính năng chạy + listener
 * sống - không backfill được request cũ (Zalo không cho lấy).
 *
 * Gọi từ `database.ts` (runMigrations), CÙNG connection. KHÔNG FOREIGN KEY:
 * `database.ts` không bật `PRAGMA foreign_keys` nên `REFERENCES` chỉ là lời hứa
 * suông - mọi nơi xóa tự dọn tường minh.
 */
export function taoBangFriendRequests(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      account_id  TEXT NOT NULL,
      from_uid    TEXT NOT NULL,
      message     TEXT NOT NULL DEFAULT '',
      sender_name TEXT,
      avatar_url  TEXT,
      received_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, from_uid)
    );
  `);
}
