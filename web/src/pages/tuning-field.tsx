import { useEffect, useState } from "react";
import type { TuningDef, TuningValue } from "../dashboard-api-client";
import { TimezoneSelect } from "./timezone-select";

type SaveResult = { ok: true } | { ok: false; error: string };
type Phase = "idle" | "saving" | "saved" | "error";

/**
 * Một ô cấu hình, TỰ LƯU - không có nút "Lưu" tổng ở trang. Số/chuỗi lưu lúc
 * rời ô hoặc bấm Enter (gõ xong mới gọi API, tránh lưu "1" giữa lúc đang gõ
 * "16384"); bật/tắt và menu chọn lưu NGAY lúc đổi vì không có trạng thái dở.
 *
 * Chỗ đáng chú ý về mặt nhìn: ô đang lấy giá trị từ `.env` trông y hệt ô đã
 * chỉnh, nên phải có nhãn phân biệt - nếu không người dùng đọc số trên màn hình
 * rồi tưởng mình đã đặt nó, trong khi sửa `.env` vẫn đổi được.
 */
export function TuningField({
  name,
  def,
  tuningValue,
  onSave,
}: {
  name: string;
  def: TuningDef;
  tuningValue: TuningValue;
  /** `value: null` = trả về giá trị .env. Trả lỗi thì ô không được coi là đã lưu. */
  onSave: (key: string, value: number | boolean | string | null) => Promise<SaveResult>;
}) {
  const id = `tuning-${name}`;
  const { value, fromEnv } = tuningValue;
  const [phase, setPhase] = useState<Phase>("idle");
  const [loi, setLoi] = useState("");
  // Chỉ number/text cần bản nháp cục bộ - boolean/enum lưu ngay nên không có
  // trạng thái "đang gõ dở" để giữ.
  const [nhap, setNhap] = useState(String(value));

  // Chỉ đồng bộ lại nháp khi giá trị THẬT sự đổi (sau khi lưu thành công, hoặc
  // nhóm bị reset) - không phải mỗi lần cha re-render, kẻo xoá mất chữ người
  // dùng đang gõ dở ở MỘT ô khác làm props của ô này đổi tham chiếu.
  useEffect(() => {
    setNhap(String(value));
  }, [value]);

  async function commit(v: number | boolean | string | null) {
    setPhase("saving");
    setLoi("");
    const res = await onSave(name, v);
    if (res.ok) {
      setPhase("saved");
      window.setTimeout(() => setPhase((p) => (p === "saved" ? "idle" : p)), 1400);
    } else {
      setPhase("error");
      setLoi(res.error);
    }
  }

  // Chỉ gọi từ ô number (def.kind === "number" lúc đó) nên narrow tường minh
  // ngay đầu hàm thay vì ép kiểu rải rác - an toàn kiểu thật, không giả vờ.
  function commitNumberDraft() {
    if (def.kind !== "number") return;
    const num = Number(nhap);
    if (nhap.trim() === "" || !Number.isFinite(num)) {
      setPhase("error");
      setLoi("Phải là một số");
      return;
    }
    if (num < def.min || num > def.max) {
      setPhase("error");
      setLoi(`Phải trong khoảng ${def.min} - ${def.max}`);
      return;
    }
    if (num === value) return; // không đổi gì thì khỏi gọi API
    void commit(num);
  }

  const dangLuu = phase === "saving";

  return (
    // FLAT: không nền, không viền - chỉ chữ và ô nhập trên nền trắng của panel.
    // Bọc mỗi tham số trong một khối xám là kiểu "khối lồng khối", nhìn nặng và
    // chia trang thành nhiều ô con không cần thiết.
    <div className="py-1">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <label htmlFor={id} className="text-[15px] font-semibold text-ink">
          {def.label}
        </label>
        {fromEnv ? (
          <span className="rounded-full bg-zalo-50 px-2 py-0.5 text-[11px] font-medium text-zalo-600">
            .env
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void commit(null)}
            disabled={dangLuu}
            className="rounded px-1.5 py-0.5 text-[11px] text-ink-soft underline decoration-dotted hover:text-ink disabled:opacity-50"
          >
            trả về .env
          </button>
        )}
        <TrangThaiLuu phase={phase} />
      </div>

      {def.hint && <p className="mb-3 text-[13px] leading-[1.6] text-ink-soft">{def.hint}</p>}

      {def.kind === "number" && (
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="number"
            className="gc-input w-40"
            min={def.min}
            max={def.max}
            value={nhap}
            disabled={dangLuu}
            onChange={(e) => {
              setNhap(e.target.value);
              if (phase === "error") setPhase("idle");
            }}
            onBlur={commitNumberDraft}
            onKeyDown={(e) => e.key === "Enter" && commitNumberDraft()}
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
            disabled={dangLuu}
            onChange={(e) => void commit(e.target.checked)}
          />
          {value ? "Đang bật" : "Đang tắt"}
        </label>
      )}

      {def.kind === "enum" && (
        <select
          id={id}
          className="gc-input w-40 cursor-pointer"
          value={String(value)}
          disabled={dangLuu}
          onChange={(e) => void commit(e.target.value)}
        >
          {def.options.map((o) => (
            <option key={o} value={o}>
              {NHAN_MUC[o] ?? o}
            </option>
          ))}
        </select>
      )}

      {def.kind === "timezone" && (
        <TimezoneSelect
          id={id}
          value={String(value)}
          disabled={dangLuu}
          onChange={(v) => void commit(v)}
        />
      )}

      {phase === "error" && loi && <p className="mt-2 text-[12px] text-red-600 dark:text-red-400">{loi}</p>}
    </div>
  );
}

function TrangThaiLuu({ phase }: { phase: Phase }) {
  if (phase === "saving") return <span className="text-[11px] text-ink-soft">Đang lưu...</span>;
  if (phase === "saved") return <span className="text-[11px] text-emerald-600 dark:text-emerald-400">Đã lưu</span>;
  return null;
}

/** Nhãn tiếng Việt cho mức suy nghĩ - "xhigh" trên màn hình thì không ai đoán được */
const NHAN_MUC: Record<string, string> = {
  off: "Tắt",
  low: "Thấp",
  medium: "Vừa",
  high: "Cao",
  xhigh: "Rất cao",
};
