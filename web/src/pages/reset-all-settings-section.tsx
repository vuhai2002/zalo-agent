import { useState } from "react";
import { IconWarning } from "../shared/dashboard-icons";
import { useConfirmDialog } from "../shared/confirm-dialog";

/**
 * Đặt lại TOÀN BỘ cấu hình về mặc định.
 *
 * "Mặc định" ở đây là giá trị khi không có gì đè trong DB: biến môi trường nếu
 * người deploy có đặt, còn không thì `.default()` của schema. Chữ hiện ra KHÔNG
 * nhắc `.env` - từ khi file đó rút còn 7 biến thì phần lớn tham số của trang
 * này không hề nằm trong đó, nói ".env" chỉ khiến người dùng mở file đi tìm một
 * dòng không tồn tại.
 *
 * Không có endpoint riêng: xoá phần đè của mọi tham số chính là gửi `null` cho
 * từng key qua đúng API đang dùng (`PUT /api/tuning`), nên không phải thêm một
 * đường ghi thứ hai vào `runtime_settings` để rồi phải nhớ đồng bộ luật với
 * đường cũ.
 *
 * KHÔNG đụng tới mật khẩu dashboard: mật khẩu nằm ở khoá riêng
 * (`dashboard_password`), và một nút tên là "đặt lại cấu hình" mà âm thầm hạ
 * mật khẩu về giá trị cũ trong biến môi trường là thứ không ai lường trước được.
 */
export function ResetAllSettingsSection({
  soODaDoi,
  onResetAll,
}: {
  /** Số tham số đang có giá trị đè trong DB - 0 thì không có gì để đặt lại */
  soODaDoi: number;
  onResetAll: () => Promise<void>;
}) {
  const { confirm, confirmDialog } = useConfirmDialog();
  const [dangChay, setDangChay] = useState(false);
  const [xong, setXong] = useState("");

  async function datLai() {
    const ok = await confirm({
      title: "Đặt lại toàn bộ cấu hình?",
      message: `${soODaDoi} tham số bạn đã chỉnh trên dashboard sẽ trở về mặc định. Mật khẩu dashboard KHÔNG bị ảnh hưởng.`,
      confirmLabel: "Đặt lại",
    });
    if (!ok) return;

    setDangChay(true);
    setXong("");
    try {
      await onResetAll();
      setXong("Đã đặt lại toàn bộ cấu hình về mặc định.");
    } finally {
      setDangChay(false);
    }
  }

  return (
    <>
      {/* Khối riêng có viền: đây là hành động KHÔNG hoàn tác được, tách hẳn
          khỏi các thiết lập sửa-lúc-nào-cũng-được ở trên để không ai bấm nhầm
          lúc đang lướt qua trang */}
      {/* items-center: nút cao hơn 40px trong khi phần chữ cao 3 dòng, canh
          theo đầu khối làm nút dính sát mép trên trông như bị đẩy lệch */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-zalo-100 bg-zalo-50/40 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-ink">
            <IconWarning size={16} className="text-amber-500" />
            Đặt lại toàn bộ cấu hình
          </div>
          <p className="mt-2 max-w-3xl text-[13px] leading-[1.7] text-ink-soft">
            Trả mọi tham số ở tất cả các nhóm về mặc định. Mật khẩu dashboard không bị ảnh hưởng. Hành
            động này không thể hoàn tác.
            {soODaDoi === 0 && " Hiện chưa có tham số nào được chỉnh."}
          </p>
          {xong && <p className="mt-2 text-[13px] text-emerald-600 dark:text-emerald-400">{xong}</p>}
        </div>
        <button
          type="button"
          onClick={() => void datLai()}
          disabled={dangChay || soODaDoi === 0}
          className="shrink-0 rounded-xl border border-line bg-surface px-4 py-2.5 text-[13px] font-semibold text-ink hover:bg-tile disabled:opacity-50"
        >
          {dangChay ? "Đang đặt lại..." : soODaDoi > 0 ? `Đặt lại (${soODaDoi})` : "Đặt lại"}
        </button>
      </div>
      {confirmDialog}
    </>
  );
}
