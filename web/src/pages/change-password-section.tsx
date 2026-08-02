import { useState } from "react";
import { api } from "../dashboard-api-client";
import { IconLock } from "../shared/dashboard-icons";

/**
 * Đổi mật khẩu dashboard. Nằm ở trang Cấu hình vì đây cũng là một thứ trước
 * đây chỉ sửa được bằng cách mở `.env` rồi khởi động lại bot.
 *
 * Bắt nhập lại mật khẩu hiện tại (server cũng kiểm, đây chỉ là lớp giao diện):
 * người ngồi vào máy đang mở sẵn dashboard không được phép đổi mật khẩu rồi
 * khoá chủ thật ra ngoài.
 */
export function ChangePasswordSection() {
  const [hienTai, setHienTai] = useState("");
  const [moi, setMoi] = useState("");
  const [nhapLai, setNhapLai] = useState("");
  const [loi, setLoi] = useState("");
  const [xong, setXong] = useState("");
  const [dangGui, setDangGui] = useState(false);

  const chuaDu = !hienTai || !moi || !nhapLai;

  async function doiMatKhau() {
    setLoi("");
    setXong("");

    // Kiểm ở đây chứ không gửi lên: đây là lỗi gõ nhầm, không phải việc của
    // server - và server không có cách nào biết người dùng định gõ gì
    if (moi !== nhapLai) {
      setLoi("Hai ô mật khẩu mới không giống nhau.");
      return;
    }
    if (moi.length < 8) {
      setLoi("Mật khẩu mới phải từ 8 ký tự.");
      return;
    }

    setDangGui(true);
    try {
      await api.changePassword(hienTai, moi);
      setHienTai("");
      setMoi("");
      setNhapLai("");
      setXong("Đã đổi mật khẩu. Các thiết bị khác đang đăng nhập sẽ phải đăng nhập lại.");
    } catch (e) {
      setLoi((e as Error).message);
    } finally {
      setDangGui(false);
    }
  }

  return (
    // FLAT như mọi tham số khác trong panel: không nền, không viền. Bọc trong
    // một khối riêng làm nó nổi lên như card lồng card, lạc hẳn khỏi phần còn lại.
    <section>
      <div className="mb-3">
        <div className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          <IconLock size={15} className="text-ink-soft" />
          Mật khẩu dashboard
        </div>
        <p className="mt-1 text-[12px] leading-[1.6] text-ink-soft">
          Đổi mật khẩu đăng nhập trang này. Đổi xong, mọi thiết bị khác đang đăng nhập sẽ bị đăng xuất.
        </p>
      </div>

      {loi && (
        <div className="mb-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[13px] text-red-700">
          {loi}
        </div>
      )}
      {xong && (
        <div className="mb-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">
          {xong}
        </div>
      )}

      <div className="grid max-w-sm gap-3">
        <label className="grid gap-1.5">
          <span className="text-[13px] text-ink">Mật khẩu hiện tại</span>
          <input
            type="password"
            autoComplete="current-password"
            className="gc-input"
            value={hienTai}
            onChange={(e) => setHienTai(e.target.value)}
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-[13px] text-ink">Mật khẩu mới</span>
          <input
            type="password"
            autoComplete="new-password"
            className="gc-input"
            value={moi}
            onChange={(e) => setMoi(e.target.value)}
          />
          <span className="text-[12px] text-ink-soft">Tối thiểu 8 ký tự.</span>
        </label>
        <label className="grid gap-1.5">
          <span className="text-[13px] text-ink">Nhập lại mật khẩu mới</span>
          <input
            type="password"
            autoComplete="new-password"
            className="gc-input"
            value={nhapLai}
            onChange={(e) => setNhapLai(e.target.value)}
          />
        </label>
        <div>
          <button
            type="button"
            onClick={() => void doiMatKhau()}
            disabled={dangGui || chuaDu}
            className="rounded-lg bg-zalo-500 px-4 py-2 text-[13px] font-semibold text-white hover:bg-zalo-600 disabled:opacity-50"
          >
            {dangGui ? "Đang đổi..." : "Đổi mật khẩu"}
          </button>
        </div>
      </div>
    </section>
  );
}
