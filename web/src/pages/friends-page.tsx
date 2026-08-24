import { useCallback, useEffect, useState } from "react";
import type { AccountInfo, FriendItem, FriendRequestItem } from "../dashboard-api-client";
import { api, ApiError } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { IconCheck, IconClose, IconUsers } from "../shared/dashboard-icons";
import { useConfirmDialog } from "../shared/confirm-dialog";
import { SelectMenu } from "../shared/select-menu";
import { EmptyRow, InitialAvatar, TableShell } from "../shared/ui-bits";

function friendName(f: FriendItem): string {
  return f.displayName || f.zaloName || f.userId;
}

function thoiGian(ms: number): string {
  try {
    return new Date(ms).toLocaleString("vi-VN");
  } catch {
    return "";
  }
}

export function FriendsPage({ accounts }: { accounts: AccountInfo[] }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [requests, setRequests] = useState<FriendRequestItem[]>([]);
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [friendsError, setFriendsError] = useState<string | null>(null);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const { confirm, confirmDialog } = useConfirmDialog();

  const reloadRequests = useCallback(() => {
    if (!accountId) return setRequests([]);
    api
      .friendRequests(accountId)
      .then((d) => setRequests(d.requests))
      .catch(() => setRequests([]));
  }, [accountId]);

  const reloadFriends = useCallback(() => {
    if (!accountId) {
      setFriends([]);
      setFriendsError(null);
      return;
    }
    setLoadingFriends(true);
    setFriendsError(null);
    api
      .friendList(accountId)
      .then((d) => setFriends(d.friends))
      .catch((e) => {
        setFriends([]);
        setFriendsError(
          e instanceof ApiError && e.status === 409
            ? "Tài khoản chưa chạy hoặc là kênh bot - tính năng bạn bè chỉ dùng cho nick cá nhân đang chạy."
            : "Không lấy được danh sách bạn (nguồn có thể đang giới hạn) - thử lại sau.",
        );
      })
      .finally(() => setLoadingFriends(false));
  }, [accountId]);

  useEffect(reloadRequests, [reloadRequests]);
  useEffect(reloadFriends, [reloadFriends]);

  // Poll request mới (chỉ đọc DB nên rẻ). Danh sách bạn KHÔNG poll (gọi mạng).
  useEffect(() => {
    if (!accountId) return;
    const t = setInterval(reloadRequests, 7000);
    return () => clearInterval(t);
  }, [accountId, reloadRequests]);

  async function accept(r: FriendRequestItem) {
    try {
      await api.acceptFriend(accountId, r.fromUid);
    } finally {
      reloadRequests();
    }
  }

  async function reject(r: FriendRequestItem) {
    const ok = await confirm({
      title: `Từ chối kết bạn từ "${r.senderName || r.fromUid}"?`,
      message: "Yêu cầu sẽ bị xóa khỏi danh sách chờ.",
      confirmLabel: "Từ chối",
    });
    if (!ok) return;
    try {
      await api.rejectFriend(accountId, r.fromUid);
    } finally {
      reloadRequests();
    }
  }

  return (
    <div>
      <PageHeader
        icon={IconUsers}
        title="Bạn bè"
        subtitle="Duyệt yêu cầu kết bạn và xem danh sách bạn (chỉ nick cá nhân đang chạy)"
      />

      <div className="mb-4 flex items-center gap-3">
        <SelectMenu
          value={accountId}
          onChange={setAccountId}
          ariaLabel="Chọn tài khoản"
          options={accounts.map((a) => ({
            value: a.id,
            label: a.label,
            dotClass: a.online ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600",
          }))}
        />
      </div>

      <p className="mb-3 text-sm text-ink-soft/80">
        Chỉ hiện yêu cầu tới TỪ KHI bật tính năng và bot đang chạy - Zalo không cho lấy lại yêu cầu cũ.
      </p>

      <h2 className="mb-2 text-sm font-semibold text-ink">Chờ duyệt ({requests.length})</h2>
      <TableShell headers={["", "Tên", "Lời nhắn", "Nhận lúc", ""]} minWidth={700}>
        {requests.length === 0 && <EmptyRow colSpan={5} text="Không có yêu cầu nào đang chờ" />}
        {requests.map((r) => (
          <tr key={r.fromUid} className="border-b border-line/60 last:border-0 hover:bg-tile/40">
            <td className="px-4 py-3">
              <InitialAvatar name={r.senderName || r.fromUid} />
            </td>
            <td className="px-4 py-3 font-medium text-ink">{r.senderName || r.fromUid}</td>
            <td className="px-4 py-3 text-ink-soft">{r.message || "-"}</td>
            <td className="px-4 py-3 text-ink-soft">{thoiGian(r.receivedAt)}</td>
            <td className="px-4 py-3 text-right">
              <div className="flex justify-end gap-1.5">
                <button
                  onClick={() => accept(r)}
                  className="rounded-lg p-1.5 text-emerald-600 transition-colors hover:bg-emerald-500/10"
                  title="Chấp nhận"
                >
                  <IconCheck className="h-4 w-4" />
                </button>
                <button
                  onClick={() => reject(r)}
                  className="rounded-lg p-1.5 text-ink-soft/60 transition-colors hover:bg-red-500/10 hover:text-red-500"
                  title="Từ chối"
                >
                  <IconClose className="h-4 w-4" />
                </button>
              </div>
            </td>
          </tr>
        ))}
      </TableShell>

      <div className="mb-2 mt-6 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Danh sách bạn ({friends.length})</h2>
        <button
          onClick={reloadFriends}
          disabled={loadingFriends}
          className="rounded-lg border border-line px-3 py-1 text-sm text-ink-soft transition-colors hover:bg-tile/60 disabled:opacity-50"
        >
          {loadingFriends ? "Đang tải..." : "Làm mới"}
        </button>
      </div>
      {friendsError && <p className="mb-3 text-sm text-red-500">{friendsError}</p>}
      <TableShell headers={["", "Tên", "User ID"]} minWidth={600}>
        {friends.length === 0 && !friendsError && (
          <EmptyRow colSpan={3} text={loadingFriends ? "Đang tải..." : "Chưa có bạn nào"} />
        )}
        {friends.map((f) => (
          <tr key={f.userId} className="border-b border-line/60 last:border-0 hover:bg-tile/40">
            <td className="px-4 py-3">
              <InitialAvatar name={friendName(f)} />
            </td>
            <td className="px-4 py-3 font-medium text-ink">{friendName(f)}</td>
            <td className="px-4 py-3 text-ink-soft">{f.userId}</td>
          </tr>
        ))}
      </TableShell>

      {confirmDialog}
    </div>
  );
}
