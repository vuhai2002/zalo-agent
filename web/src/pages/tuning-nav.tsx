import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { TuningGroup } from "../dashboard-api-client";
import { IconChevronRight } from "../shared/dashboard-icons";
import { GroupIconBox } from "./tuning-group-icon";

/**
 * Danh sách nhóm bên trái - CHỌN 1 lúc, không phải accordion mở-nhiều. Bấm
 * vào nhóm nào thì panel phải chỉ hiện đúng nhóm đó (`tuning-page.tsx`), nên ở
 * đây chỉ cần vẽ danh sách + trạng thái đang chọn, không tự quản state mở/đóng.
 *
 * MỘT card bọc ngoài, các mục ngăn nhau bằng đường kẻ mảnh - không phải 9 card
 * rời: danh sách rời tạo 9 khối viền + 9 bóng đổ chồng nhau, mắt phải nhảy qua
 * từng cái thay vì đọc trôi một mạch từ trên xuống.
 */
export function TuningNav({
  groups,
  dangChon,
  onChon,
}: {
  groups: TuningGroup[];
  dangChon: string;
  onChon: (groupId: string) => void;
}) {
  // Chiều cao THẬT của thẻ danh mục, nuôi cho mốc ghim bên dưới. Đo bằng
  // ResizeObserver chứ không tính tay: số nhóm do API trả về nên chiều cao đổi
  // khi danh sách đổi, và hằng số gõ cứng sẽ lệch âm thầm ngay lần thêm nhóm.
  const theRef = useRef<HTMLDivElement>(null);
  const [caoThe, setCaoThe] = useState(0);
  useLayoutEffect(() => {
    const el = theRef.current;
    if (!el) return;
    const theoDoi = new ResizeObserver(() => setCaoThe(el.offsetHeight));
    theoDoi.observe(el);
    return () => theoDoi.disconnect();
  }, []);

  return (
    /*
     * Cột danh mục GHIM lại khi cuộn nội dung bên phải. Trước đây nó cuộn đi
     * mất cùng nội dung: thẻ danh mục cao 738px còn khối cấu hình bên phải cao
     * tới 1190px, nên cuộn tới đáy là bên trái để lại 521px trống trơn.
     *
     * `lg:self-start` phải đi kèm `lg:sticky`: mặc định flex item bị kéo cao
     * bằng cả hàng (1190px), mà đã cao bằng khung thì `sticky` không còn chỗ
     * nào để ghim.
     *
     * MỐC GHIM tính theo chiều cao thẻ, không phải `top-0` cố định:
     *   min(0px, 100dvh - 3.5rem - chiều cao thẻ)
     * - Thẻ VỪA khung (màn cao): vế phải dương nên `min` chọn 0 -> ghim ở đỉnh,
     *   tức 28px dưới mép trên (mốc `top` cộng thêm `lg:py-7` của `<main>`).
     * - Thẻ CAO HƠN khung (màn thấp): vế phải âm -> thẻ trôi lên tiếp cùng nội
     *   dung cho tới khi ĐÁY thẻ chạm đáy khung rồi mới đứng lại, nên mục cuối
     *   luôn tới được mà không phải kéo hết trang.
     * 3.5rem = 28px lề trên + 28px lề dưới của `<main>`.
     *
     * Vì sao không dùng thẳng `bottom-0` cho gọn: đo cô lập trên Chrome, phần
     * tử CAO HƠN khung cuộn thì `bottom` không ghim gì cả - nó trôi đi hệt như
     * `static` (thẻ 500px trong khung 400px: đáy chạy 520 -> 320 -> 20 -> -380).
     * Đúng ca cần ghim nhất thì `bottom` vô dụng.
     *
     * CỐ Ý KHÔNG đặt `max-h` + `overflow-y-auto`: sinh thêm một thanh cuộn thứ
     * hai ngay cạnh thanh cuộn nội dung, đã thử và bị bác vì rối mắt.
     *
     * Chỉ từ `lg`: dưới đó hàng là `flex-col`, danh mục nằm TRÊN nội dung nên
     * ghim nó là chiếm mất màn hình điện thoại.
     */
    <nav
      aria-label="Danh mục cấu hình"
      style={{ "--cao-danh-muc": `${caoThe}px` } as CSSProperties}
      className="w-full shrink-0 lg:sticky lg:top-[min(0px,calc(100dvh-3.5rem-var(--cao-danh-muc,0px)))] lg:w-[20rem] lg:self-start"
    >
      <div ref={theRef} className="rounded-2xl border border-line bg-surface/95 p-2">
        {groups.map((g, i) => {
          const active = dangChon === g.id;
          // Đường kẻ ngăn cách vẽ ở mục TRÊN, và bỏ đi khi mục này hoặc mục
          // ngay trước nó đang được chọn - kẻ chạm vào viền của khối nền xanh
          // trông như một nét thừa cắt ngang.
          const keNgan = i > 0 && !active && dangChon !== groups[i - 1]?.id;
          return (
            <div key={g.id} className={keNgan ? "border-t border-line/70" : undefined}>
              <NavItem
                active={active}
                icon={<GroupIconBox groupId={g.id} size={20} />}
                title={g.title}
                hint={g.navHint}
                onClick={() => onChon(g.id)}
              />
            </div>
          );
        })}
      </div>
    </nav>
  );
}

function NavItem({
  active,
  icon,
  title,
  hint,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={`flex w-full items-center gap-3.5 rounded-xl px-4 py-3 text-left transition-colors ${
        active ? "bg-zalo-50" : "hover:bg-tile/50"
      }`}
    >
      {/* Icon TRẦN, không có ô vuông bo góc bọc ngoài - ảnh mẫu chỉ có mỗi hình
          icon, thêm khung nền là quay lại kiểu "khối lồng khối" */}
      <span className={`shrink-0 ${active ? "text-zalo-500" : "text-ink-soft"}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[14px] font-semibold ${active ? "text-zalo-700" : "text-ink"}`}>
          {title}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-ink-soft">{hint}</span>
      </span>
      <IconChevronRight size={16} className={active ? "text-zalo-500" : "text-ink-soft/40"} />
    </button>
  );
}
