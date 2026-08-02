import { useEffect } from "react";
import { dangKyChuaLuu } from "./unsaved-changes-guard";

/**
 * Hỏi trước khi rời trang nếu còn thay đổi chưa lưu.
 *
 * Gom cả hai đường vào một hook vì chúng luôn phải đi cùng nhau - có cái này mà
 * quên cái kia thì người dùng được hỏi ở đường này và mất trắng ở đường kia:
 *
 *   - `beforeunload`: đóng tab, F5, gõ URL khác. Trình duyệt tự hiện hộp thoại
 *     của nó, mình không đổi được chữ.
 *   - `unsaved-changes-guard`: điều hướng TRONG app (bấm mục ở sidebar). Hiện
 *     hộp thoại của chính dự án, chữ do `hoi` quyết định.
 *
 * Đường KHÔNG chặn được: nút Back của trình duyệt. Muốn chặn nốt thì phải
 * chuyển cả app sang `createBrowserRouter` để dùng `useBlocker` - xem giải
 * thích ở `unsaved-changes-guard.ts`.
 *
 * @param coDoi còn thay đổi chưa lưu không
 * @param hoi hàm hiện hộp thoại; trả true = cho đi. PHẢI có tham chiếu ổn định
 *   (bọc `useCallback`), nếu không hook đăng ký lại mỗi lần render.
 */
export function useUnsavedChangesPrompt(coDoi: boolean, hoi: () => Promise<boolean>): void {
  useEffect(() => {
    if (!coDoi) return;
    const canhBao = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", canhBao);
    return () => window.removeEventListener("beforeunload", canhBao);
  }, [coDoi]);

  useEffect(() => {
    if (!coDoi) {
      dangKyChuaLuu(null);
      return;
    }
    dangKyChuaLuu(hoi);
    // Hủy đăng ký khi rời trang là BẮT BUỘC: để chốt lại thì mọi điều hướng sau
    // đó của trang khác đều bị hỏi oan bằng hộp thoại nói về trang không còn mở.
    return () => dangKyChuaLuu(null);
  }, [coDoi, hoi]);
}
