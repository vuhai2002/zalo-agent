import type { ReactNode } from "react";
import { ToggleKnob } from "../shared/ui-bits";

/**
 * Khung + mảnh dùng chung cho các modal Settings mở từ dòng tool ở trang Tools,
 * theo mẫu "Extractor Chain" của GoClaw: liệt kê các bậc theo thứ tự thử, mỗi
 * bậc có toggle + cấu hình riêng. Tách khỏi từng modal để web_search/web_fetch
 * và vision dùng chung một bố cục.
 */

export function ChainStep({
  index,
  title,
  description,
  enabled,
  locked,
  onToggle,
  children,
}: {
  index: number;
  title: string;
  description: string;
  enabled: boolean;
  /** Bậc bắt buộc - hiện nhãn thay cho toggle */
  locked?: boolean;
  onToggle?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-tile px-1.5 py-0.5 text-[11px] font-medium text-ink-soft">
              #{index}
            </span>
            <span className="text-[14px] font-medium text-ink">{title}</span>
          </div>
          <p className="mt-1 text-[12.5px] text-ink-soft">{description}</p>
        </div>
        {locked ? (
          <span className="shrink-0 whitespace-nowrap rounded-full bg-tile px-2.5 py-1 text-[11px] font-medium text-ink-soft">
            Luôn bật
          </span>
        ) : onToggle ? (
          // shrink-0 bắt buộc: thiếu nó flex bóp nút về width 0 và toggle biến
          // mất hẳn dù ToggleKnob bên trong vẫn giữ 36px
          <button type="button" onClick={onToggle} aria-label={`Bật tắt ${title}`} className="shrink-0">
            <ToggleKnob on={enabled} />
          </button>
        ) : null}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

/** Khung modal: nền mờ bấm ra ngoài để đóng, thân cuộn được trên màn thấp */
export function ToolModalShell({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
        <p className="mt-1 text-[13px] text-ink-soft">{subtitle}</p>
        <div className="mt-4 space-y-3">{children}</div>
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}

export const modalButton = {
  cancel:
    "rounded-lg border border-line px-4 py-2 text-[14px] font-medium text-ink-soft hover:bg-tile",
  primary:
    "rounded-lg bg-zalo-500 px-4 py-2 text-[14px] font-medium text-white hover:bg-zalo-600 disabled:cursor-not-allowed disabled:opacity-50",
  secondary:
    "rounded-lg border border-line bg-white px-4 py-2 text-[14px] font-medium text-ink hover:bg-tile disabled:cursor-not-allowed disabled:opacity-50",
  danger: "rounded-lg px-4 py-2 text-[14px] text-red-600 hover:bg-red-50 disabled:opacity-50",
};
