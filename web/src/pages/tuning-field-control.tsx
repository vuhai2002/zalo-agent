import type { TuningDef } from "../dashboard-api-client";
import { SelectMenu } from "../shared/select-menu";
import { ToggleKnob } from "../shared/ui-bits";
import { TimezoneSelect } from "./timezone-select";

/**
 * Cột bên PHẢI của một dòng cấu hình: ô nhập / công tắc / menu chọn, tùy `kind`.
 *
 * Tách khỏi `tuning-field.tsx` để file kia còn đúng phần trạng thái và bố cục
 * dòng. Component này không giữ state - nháp và việc lưu đều ở component cha,
 * đây chỉ vẽ và gọi ngược lên.
 */
export function TuningFieldControl({
  def,
  id,
  value,
  nhap,
  dangLuu,
  onNhap,
  onCommit,
  onCommitNumber,
}: {
  def: TuningDef;
  id: string;
  value: number | boolean | string;
  /** Bản nháp của ô số - chưa lưu cho tới khi rời ô hoặc bấm Enter */
  nhap: string;
  dangLuu: boolean;
  onNhap: (v: string) => void;
  onCommit: (v: number | boolean | string) => void;
  onCommitNumber: () => void;
}) {
  return (
    // Cột RỘNG CỐ ĐỊNH và căn TRÁI, để mọi ô nhập trên trang cùng một mép trái.
    // Căn phải (`justify-end`) từng làm lệch tới 96px giữa các dòng vì nó căn cả
    // cụm, mà cụm có đơn vị và khoảng giá trị dài ngắn khác nhau.
    //
    // 176px = ô nhập 112 + khoảng cách 8 + đơn vị dài nhất 43 ("kết quả"), và
    // vẫn chứa vừa khoảng giá trị dài nhất 130px ("(60.000 - 3.600.000)") ở
    // dòng dưới. Trước đây để cả đơn vị lẫn khoảng nằm ngang hàng thì cột ngốn
    // 296px, phần chữ bên trái bị bóp - mô tả vỡ 6-7 dòng, chip rớt xuống hàng.
    //
    // Ngưỡng là `xl` (1280px) chứ không phải `sm`: dưới mốc đó cột nav bên trái
    // đã ăn ~300px nên panel còn quá hẹp, đo ở 1025px thấy phần chữ chỉ còn
    // 165px. Hẹp hơn xl thì đổ dọc lại, dễ đọc hơn hẳn.
    //
    // Múi giờ vẫn cần rộng: nhãn "Asia/Ho_Chi_Minh (GMT+07:00)" đo được 235px,
    // cộng icon quả cầu, mũi tên và đệm là 314px - hẹp hơn thì cụt mất phần
    // offset, đúng thứ người dùng cần đối chiếu.
    <div
      className={`flex shrink-0 items-center gap-2 ${
        def.kind === "timezone" ? "xl:w-[20.5rem]" : "xl:w-44"
      }`}
    >
      {def.kind === "number" && (
        <div className="w-full">
          {/* ĐƠN VỊ ở lại cùng dòng với ô nhập - nó là một phần của con số
              ("7 ngày"), tách xuống dưới thì đọc rời rạc. Chỉ KHOẢNG GIÁ TRỊ
              xuống dòng, vì nó là chú thích chứ không phải phần của giá trị. */}
          <div className="flex items-center gap-2">
            <input
              id={id}
              type="number"
              className="gc-input w-28 shrink-0"
              min={def.min}
              max={def.max}
              value={nhap}
              disabled={dangLuu}
              onChange={(e) => onNhap(e.target.value)}
              onBlur={onCommitNumber}
              onKeyDown={(e) => e.key === "Enter" && onCommitNumber()}
            />
            {def.unit && (
              <span className="whitespace-nowrap text-[13px] text-ink-soft">{def.unit}</span>
            )}
          </div>
          <div className="mt-1 whitespace-nowrap text-[11px] text-ink-soft/70">
            ({def.min.toLocaleString("vi-VN")} - {def.max.toLocaleString("vi-VN")})
          </div>
        </div>
      )}

      {def.kind === "boolean" && (
        // Cùng công tắc với trang Tools thay cho ô tick + chữ "Đang bật": trang
        // này giờ đọc như trang kia, mà công tắc nói trạng thái bằng hình nên
        // bỏ được chữ.
        <button
          id={id}
          type="button"
          disabled={dangLuu}
          aria-label={def.label}
          aria-pressed={Boolean(value)}
          onClick={() => onCommit(!value)}
          className="disabled:cursor-wait disabled:opacity-50"
        >
          <ToggleKnob on={Boolean(value)} />
        </button>
      )}

      {def.kind === "enum" && (
        <div className="w-full sm:w-40 xl:w-full">
          <SelectMenu
            id={id}
            size="md"
            value={String(value)}
            disabled={dangLuu}
            options={def.options.map((o) => ({ value: o, label: NHAN_MUC[o] ?? o }))}
            onChange={onCommit}
          />
        </div>
      )}

      {def.kind === "timezone" && (
        <div className="w-full sm:w-[20.5rem] xl:w-full">
          <TimezoneSelect id={id} value={String(value)} disabled={dangLuu} onChange={onCommit} />
        </div>
      )}
    </div>
  );
}

/** Nhãn tiếng Việt cho mức suy nghĩ - "xhigh" trên màn hình thì không ai đoán được */
const NHAN_MUC: Record<string, string> = {
  off: "Tắt",
  low: "Thấp",
  medium: "Vừa",
  high: "Cao",
  xhigh: "Rất cao",
};
