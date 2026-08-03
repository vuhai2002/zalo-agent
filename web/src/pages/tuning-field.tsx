import { useEffect, useState } from "react";
import type { TuningDef, TuningValue } from "../dashboard-api-client";
import { IconUndo } from "../shared/dashboard-icons";
import { SelectMenu } from "../shared/select-menu";
import { TimezoneSelect } from "./timezone-select";

type SaveResult = { ok: true } | { ok: false; error: string };
type Phase = "idle" | "saving" | "saved" | "error";

/**
 * Một ô cấu hình, TỰ LƯU - không có nút "Lưu" tổng ở trang. Số/chuỗi lưu lúc
 * rời ô hoặc bấm Enter (gõ xong mới gọi API, tránh lưu "1" giữa lúc đang gõ
 * "16384"); bật/tắt và menu chọn lưu NGAY lúc đổi vì không có trạng thái dở.
 *
 * Chỗ đáng chú ý về mặt nhìn: ô CHƯA ai chỉnh trông y hệt ô đã chỉnh, nên phải
 * có nhãn phân biệt - nếu không người dùng đọc số trên màn hình rồi tưởng mình
 * đã đặt nó.
 *
 * Nhãn ghi "mặc định", KHÔNG ghi ".env": cờ `fromEnv` chỉ có nghĩa "chưa có giá
 * trị đè trong DB", mà từ khi .env rút còn 9 biến thì phần lớn tham số ở đây
 * không hề nằm trong file đó - chúng lấy `.default()` của schema.
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
  /** `value: null` = xóa giá trị đè, về mặc định. Trả lỗi thì ô không được coi là đã lưu. */
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
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <label htmlFor={id} className="text-[15px] font-semibold text-ink">
          {def.label}
        </label>
        {fromEnv ? (
          // Chữ "mặc định" chứ KHÔNG phải ".env": cờ `fromEnv` thật ra chỉ nói
          // "chưa có giá trị đè trong DB". Từ khi .env rút còn 9 biến thì CẢ
          // 46/46 tham số của trang này đều KHÔNG có mặt trong file đó (đếm
          // thật) - giá trị đến từ `.default()` của schema. Chip cũ khiến người
          // dùng mở .env đi tìm một dòng không tồn tại.
          <span className="rounded-full bg-zalo-50 dark:bg-zalo-950/40 px-2 py-0.5 text-[11px] font-medium text-zalo-600 dark:text-zalo-300">
            mặc định
          </span>
        ) : (
          // Viền + nền + icon chứ KHÔNG phải chữ gạch chân chấm: bản cũ đọc ra
          // như một chú thích, người dùng không nhận ra bấm được. Cao đúng bằng
          // chip "mặc định" để dòng tiêu đề không nhảy khi đổi trạng thái.
          <button
            type="button"
            onClick={() => void commit(null)}
            disabled={dangLuu}
            title="Xóa giá trị bạn đã đặt, quay lại giá trị mặc định"
            className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-soft transition-colors hover:border-zalo-200 hover:bg-zalo-50 hover:text-zalo-600 disabled:opacity-50 dark:hover:border-zalo-800 dark:hover:bg-zalo-950/40 dark:hover:text-zalo-300"
          >
            <IconUndo size={12} />
            Về mặc định
          </button>
        )}
        <TrangThaiLuu phase={phase} />
      </div>

      {def.hint && <p className="mb-4 max-w-3xl text-[13px] leading-[1.7] text-ink-soft">{def.hint}</p>}

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
        <div className="w-40">
          <SelectMenu
            id={id}
            size="md"
            value={String(value)}
            disabled={dangLuu}
            options={def.options.map((o) => ({ value: o, label: NHAN_MUC[o] ?? o }))}
            onChange={(v) => void commit(v)}
          />
        </div>
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
