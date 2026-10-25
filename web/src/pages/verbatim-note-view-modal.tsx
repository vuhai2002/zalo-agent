import type { VerbatimNoteItem } from "../dashboard-api-client";
import { useChotNen } from "../shared/backdrop-close-guard";
import { formatTime } from "../shared/ui-bits";

/**
 * Xem NGUYÊN VĂN một ghi chú, đúng thứ bot sẽ gửi lại: `whitespace-pre-wrap`
 * giữ xuống dòng, dòng trống, dấu cách đầu dòng. Hộp riêng thay vì bung dòng
 * trong bảng: bảng có bề rộng tối thiểu nên trên màn hẹp ô nội dung tràn sang
 * phải, phải cuộn ngang mới đọc hết (đã thấy khi kiểm trên trình duyệt).
 */
export function VerbatimNoteViewModal({ note, onClose }: { note: VerbatimNoteItem; onClose: () => void }) {
  const nen = useChotNen(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4 backdrop-blur-[2px]" {...nen}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-surface shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="truncate font-semibold text-ink">{note.title}</div>
            <div className="text-[12px] text-ink-soft">
              {note.tenNguoi || note.subjectId} - {note.content.length} ký tự - cập nhật {formatTime(note.updatedAt)}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 cursor-pointer rounded-lg border border-line px-3 py-1 text-[13px] text-ink-soft hover:bg-tile"
          >
            Đóng
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="gc-tile whitespace-pre-wrap break-words text-[14px] leading-[1.6] text-ink">{note.content}</p>
        </div>
      </div>
    </div>
  );
}
