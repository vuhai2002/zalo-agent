import { useEffect, useMemo, useRef, useState } from "react";
import { IconCheck, IconSearch } from "./dashboard-icons";
import { nhanKhopTuKhoa } from "./fold-for-search";
import type { SelectOption } from "./select-menu";

/**
 * Phần bung ra của `SelectMenu`: ô tìm kiếm (khi danh sách dài) + danh sách
 * option + điều hướng bàn phím.
 *
 * Điểm khác bản trước: focus KHÔNG nhảy sang từng option nữa mà ở yên trên một
 * phần tử (ô tìm kiếm, hoặc chính khung popup khi không có ô tìm) và dùng
 * `aria-activedescendant` để báo cho trình đọc màn hình biết đang trỏ tới mục
 * nào. Bản cũ gọi `.focus()` lên từng nút - đúng khi chưa có ô tìm kiếm, nhưng
 * kèm ô tìm thì mỗi lần bấm mũi tên là con trỏ văn bản rời ô, gõ tiếp một chữ
 * nữa là hỏng.
 */

/** Từ bao nhiêu option thì hiện ô tìm kiếm. 418 múi giờ mà cuộn tay thì không xong */
export const NGUONG_HIEN_O_TIM = 12;

export function SelectMenuPopup({
  options,
  value,
  onPick,
  onClose,
  idPopup,
  moLen,
}: {
  options: SelectOption[];
  value: string;
  onPick: (value: string) => void;
  onClose: () => void;
  idPopup: string;
  /** true = bung LÊN trên vì phía dưới không đủ chỗ */
  moLen: boolean;
}) {
  const coOTim = options.length >= NGUONG_HIEN_O_TIM;
  const [tuKhoa, setTuKhoa] = useState("");
  const khungRef = useRef<HTMLDivElement>(null);
  const oTimRef = useRef<HTMLInputElement>(null);
  const dsRef = useRef<HTMLDivElement>(null);

  const loc = useMemo(
    () => (coOTim ? options.filter((o) => nhanKhopTuKhoa(o.label, tuKhoa)) : options),
    [options, tuKhoa, coOTim],
  );

  /** Chỉ số đang trỏ tới TRONG danh sách đã lọc; -1 khi lọc ra rỗng */
  const [troToi, setTroToi] = useState(0);

  // Lọc lại thì con trỏ phải về đầu: giữ chỉ số cũ là trỏ vào một mục hoàn toàn
  // khác, bấm Enter chọn nhầm thứ người dùng không hề nhìn thấy.
  useEffect(() => {
    setTroToi(loc.length ? Math.max(0, loc.findIndex((o) => o.value === value)) : -1);
  }, [loc, value]);

  useEffect(() => {
    (coOTim ? oTimRef.current : khungRef.current)?.focus();
  }, [coOTim]);

  // Cuộn mục đang trỏ vào tầm nhìn. Thiếu bước này thì mở danh sách 418 múi giờ
  // ra là thấy mục đầu bảng chữ cái, không thấy múi giờ đang chọn ở đâu cả.
  useEffect(() => {
    if (troToi < 0) return;
    dsRef.current?.querySelector(`[data-i="${troToi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [troToi]);

  function chon(i: number) {
    const o = loc[i];
    if (!o || o.disabled) return;
    onPick(o.value);
  }

  /** Bước tới option BẬT được gần nhất theo hướng `buoc`, bỏ qua mục bị khóa */
  function diChuyen(buoc: number) {
    if (!loc.length) return;
    setTroToi((cu) => {
      let i = cu;
      for (let n = 0; n < loc.length; n++) {
        i = (i + buoc + loc.length) % loc.length;
        if (!loc[i]?.disabled) return i;
      }
      return cu;
    });
  }

  function phimXuong(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      diChuyen(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setTroToi(e.key === "Home" ? 0 : loc.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      chon(troToi);
    } else if (e.key === "Escape" || e.key === "Tab") {
      onClose();
    }
  }

  return (
    <div
      ref={khungRef}
      tabIndex={-1}
      onKeyDown={phimXuong}
      className={`absolute left-0 right-0 z-30 min-w-max overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-lg shadow-ink/10 outline-none ${
        moLen ? "bottom-[calc(100%+4px)]" : "top-[calc(100%+4px)]"
      }`}
    >
      {coOTim && (
        <div className="relative border-b border-line px-2 pb-1.5 pt-1">
          <IconSearch
            size={14}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-soft"
          />
          <input
            ref={oTimRef}
            value={tuKhoa}
            onChange={(e) => setTuKhoa(e.target.value)}
            placeholder="Tìm..."
            aria-label="Tìm trong danh sách"
            aria-activedescendant={troToi >= 0 ? `${idPopup}-${troToi}` : undefined}
            className="w-full rounded-lg bg-tile/60 py-1.5 pl-7 pr-2 text-[13px] text-ink outline-none placeholder:text-ink-soft/60"
          />
        </div>
      )}

      <div ref={dsRef} role="listbox" className="max-h-64 overflow-y-auto py-1">
        {loc.length === 0 && (
          <p className="px-3 py-2 text-[13px] text-ink-soft">Không có mục nào khớp.</p>
        )}
        {loc.map((opt, i) => (
          <DongOption
            key={opt.value}
            opt={opt}
            i={i}
            id={`${idPopup}-${i}`}
            daChon={opt.value === value}
            dangTro={i === troToi}
            onPick={() => chon(i)}
          />
        ))}
      </div>
    </div>
  );
}

function DongOption({
  opt,
  i,
  id,
  daChon,
  dangTro,
  onPick,
}: {
  opt: SelectOption;
  i: number;
  id: string;
  daChon: boolean;
  dangTro: boolean;
  onPick: () => void;
}) {
  // div chứ không phải button: focus ở yên trên ô tìm kiếm, mục đang trỏ chỉ
  // báo qua aria-activedescendant. `onMouseDown` + preventDefault để chuột
  // không giật focus khỏi ô tìm kiếm rồi làm popup tự đóng.
  return (
    <div
      id={id}
      data-i={i}
      role="option"
      aria-selected={daChon}
      aria-disabled={opt.disabled || undefined}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      className={`flex items-center gap-2 px-2.5 py-2 text-[13px] transition-colors ${
        opt.disabled
          ? "cursor-not-allowed text-ink-soft/50"
          : daChon
            ? "cursor-pointer bg-zalo-50 text-zalo-700 dark:bg-zalo-950/50 dark:text-zalo-300"
            : `cursor-pointer text-ink ${dangTro ? "bg-tile/70" : "hover:bg-tile/60"}`
      }`}
    >
      {opt.dotClass && <span className={`h-2 w-2 shrink-0 rounded-full ${opt.dotClass}`} />}
      <span className="min-w-0 flex-1 truncate font-medium">{opt.label}</span>
      {opt.hint && <span className="shrink-0 text-[11px] text-ink-soft">{opt.hint}</span>}
      {daChon && <IconCheck size={14} className="shrink-0 text-zalo-600 dark:text-zalo-300" />}
    </div>
  );
}
