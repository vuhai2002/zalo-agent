import { db } from "./database.js";

/**
 * Store cho bảng `friend_requests` (yêu cầu kết bạn ĐẾN đang chờ). Prepared
 * statement module-level như `contact-store.ts` - bảng đã được tạo trong
 * `runMigrations()` lúc import `database.js` nên `prepare` không lỗi.
 */
export type FriendRequestRow = {
  accountId: string;
  fromUid: string;
  message: string;
  /** Tên hiển thị enrich từ `getUserInfo` lúc nhận sự kiện; `null` nếu enrich hỏng */
  senderName: string | null;
  avatarUrl: string | null;
  /** epoch ms lúc nhận sự kiện - dùng cho delay auto-accept */
  receivedAt: number;
};

const upsertStmt = db.prepare(`
  INSERT INTO friend_requests (account_id, from_uid, message, sender_name, avatar_url, received_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (account_id, from_uid) DO UPDATE SET
    message = excluded.message,
    sender_name = excluded.sender_name,
    avatar_url = excluded.avatar_url,
    received_at = excluded.received_at
`);

/** Ghi/cập nhật một request. Người gửi lại (trùng PK) chỉ cập nhật, không đẻ dòng 2. */
export function upsertFriendRequest(row: FriendRequestRow): void {
  if (!row.accountId || !row.fromUid) return;
  upsertStmt.run(
    row.accountId,
    row.fromUid,
    row.message,
    row.senderName,
    row.avatarUrl,
    row.receivedAt,
  );
}

const capNhatHoSoStmt = db.prepare(
  "UPDATE friend_requests SET sender_name = ?, avatar_url = ? WHERE account_id = ? AND from_uid = ?",
);

/**
 * Cập nhật tên/avatar SAU khi đã upsert (enrich getUserInfo chậm, chạy sau).
 * UPDATE-only, KHÔNG chèn: nếu dòng vừa bị ADD/accept xóa trong lúc enrich thì
 * đây là no-op - tránh dựng lại một dòng "ma" cho người đã thành bạn.
 */
export function capNhatHoSoFriendRequest(
  accountId: string,
  fromUid: string,
  senderName: string | null,
  avatarUrl: string | null,
): void {
  capNhatHoSoStmt.run(senderName, avatarUrl, accountId, fromUid);
}

const xoaStmt = db.prepare("DELETE FROM friend_requests WHERE account_id = ? AND from_uid = ?");

/** Xóa dòng khi ADD/REJECT/UNDO hoặc accept/reject xong. Idempotent (xóa dòng đã mất vô hại). */
export function xoaFriendRequest(accountId: string, fromUid: string): boolean {
  return xoaStmt.run(accountId, fromUid).changes > 0;
}

type Row = {
  account_id: string;
  from_uid: string;
  message: string;
  sender_name: string | null;
  avatar_url: string | null;
  received_at: number;
};

function toRow(r: Row): FriendRequestRow {
  return {
    accountId: r.account_id,
    fromUid: r.from_uid,
    message: r.message,
    senderName: r.sender_name,
    avatarUrl: r.avatar_url,
    receivedAt: r.received_at,
  };
}

const COT = "account_id, from_uid, message, sender_name, avatar_url, received_at";

const listStmt = db.prepare(
  `SELECT ${COT} FROM friend_requests WHERE account_id = ? ORDER BY received_at DESC`,
);

/** Mọi request đang chờ của một account, mới nhất trước. */
export function listFriendRequests(accountId: string): FriendRequestRow[] {
  return (listStmt.all(accountId) as unknown as Row[]).map(toRow);
}

const quaHanStmt = db.prepare(
  `SELECT ${COT} FROM friend_requests WHERE account_id = ? AND received_at <= ? ORDER BY received_at`,
);

/**
 * Request đã chờ quá mốc (`received_at <= truocMoc`) - cho vòng quét auto-accept.
 * `truocMoc = now - delayMinutes*60000`.
 */
export function layFriendRequestQuaHan(accountId: string, truocMoc: number): FriendRequestRow[] {
  return (quaHanStmt.all(accountId, truocMoc) as unknown as Row[]).map(toRow);
}
