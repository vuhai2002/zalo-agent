import type { ReactNode, SVGProps } from "react";

type IconFn = (p: SVGProps<SVGSVGElement> & { size?: number }) => ReactNode;

/**
 * Header trang: ô icon + title + subtitle, slot phải cho action/chip.
 *
 * Ô icon là thứ neo mắt khi chuyển trang - thiếu nó thì mỗi trang mở ra chỉ có
 * một dòng chữ trơ, và trang Cấu hình (vốn tự dựng header riêng có icon) nhìn
 * lạc hẳn khỏi phần còn lại. Icon để `optional` cho tương thích ngược, nhưng
 * mọi trang hiện tại đều truyền.
 */
export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  aside,
}: {
  icon?: IconFn;
  title: string;
  subtitle: string;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3.5">
        {Icon && (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-zalo-50 text-zalo-500">
            <Icon size={22} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-ink">{title}</h1>
          <p className="mt-0.5 text-[14px] text-ink-soft">{subtitle}</p>
        </div>
      </div>
      {aside}
    </div>
  );
}
