import { useState } from "react";
import { IconEye, IconEyeOff } from "./dashboard-icons";

/**
 * Ô nhập secret (password, API key) có nút con mắt hiện/ẩn - dùng cho MỌI chỗ
 * nhập key trong dashboard để người dùng soát được mình dán gì trước khi lưu.
 * Mặc định vẫn che (type password); chỉ hiện khi chủ động bấm.
 */
export function SecretInput({
  value,
  onChange,
  placeholder,
  className = "",
  autoFocus,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Class thêm cho WRAPPER (margin...) - input bên trong đã full width */
  className?: string;
  autoFocus?: boolean;
  id?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className={`relative ${className}`}>
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        className="gc-input w-full pr-10"
      />
      {/* tabIndex -1: Tab đi thẳng từ ô nhập sang control kế, không kẹt ở nút mắt */}
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        title={visible ? "Ẩn" : "Hiện"}
        aria-label={visible ? "Ẩn nội dung" : "Hiện nội dung"}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer p-0.5 text-ink-soft/60 transition-colors hover:text-ink"
      >
        {visible ? <IconEyeOff size={16} /> : <IconEye size={16} />}
      </button>
    </div>
  );
}
