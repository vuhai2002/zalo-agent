import { useCallback, useEffect, useState } from "react";
import type { AccountInfo, MemoryFactItem } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { IconBrain } from "../shared/dashboard-icons";
import { AccountFilter, accountLabel } from "../shared/account-filter";
import { Badge, EmptyRow, formatTime, ListToolbar, TableShell } from "../shared/ui-bits";
import { VerbatimNotesSection } from "./verbatim-notes-section";

/** Hai loại trí nhớ khác bản chất nên hai bảng riêng - xem verbatim-note-schema.ts */
const TABS = [
  ["fact", "Điều ghi nhớ"],
  ["nguyen-van", "Ghi chú nguyên văn"],
] as const;

export function MemoryPage({ accounts }: { accounts: AccountInfo[] }) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("fact");

  return (
    <div>
      <PageHeader
        icon={IconBrain}
        title="Memory"
        subtitle={
          tab === "fact"
            ? "Fact bot tự ghi nhớ qua tool save_memory - fact học ở chat riêng không bao giờ dùng trong nhóm"
            : "Đoạn người dùng nhờ giữ NGUYÊN VĂN (tool verbatim_note) - bot gửi lại đúng từng chữ khi chính người đó hỏi"
        }
      />

      {/* Segmented control tự dựng, cùng kiểu modal Kho tri thức */}
      <div className="mb-4 flex gap-1 border-b border-line">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`cursor-pointer rounded-t-lg px-3 py-2 text-[13px] font-medium transition-colors ${
              tab === key ? "border-b-2 border-zalo-500 text-zalo-600" : "text-ink-soft hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "fact" ? <MemoryFactsSection accounts={accounts} /> : <VerbatimNotesSection accounts={accounts} />}
    </div>
  );
}

function MemoryFactsSection({ accounts }: { accounts: AccountInfo[] }) {
  const [items, setItems] = useState<MemoryFactItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [query, setQuery] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [page, setPage] = useState(0);

  const showAccountColumn = accounts.length > 1;

  const reload = useCallback(() => {
    api
      .memories(accountFilter, query, page)
      .then((data) => {
        setItems(data.items);
        setHasMore(data.hasMore);
      })
      .catch(() => setItems([]));
  }, [accountFilter, query, page]);

  useEffect(reload, [reload]);
  useEffect(() => setPage(0), [accountFilter, query]);

  async function remove(fact: MemoryFactItem) {
    await api.deleteMemory(fact.accountId, fact.id);
    reload();
  }

  return (
    <div>
      <ListToolbar
        query={query}
        onQuery={setQuery}
        placeholder="Tìm trong nội dung hoặc subject ID..."
        filter={<AccountFilter accounts={accounts} value={accountFilter} onChange={setAccountFilter} />}
        page={page}
        hasMore={hasMore}
        onPage={setPage}
      />

      <TableShell
        headers={
          showAccountColumn
            ? ["Fact", "Account", "Về", "Học từ", "Lúc", ""]
            : ["Fact", "Về", "Học từ", "Lúc", ""]
        }
        minWidth={showAccountColumn ? 880 : 780}
      >
        {items.length === 0 && (
          <EmptyRow colSpan={showAccountColumn ? 6 : 5} text="Bot chưa ghi nhớ gì" />
        )}
        {items.map((m) => (
          <tr key={m.id} className="border-b border-line/60 last:border-0 hover:bg-tile/40">
            <td className="max-w-md px-4 py-3 text-ink">{m.content}</td>
            {showAccountColumn && (
              <td className="px-4 py-3">
                <Badge tone="gray" dot={false}>{accountLabel(accounts, m.accountId)}</Badge>
              </td>
            )}
            <td className="px-4 py-3 text-ink-soft">{m.subjectId}</td>
            <td className="px-4 py-3">
              <Badge tone={m.learnedInGroup ? "amber" : "blue"} dot={false}>
                {m.learnedInGroup ? "Nhóm" : "Chat riêng"}
              </Badge>
            </td>
            <td className="px-4 py-3 text-ink-soft">{formatTime(m.createdAt)}</td>
            <td className="px-4 py-3">
              <button onClick={() => remove(m)} className="text-[13px] text-red-600 dark:text-red-400 hover:underline">
                Xóa
              </button>
            </td>
          </tr>
        ))}
      </TableShell>
    </div>
  );
}
