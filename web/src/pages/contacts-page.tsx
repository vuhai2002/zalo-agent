import { useCallback, useEffect, useState } from "react";
import type { AccountInfo, ContactItem } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { IconUsers } from "../shared/dashboard-icons";
import { AccountFilter, accountLabel } from "../shared/account-filter";
import {
  Badge,
  EmptyRow,
  formatNumber,
  formatTime,
  InitialAvatar,
  ListToolbar,
  TableShell,
} from "../shared/ui-bits";

export function ContactsPage({ accounts }: { accounts: AccountInfo[] }) {
  const [items, setItems] = useState<ContactItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [query, setQuery] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [page, setPage] = useState(0);

  const showAccountColumn = accounts.length > 1;

  const reload = useCallback(() => {
    api
      .contacts(accountFilter, query, page)
      .then((data) => {
        setItems(data.items);
        setHasMore(data.hasMore);
      })
      .catch(() => setItems([]));
  }, [accountFilter, query, page]);

  useEffect(reload, [reload]);
  useEffect(() => setPage(0), [accountFilter, query]);

  return (
    <div>
      <PageHeader
        icon={IconUsers}
        title="Contacts"
        subtitle="Tự thu thập từ mọi tin nhắn đến, kể cả người bot không trả lời"
      />

      <ListToolbar
        query={query}
        onQuery={setQuery}
        placeholder="Tìm theo tên hoặc user ID..."
        filter={<AccountFilter accounts={accounts} value={accountFilter} onChange={setAccountFilter} />}
        page={page}
        hasMore={hasMore}
        onPage={setPage}
      />

      <TableShell
        headers={
          showAccountColumn
            ? ["Tên", "Account", "User ID", "Số tin", "Lần đầu", "Gần nhất"]
            : ["Tên", "User ID", "Số tin", "Lần đầu", "Gần nhất"]
        }
        minWidth={showAccountColumn ? 860 : 760}
      >
        {items.length === 0 && (
          <EmptyRow colSpan={showAccountColumn ? 6 : 5} text="Chưa có contact nào" />
        )}
        {items.map((contact) => (
          <tr
            key={`${contact.accountId}:${contact.userId}`}
            className="border-b border-line/60 last:border-0 hover:bg-tile/40"
          >
            <td className="px-4 py-3">
              <div className="flex items-center gap-3">
                <InitialAvatar name={contact.displayName || contact.userId} />
                <span className="font-medium text-ink">{contact.displayName || "(không tên)"}</span>
              </div>
            </td>
            {showAccountColumn && (
              <td className="px-4 py-3">
                <Badge tone="gray" dot={false}>{accountLabel(accounts, contact.accountId)}</Badge>
              </td>
            )}
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
