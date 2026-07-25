import { useCallback, useEffect, useState } from "react";
import type { ContactItem } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import {
  EmptyRow,
  formatNumber,
  formatTime,
  InitialAvatar,
  ListToolbar,
  TableShell,
} from "../shared/ui-bits";

export function ContactsPage({ selectedAccountId }: { selectedAccountId: string }) {
  const [items, setItems] = useState<ContactItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const reload = useCallback(() => {
    if (!selectedAccountId) return;
    api
      .contacts(selectedAccountId, query, page)
      .then((data) => {
        setItems(data.items);
        setHasMore(data.hasMore);
      })
      .catch(() => setItems([]));
  }, [selectedAccountId, query, page]);

  useEffect(reload, [reload]);
  useEffect(() => setPage(0), [selectedAccountId, query]);

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle="Tự thu thập từ mọi tin nhắn đến, kể cả người bot không trả lời"
      />

      <ListToolbar
        query={query}
        onQuery={setQuery}
        placeholder="Tìm theo tên hoặc user ID..."
        page={page}
        hasMore={hasMore}
        onPage={setPage}
      />

      <TableShell headers={["Tên", "User ID", "Số tin", "Lần đầu", "Gần nhất"]} minWidth={760}>
        {items.length === 0 && <EmptyRow colSpan={5} text="Chưa có contact nào" />}
        {items.map((contact) => (
          <tr
            key={contact.userId}
            className="border-b border-line/60 last:border-0 hover:bg-tile/40"
          >
            <td className="px-4 py-3">
              <div className="flex items-center gap-3">
                <InitialAvatar name={contact.displayName || contact.userId} />
                <span className="font-medium text-ink">{contact.displayName || "(không tên)"}</span>
              </div>
            </td>
            <td className="px-4 py-3 text-ink-soft">{contact.userId}</td>
            <td className="px-4 py-3 text-ink-soft">{formatNumber(contact.messageCount)}</td>
            <td className="px-4 py-3 text-ink-soft">{formatTime(contact.firstSeen)}</td>
            <td className="px-4 py-3 text-ink-soft">{formatTime(contact.lastSeen)}</td>
          </tr>
        ))}
      </TableShell>
    </div>
  );
}
