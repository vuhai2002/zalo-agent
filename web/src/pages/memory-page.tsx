import { useCallback, useEffect, useState } from "react";
import type { MemoryFactItem } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { Badge, EmptyRow, formatTime, Pager, TableShell } from "../shared/ui-bits";

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
      <h1 className="mb-1 text-2xl font-semibold text-slate-900">Memory</h1>
      <p className="mb-6 text-sm text-slate-500">
        Fact bot tự ghi nhớ qua tool save_memory. Fact học ở chat riêng không bao giờ được dùng trong nhóm.
      </p>

      <div className="mb-4 flex items-center justify-between gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm trong nội dung hoặc subject ID..."
          className="w-80 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-zalo-500 focus:ring-2 focus:ring-zalo-100"
        />
        <Pager page={page} hasMore={hasMore} onPage={setPage} />
      </div>

      <TableShell headers={["Fact", "Về", "Học từ", "Lúc", ""]}>
        {items.length === 0 && <EmptyRow colSpan={5} text="Bot chưa ghi nhớ gì" />}
        {items.map((m) => (
          <tr key={m.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
            <td className="max-w-md px-4 py-3 text-slate-800">{m.content}</td>
            <td className="px-4 py-3 text-slate-500">{m.subjectId}</td>
            <td className="px-4 py-3">
              <Badge tone={m.learnedInGroup ? "gray" : "blue"}>
                {m.learnedInGroup ? "Nhóm" : "Chat riêng"}
              </Badge>
            </td>
            <td className="px-4 py-3 text-slate-500">{formatTime(m.createdAt)}</td>
            <td className="px-4 py-3">
              <button
                onClick={() => remove(m.id)}
                className="text-sm text-red-600 hover:underline"
              >
                Xóa
              </button>
            </td>
          </tr>
        ))}
      </TableShell>
    </div>
  );
}
