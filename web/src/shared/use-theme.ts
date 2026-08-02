import { useCallback, useEffect, useState } from "react";

/**
 * Chế độ sáng/tối. Lựa chọn của người dùng lưu ở `localStorage`; chưa chọn lần
 * nào thì theo cài đặt hệ điều hành (`prefers-color-scheme`).
 *
 * Class `.dark` gắn trên `<html>` (không phải `<body>`) vì `styles.css` khai
 * `@custom-variant dark (&:where(.dark, .dark *))` - phải là tổ tiên của MỌI
 * phần tử, kể cả thứ render qua portal ra ngoài body.
 *
 * KHÔNG đặt giá trị khởi tạo bằng `useState(() => doc())` rồi mới ghi class ở
 * `useEffect`: giữa hai thời điểm đó trang đã vẽ một khung sáng rồi mới tối
 * lại, mắt thấy rõ cú nháy. Class được ghi ngay trong `index.html` trước khi
 * React chạy - hook này chỉ đọc lại trạng thái đã có.
 */

export type Theme = "light" | "dark";

const KEY = "zalo-agent-theme";

/** Đọc trạng thái ĐANG hiệu lực từ chính DOM, không đoán lại từ localStorage */
function themeHienTai(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(themeHienTai);

  const apDung = useCallback((moi: Theme) => {
    document.documentElement.classList.toggle("dark", moi === "dark");
    localStorage.setItem(KEY, moi);
    setTheme(moi);
  }, []);

  const toggle = useCallback(() => {
    apDung(themeHienTai() === "dark" ? "light" : "dark");
  }, [apDung]);

  /**
   * Người dùng đổi chế độ ở HỆ ĐIỀU HÀNH trong lúc đang mở tab: đổi theo, NHƯNG
   * chỉ khi họ chưa từng tự chọn trên dashboard - đã chọn tay rồi mà bị hệ điều
   * hành ghi đè thì cái nút kia thành vô nghĩa.
   */
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      if (localStorage.getItem(KEY)) return;
      document.documentElement.classList.toggle("dark", e.matches);
      setTheme(e.matches ? "dark" : "light");
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return { theme, toggle };
}
