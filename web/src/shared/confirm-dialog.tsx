import { useCallback, useEffect, useRef, useState } from "react";
import { useChotNen } from "./backdrop-close-guard";
import { IconWarning } from "./dashboard-icons";

/**
 * Hộp thoại xác nhận theo design system, thay `window.confirm` - hộp thoại
 * mặc định của trình duyệt hiện cả tên host ("localhost:3900 says") và không
 * style được, nhìn lạc hẳn khỏi dashboard.
 *
 * Dùng:
 *   const { confirm, confirmDialog } = useConfirmDialog();
 *   if (!(await confirm({ title, message }))) return;
 *   ...
 *   return (<>...{confirmDialog}</>);
 */

export type ConfirmOptions = {
  title: string;
  message: string;
  /** Nhãn nút xác nhận - mặc định "Xóa" vì phần lớn call site là hành động xóa */
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger = nút đỏ + icon cảnh báo (mặc định), normal = nút xanh */
  tone?: "danger" | "normal";
};

export function useConfirmDialog() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  // Giữ resolve của Promise đang chờ để nút bấm trả kết quả về đúng lời gọi
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const close = useCallback((ok: boolean) => {
    resolveRef.current?.(ok);
    resolveRef.current = null;
    setOptions(null);
  }, []);

  const confirmDialog = options ? (
    <ConfirmDialog options={options} onClose={close} />
  ) : null;

  return { confirm, confirmDialog };
}

function ConfirmDialog({
  options,
  onClose,
}: {
  options: ConfirmOptions;
  onClose: (ok: boolean) => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const danger = (options.tone ?? "danger") === "danger";
  const nen = useChotNen(() => onClose(false));

  useEffect(() => {
    confirmRef.current?.focus();
    // Esc để hủy - giữ đúng phản xạ của hộp thoại gốc
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    // z cao hơn modal thường (z-50) vì thường mở TỪ trong một modal
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/30 p-4 backdrop-blur-[2px]"
      {...nen}
      role="dialog"
      aria-modal="true"
    >
      {/* Trần chiều cao + cuộn nội bộ: cửa sổ thấp (điện thoại nằm ngang,
          laptop zoom cao) làm hộp này tràn khỏi màn mà KHÔNG cuộn được - lớp
          phủ là `fixed inset-0` nên trang cuộn cũng không kéo nó vào. `dvh`
          chứ không `vh` để trên điện thoại còn trừ đúng phần thanh địa chỉ
          đang chiếm chỗ. */}
      <div className="max-h-[85dvh] w-full max-w-sm overflow-y-auto rounded-2xl bg-surface p-5 shadow-xl">
        <div className="flex gap-3.5">
          {danger && (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400">
              <IconWarning size={19} />
            </span>
          )}
          <div className="min-w-0 pt-0.5">
            <h2 className="text-[15px] font-semibold text-ink">{options.title}</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{options.message}</p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onClose(false)}
            className="rounded-lg border border-line px-4 py-2 text-[14px] font-medium text-ink-soft hover:bg-tile"
          >
            {options.cancelLabel ?? "Hủy"}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => onClose(true)}
            className={`rounded-lg px-4 py-2 text-[14px] font-medium text-white ${
              danger ? "bg-red-600 hover:bg-red-700" : "bg-zalo-500 hover:bg-zalo-600"
            }`}
          >
            {options.confirmLabel ?? "Xóa"}
          </button>
        </div>
      </div>
    </div>
  );
}
