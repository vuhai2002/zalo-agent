import { useCallback, useEffect, useState } from "react";
import type { MemoryFactItem } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { Badge, EmptyRow, formatTime, ListToolbar, TableShell } from "../shared/ui-bits";

export function MemoryPage({ selectedAccountId }: { selectedAccountId: string }) {
  const [items, setItems] = useState<MemoryFactItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const reload = useCallback(() => {
    if (!selectedAccountId) return;
    api
      .memories(selectedAccountId, query, page)
      .then((data) => {
        setItems(data.items);
        setHasMore(data.hasMore);
      })
      .catch(() => setItems([]));
  }, [selectedAccountId, query, page]);

  useEffect(reload, [reload]);
  useEffect(() => setPage(0), [selectedAccountId, query]);

  async function remove(id: number) {
    await api.deleteMemory(selectedAccountId, id);
    reload();
  }

  return (
    <div>
      <PageHeader
        title="Memory"
        subtitle="Fact bot tự ghi nhớ qua tool save_memory - fact học ở chat riêng không bao giờ dùng trong nhóm"
      />

      <ListToolbar
        query={query}
        onQuery={setQuery}
        placeholder="Tìm trong nội dung hoặc subject ID..."
        page={page}
        hasMore={hasMore}
        onPage={setPage}
      />

      <TableShell headers={["Fact", "Về", "Học từ", "Lúc", ""]} minWidth={780}>
        {items.length === 0 && <EmptyRow colSpan={5} text="Bot chưa ghi nhớ gì" />}
        {items.map((m) => (
          <tr key={m.id} className="border-b border-line/60 last:border-0 hover:bg-tile/40">
            <td className="max-w-md px-4 py-3 text-ink">{m.content}</td>
            <td className="px-4 py-3 text-ink-soft">{m.subjectId}</td>
            <td className="px-4 py-3">
              <Badge tone={m.learnedInGroup ? "amber" : "blue"} dot={false}>
                {m.learnedInGroup ? "Nhóm" : "Chat riêng"}
              </Badge>
            </td>
            <td className="px-4 py-3 text-ink-soft">{formatTime(m.createdAt)}</td>
            <td className="px-4 py-3">
              <button onClick={() => remove(m.id)} className="text-[13px] text-red-600 hover:underline">
                Xóa
              </button>
            </td>
          </tr>
        ))}
      </TableShell>
    </div>
  );
}
