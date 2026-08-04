import type { ReactNode } from "react";
import { useChotNen } from "../shared/backdrop-close-guard";
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
  /**
   * Bỏ trống khi TIÊU ĐỀ BẬC + subtitle của modal đã nói đủ. Đo trên modal đọc
   * ảnh: subtitle mô tả nguyên chuỗi rồi mỗi bậc lại giải thích lại chính nó -
   * chú thích chiếm 69% số chữ mà phần lớn là lặp.
   */
  description?: string;
  enabled: boolean;
  /** Bậc bắt buộc - hiện nhãn thay cho toggle */
  locked?: boolean;
  onToggle?: () => void;
  children?: ReactNode;
}) {
  return (
    // Mỗi bậc là một VÙNG nền xám nhạt, không viền. Đã thử và hỏng hai cách:
    // khung viền cho mỗi bậc (khung lồng khung - 8 viền cho 4 ô nhập) và đường
    // kẻ mảnh border-t (quá mờ, user vẫn "chưa thấy phân cách giữa các phần").
    // Tương phản NỀN tách vùng rõ nhất mà không thêm nét nào, và ô nhập trắng
    // tự nổi hẳn lên trên nền xám.
    <div className="rounded-xl bg-tile p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/*
           * Tiêu đề bậc là NHÃN NHÓM: chữ nhỏ, viết hoa, giãn chữ, màu nhạt.
           * Khác HẲN nhãn ô (13px, đậm, màu đen) về kiểu chứ không phải chỉ về
           * cỡ - bản cũ để 14px/500 cạnh nhãn ô 13px/500, chênh 1px cùng độ
           * đậm nên mắt không biết cái nào chứa cái nào.
           */}
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
            {index}. {title}
          </div>
          {description && (
            <p className="mt-1.5 text-[12px] leading-[1.6] text-ink-soft">{description}</p>
          )}
        </div>
        {locked ? (
          <span className="shrink-0 whitespace-nowrap text-[11px] font-medium text-ink-soft/60">
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
      {children && <div className="mt-3 space-y-3">{children}</div>}
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
  const nen = useChotNen(onClose);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-[2px]"
      {...nen}
    >
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface p-5 shadow-xl">
        <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
        <p className="mt-1 text-[13px] leading-[1.6] text-ink-soft">{subtitle}</p>
        {/* Khoảng trắng giữa các vùng xám chính là phân cách - không cần kẻ */}
        <div className="mt-5 space-y-3">{children}</div>
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}

/**
 * Ô nhập có NHÃN trong modal.
 *
 * Trước đây vài ô chỉ có placeholder: điền xong là placeholder biến mất, không
 * còn gì cho biết ô nào là Base URL, ô nào là Model. Mỗi modal lại làm một kiểu.
 *
 * `hint` để chú thích NGẮN, chỉ dùng khi nói điều người đọc không tự suy ra
 * được từ nhãn. Đo trên modal cũ: chú thích chiếm 61-69% số chữ, phần lớn là
 * nhắc lại thứ nhãn đã nói.
 *
 * leading-[1.6] cho chữ nhỏ: tiếng Việt xếp dấu chồng lên nhau (ế, ộ, ữ) nên
 * cần giãn dòng rộng hơn tiếng Anh, không phải hẹp hơn.
 */
export function ModalField({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[13px] font-medium text-ink" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-[12px] leading-[1.6] text-ink-soft">{hint}</p>}
    </div>
  );
}

export const modalButton = {
  cancel:
    "rounded-lg border border-line px-4 py-2 text-[14px] font-medium text-ink-soft hover:bg-tile",
  primary:
    "rounded-lg bg-zalo-500 px-4 py-2 text-[14px] font-medium text-white hover:bg-zalo-600 disabled:cursor-not-allowed disabled:opacity-50",
  secondary:
    "rounded-lg border border-line bg-surface px-4 py-2 text-[14px] font-medium text-ink hover:bg-tile disabled:cursor-not-allowed disabled:opacity-50",
  danger: "rounded-lg px-4 py-2 text-[14px] text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50",
};
