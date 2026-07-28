import type { TuningDef } from "../dashboard-api-client";

/**
 * Một ô cấu hình. Tách khỏi trang vì phải xử lý ba kiểu (số, bật/tắt, chọn) và
 * trạng thái "đang lấy từ .env" - nhồi hết vào trang thì trang thành một khối
 * điều kiện chằng chịt.
 *
 * Chỗ đáng chú ý về mặt nhìn: ô đang lấy giá trị từ `.env` trông y hệt ô đã
 * chỉnh, nên phải có nhãn phân biệt - nếu không người dùng đọc số trên màn hình
 * rồi tưởng mình đã đặt nó, trong khi sửa `.env` vẫn đổi được.
 */
export function TuningField({
  name,
  def,
  value,
  fromEnv,
  daDoi,
  onChange,
  onReset,
}: {
  name: string;
  def: TuningDef;
  value: number | boolean | string;
  fromEnv: boolean;
  daDoi: boolean;
  onChange: (v: number | boolean | string) => void;
  onReset: () => void;
}) {
  const id = `tuning-${name}`;

  return (
    <div className="rounded-xl bg-tile p-4">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <label htmlFor={id} className="text-[14px] font-medium text-ink">
          {def.label}
        </label>
        {fromEnv ? (
          <span className="rounded bg-white px-1.5 py-0.5 text-[11px] text-ink-soft">theo .env</span>
        ) : (
          <button
            type="button"
            onClick={onReset}
            className="rounded px-1.5 py-0.5 text-[11px] text-ink-soft underline decoration-dotted hover:text-ink"
          >
            trả về .env
          </button>
        )}
        {daDoi && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-900">chưa lưu</span>
        )}
      </div>

      {def.hint && <p className="mb-2.5 text-[12px] leading-[1.6] text-ink-soft">{def.hint}</p>}

      {def.kind === "number" && (
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="number"
            className="gc-input w-40"
            min={def.min}
            max={def.max}
            value={String(value)}
            onChange={(e) => onChange(e.target.value === "" ? def.min : Number(e.target.value))}
          />
          {def.unit && <span className="text-[13px] text-ink-soft">{def.unit}</span>}
          <span className="text-[12px] text-ink-soft/70">
            ({def.min.toLocaleString("vi-VN")} - {def.max.toLocaleString("vi-VN")})
          </span>
        </div>
      )}

      {def.kind === "boolean" && (
        <label className="flex w-fit cursor-pointer items-center gap-2 text-[13px] text-ink">
          <input
            id={id}
            type="checkbox"
            className="h-4 w-4 cursor-pointer accent-ink"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          {value ? "Đang bật" : "Đang tắt"}
        </label>
      )}

      {def.kind === "enum" && (
        <select
          id={id}
          className="gc-input w-40 cursor-pointer"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          {def.options.map((o) => (
            <option key={o} value={o}>
              {NHAN_MUC[o] ?? o}
            </option>
          ))}
        </select>
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
