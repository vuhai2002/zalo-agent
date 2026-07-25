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
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  const current = options.find((o) => o.value === value);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 rounded-lg border bg-white px-2.5 py-2 text-left text-[13.5px] text-ink transition-colors hover:bg-tile/50 ${
          open ? "border-zalo-500 ring-2 ring-zalo-100" : "border-line"
        }`}
      >
        {current?.dotClass && (
          <span className={`h-2 w-2 shrink-0 rounded-full ${current.dotClass}`} />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">{current?.label ?? "-"}</span>
        {current?.hint && (
          <span className="shrink-0 text-[11.5px] text-ink-soft">{current.hint}</span>
        )}
        <IconChevronDown
          size={15}
          className={`shrink-0 text-ink-soft transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-lg shadow-ink/5"
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-2.5 py-2 text-left text-[13.5px] transition-colors ${
                  active ? "bg-zalo-50 text-zalo-700" : "text-ink hover:bg-tile/60"
                }`}
              >
                {opt.dotClass && <span className={`h-2 w-2 shrink-0 rounded-full ${opt.dotClass}`} />}
                <span className="min-w-0 flex-1 truncate font-medium">{opt.label}</span>
                {opt.hint && <span className="shrink-0 text-[11.5px] text-ink-soft">{opt.hint}</span>}
                {active && <IconCheck size={14} className="shrink-0 text-zalo-600" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
