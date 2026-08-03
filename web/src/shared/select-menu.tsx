import { useEffect, useRef, useState } from "react";
import { IconCheck, IconChevronDown } from "./dashboard-icons";

/**
 * Dropdown tự dựng thay cho <select> native: popup của OS không style được
 * (trên Windows ra highlight xanh hệ thống, lệch hẳn với phần còn lại của UI).
 * Đóng khi click ra ngoài hoặc Escape; giữ focus ring nhất quán với .gc-input.
 */

export type SelectOption = {
  value: string;
  label: string;
  /** Chấm trạng thái bên trái, vd bg-emerald-500 */
  dotClass?: string;
  /** Chữ phụ bên phải, vd "online" */
  hint?: string;
};

export function SelectMenu({
  value,
  options,
  onChange,
  ariaLabel,
  id,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  /** Gắn với `<label htmlFor>` - `button` là phần tử labelable, click label focus/mở được menu */
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  /** Option con trỏ bàn phím đang ở - `-1` nghĩa là chưa di chuyển lần nào */
  const [troToi, setTroToi] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const nutRef = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Đưa focus THẬT theo con trỏ. Không có bước này thì mũi tên chỉ đổi
  // `tabIndex` còn focus vẫn nằm ở nút mở, tức là bấm Enter không chọn được gì
  // và trình đọc màn hình cũng không đọc option đang trỏ tới.
  useEffect(() => {
    if (!open || troToi < 0) return;
    nutRef.current[troToi]?.focus();
  }, [open, troToi]);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={rootRef} className="relative">
      <button
        id={id}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setTroToi(options.findIndex((o) => o.value === value));
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          // Mở bằng mũi tên/Enter/Space như `<select>` native. Control tự dựng
          // mà chỉ bấm được bằng chuột thì người dùng bàn phím kẹt hẳn.
          if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setTroToi(options.findIndex((o) => o.value === value));
            setOpen(true);
          }
        }}
        className={`flex w-full items-center gap-2 rounded-lg border bg-surface px-2.5 py-2 text-left text-[13px] text-ink transition-colors hover:bg-tile/50 ${
          open ? "border-zalo-500 ring-2 ring-zalo-100" : "border-line"
        }`}
      >
        {current?.dotClass && (
          <span className={`h-2 w-2 shrink-0 rounded-full ${current.dotClass}`} />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">{current?.label ?? "-"}</span>
        {current?.hint && (
          <span className="shrink-0 text-[11px] text-ink-soft">{current.hint}</span>
        )}
        <IconChevronDown
          size={15}
          className={`shrink-0 text-ink-soft transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const buoc = e.key === "ArrowDown" ? 1 : -1;
              // Chạy vòng: xuống ở cuối thì về đầu, giống `<select>` native
              setTroToi((cu) => (cu + buoc + options.length) % options.length);
            } else if (e.key === "Home" || e.key === "End") {
              e.preventDefault();
              setTroToi(e.key === "Home" ? 0 : options.length - 1);
            }
          }}
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-lg shadow-ink/5"
        >
          {options.map((opt, i) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                ref={(el) => {
                  nutRef.current[i] = el;
                }}
                type="button"
                role="option"
                aria-selected={active}
                tabIndex={i === troToi ? 0 : -1}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-2.5 py-2 text-left text-[13px] transition-colors ${
                  active ? "bg-zalo-50 text-zalo-700" : "text-ink hover:bg-tile/60"
                }`}
              >
                {opt.dotClass && <span className={`h-2 w-2 shrink-0 rounded-full ${opt.dotClass}`} />}
                <span className="min-w-0 flex-1 truncate font-medium">{opt.label}</span>
                {opt.hint && <span className="shrink-0 text-[11px] text-ink-soft">{opt.hint}</span>}
                {active && <IconCheck size={14} className="shrink-0 text-zalo-600" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
