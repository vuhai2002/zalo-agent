import { useState } from "react";
import { api } from "../dashboard-api-client";
import { IconLock } from "../shared/dashboard-icons";
import { SecretInput } from "../shared/secret-input";

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
    <section>
      <div className="mb-4">
        <div className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          <IconLock size={16} className="text-ink-soft" />
          Mật khẩu dashboard
        </div>
        <p className="mt-1.5 max-w-3xl text-[13px] leading-[1.7] text-ink-soft">
          Đổi mật khẩu đăng nhập trang này. Đổi xong, mọi thiết bị khác đang đăng nhập sẽ bị đăng xuất.
        </p>
      </div>

      {loi && (
        <div className="mb-3 rounded-lg border border-red-100 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-[13px] text-red-700 dark:text-red-300">
          {loi}
        </div>
      )}
      {xong && (
        <div className="mb-3 rounded-lg border border-emerald-100 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 text-[13px] text-emerald-800 dark:text-emerald-200">
          {xong}
        </div>
      )}

      <div className="max-w-2xl">
        <label className="block">
          <span className="mb-2 block text-[13px] font-medium text-ink">Mật khẩu hiện tại</span>
          {/* Ô này để MỘT MÌNH một hàng: nó xác minh danh tính, khác vai với cặp
              "mật khẩu mới" bên dưới - xếp chung hàng làm ba ô trông như một bộ */}
          <SecretInput
            className="sm:max-w-md"
            value={hienTai}
            onChange={setHienTai}
            placeholder="Nhập mật khẩu hiện tại"
          />
        </label>

        {/* Mật khẩu mới + nhập lại nằm CẠNH nhau: chúng phải khớp nhau nên đặt
            sát để mắt so được, thay vì cuộn dọc qua ba ô rời rạc */}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-[13px] font-medium text-ink">Mật khẩu mới</span>
            <SecretInput value={moi} onChange={setMoi} placeholder="Nhập mật khẩu mới" />
            <span className="mt-2 block text-[12px] text-ink-soft">Tối thiểu 8 ký tự.</span>
          </label>
          <label className="block">
            <span className="mb-2 block text-[13px] font-medium text-ink">Nhập lại mật khẩu mới</span>
            <SecretInput value={nhapLai} onChange={setNhapLai} placeholder="Nhập lại mật khẩu mới" />
          </label>
        </div>

        <button
          type="button"
          onClick={() => void doiMatKhau()}
          disabled={dangGui || chuaDu}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-zalo-500 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-zalo-600 disabled:opacity-50"
        >
          <IconLock size={15} />
          {dangGui ? "Đang đổi..." : "Đổi mật khẩu"}
        </button>
      </div>
    </section>
  );
}
