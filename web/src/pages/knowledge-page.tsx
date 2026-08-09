import { useEffect, useState } from "react";
import { api, ApiError, type KbSourceListItem } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { useConfirmDialog } from "../shared/confirm-dialog";
import { IconFileText } from "../shared/dashboard-icons";
import { nhanKhopTuKhoa } from "../shared/fold-for-search";
import { EmptyRow, ListToolbar, TableShell } from "../shared/ui-bits";
import { KbAddSourceModal } from "./kb-add-source-modal";
import { KbChunksModal } from "./kb-chunks-modal";
import { xayThongDiepXoaNguon } from "./kb-delete-warning-message";
import { useKbSourcePoll } from "./kb-source-poll";
import { KbSourceRow } from "./kb-source-row";

// Phân trang phía CLIENT - `GET /api/kb/sources` chưa hỗ trợ offset/limit,
// và số nguồn của một kho thực tế hiếm khi vượt vài chục.
const KICH_TRANG = 20;

/**
 * Trang Kho tri thức: nạp tài liệu (file hoặc gõ tay) để agent tra cứu qua
 * tool `kb_search`. Xử lý (đọc file, cắt đoạn) chạy NỀN - trang này tự làm
 * mới định kỳ để thấy trạng thái `cho_xu_ly` -> `san_sang` mà không cần F5,
 * nhưng DỪNG hẳn khi không còn nguồn nào đang chờ xử lý (B7).
 */
export function KnowledgePage() {
  const { sources, loadError, reload } = useKbSourcePoll();
  const [actionError, setActionError] = useState("");
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [xemDoanCua, setXemDoanCua] = useState<KbSourceListItem | null>(null);
  const { confirm, confirmDialog } = useConfirmDialog();

  const daLoc = (sources ?? []).filter((s) => nhanKhopTuKhoa(s.ten, query));

  useEffect(() => setPage(0), [query]);
  // Việc 4.1: xóa nguồn cuối cùng của trang đang xem (hoặc gõ tìm kiếm hẹp
  // hơn) làm số trang thật GIẢM - trang đang đứng có thể vượt quá số trang
  // mới, hiện rỗng dù người dùng không hề đổi từ khóa. Kẹp về trang cuối còn
  // dữ liệu (0 nếu shrink về dưới 1 trang). Dùng `daLoc.length` (số nguyên)
  // chứ không phải `sources`/`daLoc` (mảng đổi tham chiếu mỗi lần poll) - để
  // không kéo người dùng về trang 0 mỗi 4 giây khi SỐ LƯỢNG không hề đổi.
  useEffect(() => {
    if (page > 0 && page * KICH_TRANG >= daLoc.length) setPage(0);
  }, [daLoc.length, page]);

  async function reindex(id: string) {
    await api.kb.reindex(id);
    reload();
  }

  async function remove(source: KbSourceListItem) {
    // I19: hỏi ĐÚNG trước khi xóa - lấy trước số agent đang gán nguồn này để
    // nói thật họ sẽ mất quyền tra cứu. Route lỗi thì vẫn cho xóa tiếp (không
    // chặn cả luồng chỉ vì không đếm được), nhưng câu chữ phải nói thật là
    // "không kiểm tra được", không ngầm định 0 (xem kb-delete-warning-message.ts).
    let agentIds: string[] | null;
    try {
      agentIds = (await api.kb.agentsUsingSource(source.id)).agentIds;
    } catch {
      agentIds = null;
    }
    const ok = await confirm({ title: `Xóa nguồn "${source.ten}"?`, message: xayThongDiepXoaNguon(agentIds) });
    if (!ok) return;
    setActionError("");
    try {
      await api.kb.remove(source.id);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Xóa thất bại");
    }
  }

  const hasMore = (page + 1) * KICH_TRANG < daLoc.length;
  const trang = daLoc.slice(page * KICH_TRANG, (page + 1) * KICH_TRANG);

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

      {sources !== null && sources.length > 0 && (
        <ListToolbar
          query={query}
          onQuery={setQuery}
          placeholder="Tìm theo tên nguồn..."
          page={page}
          hasMore={hasMore}
          onPage={setPage}
        />
      )}

      <TableShell
        headers={["Tên", "Loại", "Định dạng", "Trạng thái", "Số đoạn", "Dung lượng", "Ngày", ""]}
        minWidth={980}
      >
        {sources === null ? (
          <EmptyRow colSpan={8} text="Đang tải..." />
        ) : sources.length === 0 ? (
          <EmptyRow colSpan={8} text='Chưa có nguồn nào - bấm "Thêm nguồn" để nạp tài liệu đầu tiên' />
        ) : trang.length === 0 ? (
          <EmptyRow colSpan={8} text={`Không có nguồn nào khớp "${query}"`} />
        ) : (
          trang.map((s) => (
            <KbSourceRow
              key={s.id}
              source={s}
              onReindex={() => reindex(s.id)}
              onDelete={() => void remove(s)}
              onViewChunks={() => setXemDoanCua(s)}
            />
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

      {xemDoanCua && <KbChunksModal source={xemDoanCua} onClose={() => setXemDoanCua(null)} />}

      {confirmDialog}
    </div>
  );
}
