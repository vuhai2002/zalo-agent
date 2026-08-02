/**
 * Khung một trường trên trang sửa agent - nhãn, gợi ý, rồi ô nhập.
 *
 * Tách ra để mọi section (danh tính, model, và nhóm Công cụ của phase sau) dùng
 * chung một khoảng cách và một cỡ chữ. Cố ý khớp đúng `TuningField` của trang
 * Cấu hình: nhãn 15px đậm, gợi ý 13px `leading-[1.7]` giới hạn `max-w-3xl`.
 * Hai trang cùng là "màn hình thiết lập" nên nhìn phải như một.
 *
 * FLAT: không nền, không viền quanh từng trường. Đường kẻ ngăn cách do
 * `divide-y` của khối cha lo.
 */
export function AgentFormField({
  htmlFor,
  label,
  hint,
  children,
}: {
  /** Bỏ trống khi ô nhập không phải một control đơn (vd nhóm nhiều tick) */
  htmlFor?: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-[15px] font-semibold text-ink">
            {label}
          </label>
        ) : (
          <span className="text-[15px] font-semibold text-ink">{label}</span>
        )}
      </div>
      {hint && <p className="mb-4 max-w-3xl text-[13px] leading-[1.7] text-ink-soft">{hint}</p>}
      {children}
    </div>
  );
}

/** Tiêu đề một nhóm trường, dùng ở đầu mỗi section của trang sửa agent */
export function AgentFormSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface/95 p-6 backdrop-blur-sm">
      <div className="mb-6">
        <h2 className="text-[19px] font-semibold text-ink">{title}</h2>
        {hint && <p className="mt-1.5 max-w-3xl text-[13px] leading-[1.7] text-ink-soft">{hint}</p>}
      </div>
      <div className="divide-y divide-line">{children}</div>
    </div>
  );
}

/** Một ô trong `divide-y` - đệm đúng nhịp của trang Cấu hình */
export function AgentFormRow({ children }: { children: React.ReactNode }) {
  return <div className="py-5 first:pt-0">{children}</div>;
}
