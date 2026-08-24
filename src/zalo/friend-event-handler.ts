import { type API, type FriendEvent, FriendEventType } from "zca-js";

import { upsertFriendRequest, xoaFriendRequest } from "../conversation/friend-request-store.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("friend-event");

/** Đường lấy thông tin user - tách để test tiêm giả, khỏi gọi mạng thật */
export type LayUser = (uid: string) => Promise<{ changed_profiles?: Record<string, unknown> }>;

export type FriendEventDeps = {
  layUser?: LayUser;
  now?: () => number;
};

/** uid đối phương cần xóa khỏi pending, tùy loại sự kiện. `null` nếu không rõ. */
function uidCanXoa(event: FriendEvent): string | null {
  if (event.type === FriendEventType.ADD) {
    // data là string = threadId = uid vừa thành bạn
    return event.threadId || null;
  }
  if (event.type === FriendEventType.REJECT_REQUEST || event.type === FriendEventType.UNDO_REQUEST) {
    // data { toUid, fromUid } - fromUid là người đã GỬI request (khóa của dòng pending)
    return event.data.fromUid || null;
  }
  return null;
}

/** Đọc tên + avatar từ phản hồi getUserInfo (best-effort, sai gì cũng trả null) */
function docHoSo(resp: { changed_profiles?: Record<string, unknown> }): {
  senderName: string | null;
  avatarUrl: string | null;
} {
  const prof = Object.values(resp.changed_profiles ?? {})[0] as
    | { displayName?: string; zaloName?: string; avatar?: string }
    | undefined;
  return {
    senderName: prof?.displayName || prof?.zaloName || null,
    avatarUrl: prof?.avatar || null,
  };
}

/**
 * Xử lý một sự kiện `friend_event` cho một tài khoản cá nhân.
 *
 * - REQUEST (không phải mình gửi): enrich tên/avatar rồi LƯU vào bảng pending.
 * - ADD / REJECT_REQUEST / UNDO_REQUEST: XÓA dòng pending tương ứng (đã giải quyết).
 * - REMOVE + loại khác: chỉ log (danh sách bạn lấy trực tiếp nên tự cập nhật).
 *
 * KHÔNG ném ra listener: mọi lỗi bắt lại rồi log. Enrich hỏng vẫn lưu (senderName null).
 */
export async function handleFriendEvent(
  accountId: string,
  api: API,
  event: FriendEvent,
  deps: FriendEventDeps = {},
): Promise<void> {
  try {
    if (event.type === FriendEventType.REQUEST) {
      if (event.isSelf) return; // request MÌNH gửi đi - không phải request đến
      const fromUid = event.data.fromUid;
      if (!fromUid) return;

      let senderName: string | null = null;
      let avatarUrl: string | null = null;
      const layUser = deps.layUser ?? ((uid: string) => api.getUserInfo(uid));
      try {
        ({ senderName, avatarUrl } = docHoSo(await layUser(fromUid)));
      } catch (err) {
        log.warn({ err, accountId, fromUid }, "enrich getUserInfo hỏng - lưu mỗi UID");
      }

      upsertFriendRequest({
        accountId,
        fromUid,
        message: event.data.message ?? "",
        senderName,
        avatarUrl,
        receivedAt: (deps.now ?? Date.now)(),
      });
      log.info({ accountId, fromUid }, "yêu cầu kết bạn mới");
      return;
    }

    const uid = uidCanXoa(event);
    if (uid) {
      xoaFriendRequest(accountId, uid);
      log.debug({ accountId, uid, type: event.type }, "xóa pending (đã giải quyết)");
      return;
    }

    log.debug({ accountId, type: event.type }, "friend_event không cần xử lý");
  } catch (err) {
    log.error({ err, accountId }, "handleFriendEvent lỗi - nuốt để không phá listener");
  }
}
