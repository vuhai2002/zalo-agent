import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type KbSourceListItem } from "../dashboard-api-client";
import { PageHeader } from "../layout/page-header";
import { useConfirmDialog } from "../shared/confirm-dialog";
import { IconFileText } from "../shared/dashboard-icons";
import { nhanKhopTuKhoa } from "../shared/fold-for-search";
import { EmptyRow, ListToolbar, TableShell } from "../shared/ui-bits";
import { KbAddSourceModal } from "./kb-add-source-modal";
import { KbChunksModal } from "./kb-chunks-modal";
import { xayThongDiepXoaNguon } from "./kb-delete-warning-message";
import { trangCuoiCungConDuLieu } from "./kb-page-clamp";
import { KbSourceRow } from "./kb-source-row";

// Phân trang phía CLIENT - `GET /api/kb/sources` chưa hỗ trợ offset/limit,
// và số nguồn của một kho thực tế hiếm khi vượt vài chục.
const KICH_TRANG = 20;

/**
 * Trang Kho tri thức: nạp tài liệu (file hoặc gõ tay) để agent tra cứu qua
 * tool `kb_search`. Xử lý (đọc file, cắt đoạn) chạy NỀN - trang này tự làm
 * mới định kỳ để thấy trạng thái `cho_xu_ly` -> `san_sang` mà không cần F5.
 *
 * LÙI CÓ CHỦ Ý (rà soát vòng 6, phase 06): 5 vòng liền đã thử tối ưu "dừng
 * poll khi hết việc" (B7) bằng vòng lặp tự quản lý lịch hẹn giờ
 * (`kb-poll-loop.ts` nối qua một lớp hook React đã xóa) - hạng mục đó CHỈ là
 * Minor của đợt rà soát trước, không nằm trong 5 lỗi Important (I17-I21) mà
 * phase 06 sinh ra để sửa. Cả 5 vòng đều đẻ ra hồi quy MỚI (chết sau 1 lần
 * tải hỏng, không tự khởi động lại, chồng lượt tái nhập, ghi sổ sai thứ tự,
 * rồi tới "25/540 kịch bản hệ thống tự mâu thuẫn" ở vòng thứ năm) - trạng
 * thái cuối cùng vẫn HẸP HƠN `setInterval` nguyên bản ở những chiều đo được.
 * `setInterval` đơn giản hơn vì đúng cấu trúc: không bao giờ dừng nên không
 * bao giờ "quên khởi động lại", không chết sau một lần tải hỏng, không có
 * cửa sổ tái nhập của riêng nó. Cái giá đổi lại: ~900 request/giờ mỗi tab
 * đang mở trên một endpoint đã bỏ toàn văn (`danhSachNguonGon`) - đây là
 * hành vi đã chạy suốt đời tính năng trước phase 06, không phải hồi quy.
 *
 * `kb-poll-loop.ts`/`kb-poll-guard.ts` (khóa được 8/9 chiều) + bộ test của
 * chúng GIỮ LẠI nguyên vẹn, KHÔNG nối vào giao diện - xem docstring đầu 2
 * file đó. Đây là tri thức sống về các bất biến đã học được qua 5 vòng vá,
 * và điểm khởi đầu cho ai làm lại tối ưu này (đã có hướng vá đo được đóng
 * nốt chiều 9 - ghi ở "Vấn đề / băn khoăn" của report phase 06).
 */
export function KnowledgePage() {
  const [sources, setSources] = useState<KbSourceListItem[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [xemDoanCua, setXemDoanCua] = useState<KbSourceListItem | null>(null);
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

  const daLoc = (sources ?? []).filter((s) => nhanKhopTuKhoa(s.ten, query));

  useEffect(() => setPage(0), [query]);
  // Việc 4.1: xóa nguồn cuối cùng của trang đang xem (hoặc gõ tìm kiếm hẹp
  // hơn) làm số trang thật GIẢM - trang đang đứng có thể vượt quá số trang
  // mới, hiện rỗng dù người dùng không hề đổi từ khóa. Kẹp về TRANG CUỐI còn
  // dữ liệu (không phải luôn về 0 - đang xem trang 5 mà mất 1 dòng thì về
  // trang 4, không ném thẳng về trang 1). Dùng `daLoc.length` (số nguyên) chứ
  // không phải `sources`/`daLoc` (mảng đổi tham chiếu mỗi lần poll) - để
  // không kéo người dùng về trang khác mỗi 4 giây khi SỐ LƯỢNG không hề đổi.
  useEffect(() => {
    const trangCuoi = trangCuoiCungConDuLieu(daLoc.length, KICH_TRANG);
    if (page > trangCuoi) setPage(trangCuoi);
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
