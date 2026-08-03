import { useEffect, useState } from "react";
import type { TuningDef, TuningValue } from "../dashboard-api-client";
import { IconUndo } from "../shared/dashboard-icons";
import { giaTriGuiDi } from "./tuning-commit-value";
import { TuningFieldControl } from "./tuning-field-control";

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
  const { value, macDinh, fromEnv } = tuningValue;
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
    // `null` đi thẳng (nút "Về mặc định"); giá trị người dùng chọn thì đi qua
    // `giaTriGuiDi` để chọn đúng mặc định cũng thành xóa dòng đè - xem file đó.
    const res = await onSave(name, v === null ? null : giaTriGuiDi(v, macDinh));
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
    // NẰM NGANG như từng dòng ở trang Tools: chữ bên trái, ô nhập bên phải.
    // Bản dọc trước đó (nhãn -> mô tả -> ô nhập, mỗi tham số một khối) đẩy trang
    // dài gấp đôi và không lướt nhanh được: mắt phải đi zigzag để nối nhãn với
    // giá trị của nó. Xếp ngang thì mọi giá trị nằm trên cùng một cột.
    //
    // Màn hẹp thì đổ dọc lại (`flex-col` mặc định) - nhồi ô nhập vào cạnh đoạn
    // mô tả dài trên điện thoại là bóp cả hai bên.
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between xl:gap-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <label htmlFor={id} className="text-[14px] font-medium text-ink">
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
          //
          // Tông HỔ PHÁCH chứ không xám trung tính: hai trạng thái phải phân
          // biệt được từ xa khi lướt cả trang. Xanh = đang theo mặc định, hổ
          // phách = bạn đã chỉnh ô này - cùng bảng màu với các cảnh báo nhẹ
          // khác trong dashboard, không phải đỏ vì đây không phải lỗi.
          //
          // `leading-none` trên chữ: không có nó thì icon 12px bị chiều cao
          // dòng mặc định đẩy lệch so với chữ, nhìn như chưa canh.
          <button
            type="button"
            onClick={() => void commit(null)}
            disabled={dangLuu}
            title="Xóa giá trị bạn đã đặt, quay lại giá trị mặc định"
            className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 transition-colors hover:border-amber-300 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/70"
          >
            <IconUndo size={12} className="shrink-0" />
            <span className="leading-none">Về mặc định</span>
          </button>
        )}
        <TrangThaiLuu phase={phase} />
        </div>

        {def.hint && <p className="mt-0.5 text-[12px] leading-[1.6] text-ink-soft">{def.hint}</p>}
        {phase === "error" && loi && (
          <p className="mt-1 text-[12px] text-red-600 dark:text-red-400">{loi}</p>
        )}
      </div>

      <TuningFieldControl
        def={def}
        id={id}
        value={value}
        nhap={nhap}
        dangLuu={dangLuu}
        onNhap={(v) => {
          setNhap(v);
          if (phase === "error") setPhase("idle");
        }}
        onCommit={(v) => void commit(v)}
        onCommitNumber={commitNumberDraft}
      />
    </div>
  );
}

function TrangThaiLuu({ phase }: { phase: Phase }) {
  if (phase === "saving") return <span className="text-[11px] text-ink-soft">Đang lưu...</span>;
  if (phase === "saved") return <span className="text-[11px] text-emerald-600 dark:text-emerald-400">Đã lưu</span>;
  return null;
}
