import { formatNumber } from "../shared/ui-bits";

export type UsageDay = {
  day: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
};

/**
 * Biểu đồ cột mức dùng. Cột dọc thay cho thanh ngang: so chiều cao giữa các
 * ngày dễ hơn nhiều so với so chiều dài các thanh xếp chồng, và trục ngang là
 * ngày nên đọc trái sang phải đúng chiều thời gian.
 *
 * HTML + CSS thuần, không thêm thư viện: chỉ có vài cột, một trục và mấy đường
 * lưới - kéo cả một thư viện chart vào bundle cho ngần này là không đáng.
 */
export function UsageBarChart({
  data,
  metric,
}: {
  data: UsageDay[];
  /** Đang xem số lượt hay số token - đổi cả thang đo lẫn nhãn trên đầu cột */
  metric: "turns" | "tokens";
}) {
  const giaTri = (d: UsageDay) => (metric === "turns" ? d.turns : d.inputTokens + d.outputTokens);
  const dinhTruc = tranTruc(Math.max(...data.map(giaTri), 0));
  // 5 vạch chia đều, vẽ từ trên xuống để khớp thứ tự đọc của trục
  const vach = Array.from({ length: 5 }, (_, i) => Math.round((dinhTruc / 4) * (4 - i)));
  // Ngày mới nhất tô đậm hơn - đó là con số người ta nhìn trước tiên
  const chiSoMoiNhat = data.length - 1;

  return (
    <div>
      <div className="flex gap-3">
        {/* Trục Y: nhãn số căn phải, cao bằng vùng cột để từng nhãn nằm đúng
            đường lưới tương ứng */}
        <div className="flex h-52 w-10 shrink-0 flex-col justify-between text-right text-[11px] tabular-nums text-ink-soft">
          {vach.map((v) => (
            <span key={v} className="leading-none">
              {formatNumber(v)}
            </span>
          ))}
        </div>

        <div className="relative h-52 min-w-0 flex-1">
          {/* Lưới ngang nét đứt vẽ TRƯỚC cột trong cây DOM nên nằm dưới - kẻ đè
              lên cột làm mặt cột trông như bị gạch ngang */}
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
            {vach.map((v) => (
              <div key={v} className="border-t border-dashed border-line" />
            ))}
          </div>

          <div className="relative flex h-full items-end gap-2 sm:gap-4">
            {data.map((d, i) => {
              const v = giaTri(d);
              const cao = dinhTruc > 0 ? (v / dinhTruc) * 100 : 0;
              const noiBat = i === chiSoMoiNhat;
              return (
                <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
                  <span
                    className={`mb-1.5 text-[12px] font-semibold tabular-nums ${
                      noiBat ? "text-zalo-600" : "text-ink-soft"
                    }`}
                  >
                    {formatNumber(v)}
                  </span>
                  {/*
                    Cột KHÔNG chiếm hết bề ngang ô: `max-w` để lại khoảng hở hai
                    bên, nếu không các cột dính liền thành một mảng màu đặc.
                    Cao tối thiểu 3px để ngày có đúng 1 lượt vẫn nhìn thấy được,
                    thay vì mất hút y như ngày không có gì.
                  */}
                  <div
                    className={`w-full max-w-[72px] rounded-t-md transition-colors ${
                      noiBat ? "bg-zalo-500" : "bg-zalo-500/45 hover:bg-zalo-500/70"
                    }`}
                    style={{ height: `max(3px, ${cao}%)` }}
                    title={`${d.day}: ${formatNumber(d.turns)} lượt, ${formatNumber(
                      d.inputTokens + d.outputTokens,
                    )} token`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Nhãn ngày tách khỏi vùng cột để mọi cột cùng đáy, không bị chữ đẩy lệch.
          `w-10 + gap-3` khớp đúng bề ngang trục Y ở trên để nhãn thẳng cột. */}
      <div className="mt-2 flex gap-3">
        <div className="w-10 shrink-0" />
        <div className="flex min-w-0 flex-1 gap-2 border-t border-line pt-2 sm:gap-4">
          {data.map((d) => (
            <div key={d.day} className="min-w-0 flex-1 text-center text-[12px] tabular-nums text-ink-soft">
              {d.day.slice(5)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Làm tròn đỉnh trục lên "số đẹp" (20, 50, 500...) để 5 vạch chia hết, không ra
 * nhãn kiểu 18 / 13,5 / 9 / 4,5 / 0. Trả tối thiểu 4 để dữ liệu toàn 0 vẫn có
 * trục đọc được thay vì cả 5 vạch cùng là 0.
 */
function tranTruc(max: number): number {
  if (max <= 4) return 4;
  // Bậc tính theo BƯỚC (max/4) chứ không theo max: chọn hệ số cho cả đỉnh rồi
  // mới chia 4 sẽ ra bước lẻ (63 -> đỉnh 75 -> vạch 75/56/38/19). Làm tròn từng
  // BƯỚC lên số đẹp rồi nhân 4 thì mọi vạch đều là bội của bước đó.
  const buoc = max / 4;
  const bac = 10 ** Math.floor(Math.log10(buoc));
  const buocDep = [1, 2, 2.5, 5, 10].map((h) => bac * h).find((b) => b >= buoc) ?? buoc;
  return buocDep * 4;
}
