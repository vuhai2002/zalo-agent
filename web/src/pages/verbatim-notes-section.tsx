import { useCallback, useEffect, useState } from "react";
import type { AccountInfo, VerbatimNoteItem } from "../dashboard-api-client";
import { api } from "../dashboard-api-client";
import { AccountFilter, accountLabel } from "../shared/account-filter";
import { useConfirmDialog } from "../shared/confirm-dialog";
import { Badge, EmptyRow, formatTime, ListToolbar, O_GHIM_PHAI, TableShell } from "../shared/ui-bits";
import { VerbatimNoteViewModal } from "./verbatim-note-view-modal";

/**
 * Bảng ghi chú NGUYÊN VĂN (tool verbatim_note) trong trang Memory.
 *
 * Bấm dòng để xem nguyên văn trong hộp riêng (`VerbatimNoteViewModal`). Dồn
 * nội dung vào ô bảng thì một thông báo 700 ký tự làm cả bảng cao lêu nghêu.
 *
 * Xóa có hỏi lại (khác fact): ghi chú là đoạn người dùng nhờ giữ nguyên văn,
 * lỡ tay xóa là không dựng lại được.
 */
export function VerbatimNotesSection({ accounts }: { accounts: AccountInfo[] }) {
  const [items, setItems] = useState<VerbatimNoteItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [query, setQuery] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [page, setPage] = useState(0);
  const [dangXem, setDangXem] = useState<VerbatimNoteItem | null>(null);
  const { confirm, confirmDialog } = useConfirmDialog();

  const showAccountColumn = accounts.length > 1;
  const soCot = showAccountColumn ? 6 : 5;

  const reload = useCallback(() => {
    api
      .verbatimNotes(accountFilter, query, page)
      .then((data) => {
        setItems(data.items);
        setHasMore(data.hasMore);
      })
      .catch(() => setItems([]));
  }, [accountFilter, query, page]);

  useEffect(reload, [reload]);
  useEffect(() => setPage(0), [accountFilter, query]);

  async function remove(note: VerbatimNoteItem) {
    const ok = await confirm({
      title: "Xóa ghi chú?",
      message: `Xóa "${note.title}" của ${note.tenNguoi || note.subjectId}. Bot sẽ không gửi lại được đoạn này nữa.`,
    });
    if (!ok) return;
    await api.deleteVerbatimNote(note.accountId, note.id);
    reload();
  }

  return (
    <div>
      <ListToolbar
        query={query}
        onQuery={setQuery}
        placeholder="Tìm theo tên ghi chú, nội dung, người..."
        filter={<AccountFilter accounts={accounts} value={accountFilter} onChange={setAccountFilter} />}
        page={page}
        hasMore={hasMore}
        onPage={setPage}
      />

      <TableShell
        headers={
          showAccountColumn
            ? ["Ghi chú", "Account", "Của ai", "Lưu ở", "Cập nhật", ""]
            : ["Ghi chú", "Của ai", "Lưu ở", "Cập nhật", ""]
        }
        minWidth={showAccountColumn ? 880 : 760}
        ghimCotCuoi
      >
        {items.length === 0 && <EmptyRow colSpan={soCot} text="Chưa có ghi chú nguyên văn nào" />}
        {items.map((n) => (
          <tr
            key={n.id}
            onClick={() => setDangXem(n)}
            className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-tile/40"
          >
            <td className="max-w-md px-4 py-3">
              <div className="font-medium text-ink">{n.title}</div>
              <div className="text-[12px] text-ink-soft">{n.content.length} ký tự - bấm để xem nguyên văn</div>
            </td>
            {showAccountColumn && (
              <td className="px-4 py-3">
                <Badge tone="gray" dot={false}>{accountLabel(accounts, n.accountId)}</Badge>
              </td>
            )}
            <td className="px-4 py-3">
              <div className="text-ink">{n.tenNguoi || "Chưa rõ tên"}</div>
              <div className="text-[12px] text-ink-soft">{n.subjectId}</div>
            </td>
            <td className="px-4 py-3">
              <Badge tone={n.learnedInGroup ? "amber" : "blue"} dot={false}>
                {n.learnedInGroup ? "Nhóm" : "Chat riêng"}
              </Badge>
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-ink-soft">{formatTime(n.updatedAt)}</td>
            <td className={`px-4 py-3 ${O_GHIM_PHAI}`}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void remove(n);
                }}
                className="cursor-pointer text-[13px] text-red-600 hover:underline dark:text-red-400"
              >
                Xóa
              </button>
            </td>
          </tr>
        ))}
      </TableShell>
      {dangXem && <VerbatimNoteViewModal note={dangXem} onClose={() => setDangXem(null)} />}
      {confirmDialog}
    </div>
  );
}
