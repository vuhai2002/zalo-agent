import { useMemo } from "react";
import { IconGlobe } from "../shared/dashboard-icons";

/**
 * Chọn múi giờ từ danh sách IANA thật của trình duyệt
 * (`Intl.supportedValuesOf`), không phải ô gõ tay: gõ sai một ký tự trong
 * "Asia/Ho_Chi_Minh" là bot hiểu sai "hôm nay"/"3 giờ chiều" và mọi lịch hẹn
 * chạy lệch giờ - server có chặn zone sai, nhưng bắt người dùng đoán đúng
 * chính tả của 418 cái tên là thiết kế sai ngay từ đầu.
 *
 * Nhãn kèm offset hiện tại ("Asia/Ho_Chi_Minh (GMT+07:00)") vì tên zone không
 * nói lên giờ lệch bao nhiêu - đó mới là thứ người dùng cần đối chiếu.
 */
export function TimezoneSelect({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  const zones = useMemo(() => danhSachZone(value), [value]);

  return (
    // Icon quả cầu nằm TRONG ô: nhãn zone là chuỗi kỹ thuật ("Asia/Ho_Chi_Minh")
    // nên cần một dấu hiệu thị giác cho biết ô này nói về múi giờ, không phải
    // một ô chọn bất kỳ
    <div className="relative w-full max-w-md">
      <IconGlobe
        size={17}
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-soft"
      />
      <select
        id={id}
        className="gc-input w-full cursor-pointer pl-10"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {zones.map((z) => (
          <option key={z.id} value={z.id}>
            {z.label}
          </option>
        ))}
      </select>
    </div>
  );
}

type ZoneOption = { id: string; label: string };

/**
 * `hienTai` luôn được đưa vào danh sách kể cả khi trình duyệt không biết zone
 * đó: thiếu bước này, một giá trị hợp lệ trong `.env` mà trình duyệt cũ không
 * hỗ trợ sẽ làm select nhảy về phần tử đầu tiên, và lần lưu kế tiếp ghi đè
 * mất cấu hình thật của người dùng.
 */
function danhSachZone(hienTai: string): ZoneOption[] {
  const ids = new Set<string>(layDanhSachZone());
  // "UTC" hợp lệ với Intl và là giá trị bot rơi về khi zone cấu hình hỏng,
  // nhưng KHÔNG nằm trong supportedValuesOf (đo thật trên Node 24) - thiếu
  // dòng này thì người muốn đặt UTC không chọn được từ danh sách.
  ids.add("UTC");
  if (hienTai) ids.add(hienTai);

  return [...ids]
    .map((id) => ({ id, label: `${id} (${offsetCuaZone(id)})` }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function layDanhSachZone(): string[] {
  // Intl.supportedValuesOf là ES2022, trình duyệt cũ không có - rơi về đúng
  // zone đang dùng còn hơn ném lỗi làm hỏng cả trang Cấu hình
  const intl = Intl as typeof Intl & { supportedValuesOf?: (k: string) => string[] };
  try {
    return intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

/** "GMT+07:00" của zone tại thời điểm hiện tại (đã tính DST nếu zone đó có) */
function offsetCuaZone(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
    }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}
