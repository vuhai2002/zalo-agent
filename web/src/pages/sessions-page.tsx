import { useCallback, useEffect, useState } from "react";
import type { ThreadItem } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import {
  Badge,
  EmptyRow,
  formatNumber,
  formatTime,
  InitialAvatar,
  ListToolbar,
  TableShell,
} from "../shared/ui-bits";
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
      <PageHeader
        title="Sessions"
        subtitle="Mỗi thread (chat riêng / nhóm) là một session, ngữ cảnh giữ trong SQLite"
      />

      <ListToolbar
        query={query}
        onQuery={setQuery}
        placeholder="Tìm theo tên hoặc thread ID..."
        page={page}
        hasMore={hasMore}
        onPage={setPage}
      />

      <TableShell
        headers={["Tên", "Loại", "Tin nhắn", "Token", "Tin cuối", "Bot", ""]}
        minWidth={860}
      >
        {items.length === 0 && <EmptyRow colSpan={7} text="Chưa có session nào" />}
        {items.map((t) => (
          <tr key={t.threadId} className="border-b border-line/60 last:border-0 hover:bg-tile/40">
            <td className="px-4 py-3">
              <div className="flex items-center gap-3">
                <InitialAvatar name={t.displayName || t.threadId} />
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">{t.displayName || t.threadId}</div>
                  <div className="truncate text-xs text-ink-soft/70">{t.threadId}</div>
                </div>
              </div>
            </td>
            <td className="px-4 py-3">
              <Badge tone={t.threadType === 1 ? "amber" : "blue"} dot={false}>
                {t.threadType === 1 ? "Group" : "Direct"}
              </Badge>
            </td>
            <td className="px-4 py-3 text-ink-soft">{formatNumber(t.messageCount)}</td>
            <td className="px-4 py-3 text-ink-soft">
              {formatNumber(t.usage.totalTokens)}
              <span className="text-xs text-ink-soft/60"> / {t.usage.turns} lượt</span>
            </td>
            <td className="px-4 py-3 text-ink-soft">{formatTime(t.lastMessageAt)}</td>
            <td className="px-4 py-3">
              <button
                onClick={() => toggleBot(t)}
                className={`relative h-5 w-9 rounded-full transition-colors ${
                  t.botEnabled ? "bg-zalo-500" : "bg-slate-300"
                }`}
                title={t.botEnabled ? "Bot đang bật - bấm để tắt" : "Bot đang tắt - bấm để bật"}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${
                    t.botEnabled ? "left-[18px]" : "left-0.5"
                  }`}
                />
              </button>
            </td>
            <td className="px-4 py-3">
              <button
                onClick={() => setOpenThread(t)}
                className="text-[13px] font-medium text-zalo-600 hover:underline"
              >
                Xem
              </button>
            </td>
          </tr>
        ))}
      </TableShell>

      {openThread && <SessionDetailDrawer thread={openThread} onClose={() => setOpenThread(null)} />}
    </div>
  );
}
