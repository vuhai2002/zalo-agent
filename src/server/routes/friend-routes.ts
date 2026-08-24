import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import type { API } from "zca-js";

import { listFriendRequests, xoaFriendRequest } from "../../conversation/friend-request-store.js";
import { createLogger } from "../../shared/logger.js";
import { getRunningAccountKenh } from "../../zalo/account-manager.js";

const log = createLogger("friend-routes");
const bodySchema = z.object({ fromUid: z.string().min(1) });

/** Tiêm được đường lấy api để test không cần tài khoản chạy thật */
export type FriendRoutesDeps = {
  /** `null` khi account chưa chạy hoặc là kênh bot (Bot API không có kết bạn) */
  getApi: (accountId: string) => API | null;
};

const CHUA_CHAY = { error: "Tài khoản chưa chạy hoặc là kênh bot" } as const;

/** Chung cho accept + reject: validate body, lấy api, gọi hành động, xóa dòng pending. */
async function duyet(
  c: Context,
  deps: FriendRoutesDeps,
  goi: (api: API, fromUid: string) => Promise<unknown>,
): Promise<Response> {
  const accountId = c.req.param("accountId");
  if (!accountId) return c.json({ error: "Thiếu accountId" }, 400);
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Thiếu fromUid" }, 400);

  const api = deps.getApi(accountId);
  if (!api) return c.json(CHUA_CHAY, 409);

  try {
    await goi(api, parsed.data.fromUid);
    // Chỉ xóa SAU khi Zalo nhận - hành động hỏng thì giữ dòng để thử lại.
    xoaFriendRequest(accountId, parsed.data.fromUid);
    return c.json({ ok: true });
  } catch (err) {
    log.warn({ err, accountId }, "duyệt kết bạn thất bại");
    return c.json({ error: "Thao tác thất bại, thử lại sau" }, 502);
  }
}

/** /api/friends - tab Bạn bè (chỉ kênh cá nhân) */
export function createFriendRoutes(deps: FriendRoutesDeps) {
  return new Hono()
    // Danh sách yêu cầu ĐẾN đang chờ (đọc từ DB - không cần api chạy).
    .get("/:accountId/requests", (c) =>
      c.json({ requests: listFriendRequests(c.req.param("accountId")) }),
    )
    // Danh sách bạn bè - lấy trực tiếp getAllFriends() (live).
    .get("/:accountId/list", async (c) => {
      const api = deps.getApi(c.req.param("accountId"));
      if (!api) return c.json(CHUA_CHAY, 409);
      try {
        return c.json({ friends: await api.getAllFriends() });
      } catch (err) {
        log.warn({ err }, "getAllFriends lỗi");
        return c.json({ error: "Không lấy được danh sách bạn" }, 502);
      }
    })
    .post("/:accountId/accept", (c) => duyet(c, deps, (api, uid) => api.acceptFriendRequest(uid)))
    .post("/:accountId/reject", (c) => duyet(c, deps, (api, uid) => api.rejectFriendRequest(uid)));
}

export const friendRoutes = createFriendRoutes({
  getApi: (id) => getRunningAccountKenh(id)?.api ?? null,
});
