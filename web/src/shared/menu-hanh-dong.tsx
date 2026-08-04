import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconDots } from "./dashboard-icons";

/**
 * Menu ba chấm cho hành động PHỤ của một mục trong danh sách.
 *
 * Vì sao không dùng `SelectMenu`: cái kia là ô CHỌN GIÁ TRỊ (có giá trị đang
 * chọn, có dấu tích, chọn xong thì đổi state). Đây là danh sách VIỆC ĐỂ LÀM -
 * không có mục nào "đang được chọn". Nhét vào chung một component thì cả hai
 * đều phải mang thêm nhánh của bên kia.
 *
 * Đóng khi bấm ra ngoài hoặc Escape, giống `SelectMenu`.
 */
export function MenuHanhDong({
  ariaLabel,
  children,
}: {
  ariaLabel: string;
  /** Dùng `MucMenu` bên dưới. Nhận hàm để đóng menu sau khi bấm. */
  children: (dong: () => void) => ReactNode;
}) {
  const [mo, setMo] = useState(false);
  const goc = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mo) return;
    const raNgoai = (e: MouseEvent) => {
      if (goc.current && !goc.current.contains(e.target as Node)) setMo(false);
    };
    const phim = (e: KeyboardEvent) => e.key === "Escape" && setMo(false);
    document.addEventListener("mousedown", raNgoai);
    document.addEventListener("keydown", phim);
    return () => {
      document.removeEventListener("mousedown", raNgoai);
      document.removeEventListener("keydown", phim);
    };
  }, [mo]);

  return (
    <div ref={goc} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={mo}
        onClick={() => setMo((v) => !v)}
        className="rounded-lg p-1.5 text-ink-soft transition-colors hover:bg-tile hover:text-ink"
      >
        <IconDots size={16} />
      </button>

      {mo && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+4px)] z-30 min-w-40 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-lg shadow-ink/10"
        >
          {children(() => setMo(false))}
        </div>
      )}
    </div>
  );
}

export function MucMenu({
  onClick,
  icon: Icon,
  nguyHiem,
  disabled,
  children,
}: {
  onClick: () => void;
  icon?: (p: { size?: number; className?: string }) => ReactNode;
  /** Tô đỏ - dành cho hành động phá hủy */
  nguyHiem?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        nguyHiem
          ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
          : "text-ink hover:bg-tile"
      }`}
    >
      {Icon && <Icon size={14} className="shrink-0" />}
      {children}
    </button>
  );
}
