import { useCallback, useEffect, useState } from "react";
import type { ContactItem } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { EmptyRow, formatTime, Pager, TableShell } from "../shared/ui-bits";

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
      <h1 className="mb-1 text-2xl font-semibold text-slate-900">Contacts</h1>
      <p className="mb-6 text-sm text-slate-500">
        Tự thu thập từ mọi tin nhắn đến (kể cả người bot không trả lời)
      </p>

      <div className="mb-4 flex items-center justify-between gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm theo tên hoặc user ID..."
          className="w-80 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-zalo-500 focus:ring-2 focus:ring-zalo-100"
        />
        <Pager page={page} hasMore={hasMore} onPage={setPage} />
      </div>

      <TableShell headers={["Tên", "User ID", "Số tin", "Lần đầu", "Gần nhất"]}>
        {items.length === 0 && <EmptyRow colSpan={5} text="Chưa có contact nào" />}
        {items.map((contact) => (
          <tr
            key={contact.userId}
            className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
          >
            <td className="px-4 py-3 font-medium text-slate-900">
              {contact.displayName || "(không tên)"}
            </td>
            <td className="px-4 py-3 text-slate-500">{contact.userId}</td>
            <td className="px-4 py-3 text-slate-600">{contact.messageCount}</td>
            <td className="px-4 py-3 text-slate-500">{formatTime(contact.firstSeen)}</td>
            <td className="px-4 py-3 text-slate-500">{formatTime(contact.lastSeen)}</td>
          </tr>
        ))}
      </TableShell>
    </div>
  );
}
