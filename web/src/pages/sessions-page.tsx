import { useCallback, useEffect, useState } from "react";
import type { ThreadItem } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { Badge, EmptyRow, formatTime, Pager, TableShell } from "../shared/ui-bits";
import { SessionDetailDrawer } from "./session-detail-drawer";

export function SessionsPage({ selectedAccountId }: { selectedAccountId: string }) {
  const [items, setItems] = useState<ThreadItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [openThread, setOpenThread] = useState<ThreadItem | null>(null);

  const reload = useCallback(() => {
    if (!selectedAccountId) return;
    api
      .threads(selectedAccountId, query, page)
      .then((data) => {
        setItems(data.items);
        setHasMore(data.hasMore);
      })
      .catch(() => setItems([]));
  }, [selectedAccountId, query, page]);

  useEffect(reload, [reload]);
  useEffect(() => setPage(0), [selectedAccountId, query]);

  async function toggleBot(t: ThreadItem) {
    await api.setBotEnabled(t.accountId, t.threadId, !t.botEnabled);
    reload();
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold text-slate-900">Sessions</h1>
      <p className="mb-6 text-sm text-slate-500">
        Mỗi thread (chat riêng / nhóm) là một session, ngữ cảnh giữ vĩnh viễn trong SQLite
      </p>

      <div className="mb-4 flex items-center justify-between gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm theo tên hoặc thread ID..."
          className="w-80 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-zalo-500 focus:ring-2 focus:ring-zalo-100"
        />
        <Pager page={page} hasMore={hasMore} onPage={setPage} />
      </div>

      <TableShell headers={["Tên", "Loại", "Tin nhắn", "Token", "Tin cuối", "Bot", ""]}>
        {items.length === 0 && <EmptyRow colSpan={7} text="Chưa có session nào" />}
        {items.map((t) => (
          <tr key={t.threadId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
            <td className="px-4 py-3">
              <div className="font-medium text-slate-900">{t.displayName || t.threadId}</div>
              <div className="text-xs text-slate-400">{t.threadId}</div>
            </td>
            <td className="px-4 py-3">
              <Badge tone={t.threadType === 1 ? "gray" : "blue"}>
                {t.threadType === 1 ? "Group" : "Direct"}
              </Badge>
            </td>
            <td className="px-4 py-3 text-slate-600">{t.messageCount}</td>
            <td className="px-4 py-3 text-slate-600">
              {t.usage.totalTokens.toLocaleString("vi-VN")}
              <span className="text-xs text-slate-400"> / {t.usage.turns} lượt</span>
            </td>
            <td className="px-4 py-3 text-slate-500">{formatTime(t.lastMessageAt)}</td>
            <td className="px-4 py-3">
              <button
                onClick={() => toggleBot(t)}
                className={`relative h-5 w-9 rounded-full transition-colors ${
                  t.botEnabled ? "bg-zalo-500" : "bg-slate-300"
                }`}
                title={t.botEnabled ? "Bot đang bật - bấm để tắt" : "Bot đang tắt - bấm để bật"}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                    t.botEnabled ? "left-4.5" : "left-0.5"
                  }`}
                />
              </button>
            </td>
            <td className="px-4 py-3">
              <button
                onClick={() => setOpenThread(t)}
                className="text-sm font-medium text-zalo-600 hover:underline"
              >
                Xem
              </button>
            </td>
          </tr>
        ))}
      </TableShell>

      {openThread && (
        <SessionDetailDrawer thread={openThread} onClose={() => setOpenThread(null)} />
      )}
    </div>
  );
}
