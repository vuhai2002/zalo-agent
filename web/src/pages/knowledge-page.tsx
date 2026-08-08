import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type KbSourceListItem } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { useConfirmDialog } from "../shared/confirm-dialog";
import { IconFileText } from "../shared/dashboard-icons";
import { EmptyRow, TableShell } from "../shared/ui-bits";
import { KbAddSourceModal } from "./kb-add-source-modal";
import { KbSourceRow } from "./kb-source-row";

/**
 * Trang Kho tri thức: nạp tài liệu (file hoặc gõ tay) để agent tra cứu qua
 * tool `kb_search`. Xử lý (đọc file, cắt đoạn) chạy NỀN - trang này tự làm
 * mới định kỳ để thấy trạng thái `cho_xu_ly` -> `san_sang` mà không cần F5.
 */
export function KnowledgePage() {
  const [sources, setSources] = useState<KbSourceListItem[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [adding, setAdding] = useState(false);
  const { confirm, confirmDialog } = useConfirmDialog();

  const reload = useCallback(() => {
    api.kb
      .sources()
      .then((d) => {
        setSources(d.items);
        setLoadError("");
      })
      .catch((err: unknown) => {
        setSources((cu) => cu ?? []);
        setLoadError(err instanceof ApiError ? err.message : "Không tải được danh sách nguồn");
      });
  }, []);

  useEffect(() => {
    reload();
    // Việc cắt đoạn chạy ở worker nền (kb-ingest-worker.ts, quét mỗi 5s) - tự
    // làm mới để trạng thái cho_xu_ly/dang_xu_ly chuyển sang san_sang/hong mà
    // người dùng không phải tự bấm F5.
    const timer = window.setInterval(reload, 4000);
    return () => window.clearInterval(timer);
  }, [reload]);

  async function reindex(id: string) {
    await api.kb.reindex(id);
    reload();
  }

  async function remove(source: KbSourceListItem) {
    const ok = await confirm({
      title: `Xóa nguồn "${source.ten}"?`,
      message: "Toàn bộ đoạn đã cắt của nguồn này cũng bị xóa, agent không tra cứu được nữa. Không khôi phục được.",
    });
    if (!ok) return;
    setActionError("");
    try {
      await api.kb.remove(source.id);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Xóa thất bại");
    }
  }

  return (
    <div>
      <PageHeader
        icon={IconFileText}
        title="Kho tri thức"
        subtitle="Tài liệu nạp ở đây được cắt đoạn để agent tra cứu qua công cụ kb_search - gán nguồn cho từng agent ở trang Agents"
        aside={
          <button
            onClick={() => setAdding(true)}
            className="cursor-pointer rounded-lg bg-zalo-500 px-4 py-2 text-[14px] font-medium text-white hover:bg-zalo-600"
          >
            Thêm nguồn
          </button>
        }
      />

      {actionError && <p className="mb-4 text-[13px] text-red-600 dark:text-red-400">{actionError}</p>}
      {loadError && <p className="mb-4 text-[13px] text-red-600 dark:text-red-400">{loadError}</p>}

      <TableShell
        headers={["Tên", "Loại", "Định dạng", "Trạng thái", "Số đoạn", "Dung lượng", "Ngày", ""]}
        minWidth={920}
      >
        {sources === null ? (
          <EmptyRow colSpan={8} text="Đang tải..." />
        ) : sources.length === 0 ? (
          <EmptyRow colSpan={8} text='Chưa có nguồn nào - bấm "Thêm nguồn" để nạp tài liệu đầu tiên' />
        ) : (
          sources.map((s) => (
            <KbSourceRow key={s.id} source={s} onReindex={() => reindex(s.id)} onDelete={() => void remove(s)} />
          ))
        )}
      </TableShell>

      {adding && (
        <KbAddSourceModal
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            reload();
          }}
        />
      )}

      {confirmDialog}
    </div>
  );
}
