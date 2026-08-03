/**
 * Khung một trường trên trang sửa agent - nhãn, gợi ý, rồi ô nhập bên dưới.
 *
 * Cỡ chữ bám đúng `TuningField` của trang Cấu hình (nhãn 14px medium, gợi ý
 * 12px `leading-[1.6]`) để hai màn hình thiết lập nhìn như một. Nhưng KHÔNG
 * chia trái/phải như bên đó: hai nhóm "Danh tính" và "Model" nằm cạnh nhau nên
 * mỗi thẻ chỉ còn nửa màn - chia đôi lần nữa là mỗi bên chỉ còn vài trăm pixel,
 * gợi ý vỡ dòng liên tục và ô nhập bị bóp.
 *
 * FLAT: không nền, không viền quanh từng trường. Đường kẻ ngăn cách do
 * `divide-y` của khối cha lo.
 */
export function AgentFormField({
  htmlFor,
  label,
  hint,
  ngang,
  children,
}: {
  /** Bỏ trống khi ô nhập không phải một control đơn (vd nhóm nhiều công tắc) */
  htmlFor?: string;
  label: string;
  hint?: string;
  /**
   * Chia hai cột y hệt `TuningField` của trang Cấu hình: nhãn VÀ gợi ý bên
   * trái, ô nhập bên phải trong cột rộng cố định để mọi ô thẳng một mép.
   *
   * Chỉ hợp với ô NGẮN (số, menu chọn). Ô dài (persona) để mặc định.
   */
  ngang?: boolean;
  children: React.ReactNode;
}) {
  const nhan = htmlFor ? (
    <label htmlFor={htmlFor} className="text-[14px] font-medium text-ink">
      {label}
    </label>
  ) : (
    <span className="text-[14px] font-medium text-ink">{label}</span>
  );

  if (ngang) {
    return (
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between xl:gap-6">
        <div className="min-w-0">
          {nhan}
          {hint && <p className="mt-0.5 text-[12px] leading-[1.6] text-ink-soft">{hint}</p>}
        </div>
        {/* 208px vừa cho menu "Theo Cấu hình chung" - ô rộng nhất trong nhóm.
            Cùng một bề rộng cho cả ba dòng nên ô nhập thẳng cột, đúng lý do đã
            đo ở trang Cấu hình. */}
        <div className="shrink-0 xl:w-52">{children}</div>
      </div>
    );
  }

  return (
    <div>
      {nhan}
      {hint && <p className="mb-3 mt-0.5 text-[12px] leading-[1.6] text-ink-soft">{hint}</p>}
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
    // KHÔNG `backdrop-blur-sm`: `backdrop-filter` tạo stacking context, nhốt
    // `z-30` của popup dropdown lại trong thẻ này - thẻ đứng sau trong DOM
    // ("Công cụ") vẽ đè lên và menu bị cắt ngang. Đo thật: chỗ ngay dưới popup
    // trả về phần tử của thẻ kia. Nền đã `bg-surface/95` nên bỏ blur không đổi
    // gì về mặt nhìn, chỉ còn 5% trong suốt.
    <div className="flex h-full flex-col rounded-2xl border border-line bg-surface/95 p-6">
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
  return <div className="py-4 first:pt-0">{children}</div>;
}
