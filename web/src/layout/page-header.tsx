import type { ReactNode } from "react";

/** Header trang theo mẫu: title 24px/600 + subtitle, slot phải cho action/chip */
export function PageHeader({
  title,
  subtitle,
  aside,
}: {
  title: string;
  subtitle: string;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
        <p className="mt-0.5 text-[14px] text-ink-soft">{subtitle}</p>
      </div>
      {aside}
    </div>
  );
}
