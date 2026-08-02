import { formatNumber } from "../shared/ui-bits";

export type UsageDay = {
  day: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
};

/**
 * Biểu đồ cột mức dùng 7 ngày. Cột dọc thay cho thanh ngang: so sánh chiều cao
 * giữa các ngày dễ hơn nhiều so với so chiều dài các thanh xếp chồng, và trục
 * ngang là ngày nên đọc trái sang phải đúng chiều thời gian.
 *
 * SVG thuần, không thêm thư viện: chỉ có 6-7 cột và một trục, kéo cả một thư
 * viện chart vào bundle cho ngần này là không đáng.
 */
export function UsageBarChart({
  data,
  metric,
}: {
  data: UsageDay[];
  /** Đang xem số lượt hay số token - đổi cả trục lẫn nhãn trên đầu cột */
  metric: "turns" | "tokens";
}) {
  const giaTri = (d: UsageDay) => (metric === "turns" ? d.turns : d.inputTokens + d.outputTokens);
  // Trần của trục: cao hơn giá trị lớn nhất một chút để cột cao nhất không chạm
  // mép trên, và không bao giờ là 0 (chia cho 0 ra cột cao vô hạn)
  const max = Math.max(...data.map(giaTri), 1);

  return (
    <div>
      {/*
        `items-stretch` (mặc định của flex) chứ KHÔNG phải `items-end`: cột con
        cần cao bằng cả khung để `flex-1` bên trong có chỗ giãn. Dùng
        `items-end` ở đây thì mỗi cột co lại vừa nội dung (chỉ còn dòng số),
        `flex-1` không còn gì để chia và mọi thanh ra 0px - biểu đồ trống trơn.
      */}
      <div className="flex h-52 gap-2 sm:gap-3">
        {data.map((d) => {
          const v = giaTri(d);
          const caoPhanTram = (v / max) * 100;
          return (
            <div key={d.day} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <span className="text-[12px] font-semibold text-ink">{formatNumber(v)}</span>
              {/* Thanh luôn cao tối thiểu 2px: ngày có đúng 1 lượt mà vẽ ra 0px
                  thì nhìn y hệt ngày không có gì */}
              <div className="flex w-full min-h-0 flex-1 items-end">
                <div
                  className="w-full rounded-t-lg bg-zalo-500/85 transition-all hover:bg-zalo-500"
                  style={{ height: `max(2px, ${caoPhanTram}%)` }}
                  title={`${d.day}: ${formatNumber(d.turns)} lượt, ${formatNumber(
                    d.inputTokens + d.outputTokens,
                  )} token`}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Nhãn ngày tách khỏi vùng cột để mọi cột cùng đáy, không bị chữ đẩy lệch */}
      <div className="mt-2 flex gap-2 border-t border-line pt-2 sm:gap-3">
        {data.map((d) => (
          <div key={d.day} className="min-w-0 flex-1 text-center text-[12px] text-ink-soft">
            {d.day.slice(5)}
          </div>
        ))}
      </div>
    </div>
  );
}
