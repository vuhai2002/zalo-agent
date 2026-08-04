import { useEffect, useId, useRef, useState, type ComponentType, type SVGProps } from "react";
import { IconChevronDown } from "./dashboard-icons";
import { SelectMenuPopup } from "./select-menu-popup";

/**
 * Dropdown tự dựng thay cho `<select>` native: popup của OS không style được
 * (trên Windows ra highlight xanh hệ thống, phông chữ hệ thống, lệch hẳn với
 * phần còn lại của UI). Đóng khi bấm ra ngoài hoặc Escape.
 *
 * Danh sách dài thì popup tự có ô tìm kiếm và tự cuộn - xem
 * `select-menu-popup.tsx`. Đây là điều kiện để thay được ô chọn múi giờ: 418
 * mục mà không tìm được thì cuộn tay còn tệ hơn `<select>` native (native ít
 * nhất còn gõ chữ để nhảy tới).
 */

export type SelectOption = {
  value: string;
  label: string;
  /** Chấm trạng thái bên trái, vd bg-emerald-500 */
  dotClass?: string;
  /** Chữ phụ bên phải, vd "online" */
  hint?: string;
  /** Hiện ra nhưng không chọn được - dùng cho lựa chọn cần điều kiện chưa có */
  disabled?: boolean;
};

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

export function SelectMenu({
  value,
  options,
  onChange,
  ariaLabel,
  id,
  disabled,
  icon: Icon,
  size = "sm",
  placeholder = "-",
  prefix,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  /** Gắn với `<label htmlFor>` - `button` là phần tử labelable, bấm nhãn là mở được menu */
  id?: string;
  disabled?: boolean;
  /** Icon nằm trong ô, bên trái - cho ô mà nhãn không tự nói lên nó là gì (múi giờ) */
  icon?: IconComponent;
  /** "md" khớp cỡ chữ và padding của `.gc-input` để đứng cạnh ô nhập không bị lệch */
  size?: "sm" | "md";
  placeholder?: string;
  /**
   * Chữ mô tả đứng trước giá trị đang chọn, vd "Sắp xếp:". Chỉ hiện ở ô đóng,
   * KHÔNG lẫn vào từng dòng trong popup - nhét vào `label` thì mở ra thấy
   * "Sắp xếp:" lặp lại ở mọi dòng, và ô tìm trong popup phải gõ cả tiền tố mới
   * khớp. Có tiền tố thì cả cụm thu về 13px: nhãn dài ra nên phải nhường chỗ.
   */
  prefix?: string;
}) {
  const [open, setOpen] = useState(false);
  const [moLen, setMoLen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const idPopup = useId();

  useEffect(() => {
    if (!open) return;
    const raNgoai = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", raNgoai);
    return () => document.removeEventListener("mousedown", raNgoai);
  }, [open]);

  function moMenu() {
    // Đo TRƯỚC khi bung: popup cao tối đa ~300px, ô chọn nằm cuối trang mà cứ
    // bung xuống thì danh sách chạy ra ngoài khung nhìn và người dùng phải cuộn
    // cả trang mới thấy. Dưới không đủ chỗ mà trên rộng hơn thì bung ngược lên.
    const o = rootRef.current?.getBoundingClientRect();
    if (o) {
      const duoi = window.innerHeight - o.bottom;
      setMoLen(duoi < CAO_POPUP_UOC_LUONG && o.top > duoi);
    }
    setOpen(true);
  }

  const current = options.find((o) => o.value === value);
  const md = size === "md";

  return (
    <div ref={rootRef} className="relative">
      {Icon && (
        <Icon
          size={md ? 17 : 15}
          className={`pointer-events-none absolute top-1/2 z-10 -translate-y-1/2 text-ink-soft ${
            md ? "left-3.5" : "left-2.5"
          } ${disabled ? "opacity-50" : ""}`}
        />
      )}
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : moMenu())}
        onKeyDown={(e) => {
          // Mở bằng mũi tên/Enter/Space như `<select>` native. Control tự dựng
          // mà chỉ bấm được bằng chuột thì người dùng bàn phím kẹt hẳn.
          if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            moMenu();
          }
        }}
        className={`flex w-full items-center gap-2 rounded-lg border bg-surface text-left text-ink transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          // pr rộng hơn pl một nhịp: mũi tên sát mép ô trông như bị tràn ra
          // ngoài viền, đây đúng là chỗ `<select>` native làm xấu nhất.
          md ? "px-3 py-2 pr-3.5 text-[15px]" : "px-2.5 py-2 pr-3 text-[13px]"
        } ${Icon ? (md ? "pl-10" : "pl-8") : ""} ${
          open ? "border-zalo-500 ring-2 ring-zalo-100 dark:ring-zalo-900/60" : "border-line"
        } ${disabled ? "" : "hover:bg-tile/50"}`}
      >
        {current?.dotClass && <span className={`h-2 w-2 shrink-0 rounded-full ${current.dotClass}`} />}
        {/* `leading-[22px]`: chữ nhỏ đi nhưng ô phải cao y như `.gc-input` bên
            cạnh, không thì ba control trên cùng một hàng lệch nhau vài pixel */}
        {prefix && (
          <span className="shrink-0 text-[13px] font-normal leading-[22px] text-ink-soft">{prefix}</span>
        )}
        <span
          className={`min-w-0 flex-1 truncate ${
            prefix ? "text-[13px] font-semibold leading-[22px]" : "font-medium"
          } ${current ? "" : "text-ink-soft"}`}
        >
          {current?.label ?? placeholder}
        </span>
        {current?.hint && <span className="shrink-0 text-[11px] text-ink-soft">{current.hint}</span>}
        <IconChevronDown
          size={md ? 17 : 15}
          className={`shrink-0 text-ink-soft transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <SelectMenuPopup
          options={options}
          value={value}
          idPopup={idPopup}
          moLen={moLen}
          onPick={(v) => {
            onChange(v);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/** Ước lượng chiều cao popup lúc bung hết cỡ (ô tìm + danh sách max-h-64 + viền) */
const CAO_POPUP_UOC_LUONG = 300;
