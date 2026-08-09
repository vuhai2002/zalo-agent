import type { KbSourceStatus } from "../dashboard-api-client";
import { nenHenLuotKe, type KetQuaTaiNguon } from "./kb-poll-guard";

const CHU_KY_MS = 4000;

/**
 * Phụ thuộc TIÊM VÀO thay vì gọi thẳng `window.setTimeout`/`window.clearTimeout`
 * - để vòng lặp test được bằng "đồng hồ giả" (fake clock tự viết, KHÔNG cần
 * `@testing-library/react`/jsdom). Component thật truyền
 * `window.setTimeout`/`window.clearTimeout`; test truyền một lịch giả đồng bộ.
 */
export type VongPollDeps = {
  /** Một lần thử tải - side effect (cập nhật state hiển thị) do caller tự làm, hàm chỉ trả kết quả để QUYẾT ĐỊNH lịch tiếp theo */
  tai: () => Promise<KetQuaTaiNguon>;
  henGio: (chay: () => void | Promise<void>, ms: number) => unknown;
  xoaGio: (tayCam: unknown) => void;
};

/**
 * Vòng lặp poll THUẦN, tách khỏi React. Khóa đủ SÁU bất biến mà `setInterval`
 * gốc và bản `setTimeout` (83ffc5d) đều phải giữ (xem bảng 6 chiều ở report
 * phase 06 - rà soát vòng 2):
 *
 *   1. Còn việc thì hẹn tiếp
 *   2. Hết việc thì dừng (B7)
 *   3. Unmount thì dọn (`dungHan`)
 *   4. Tải hỏng vẫn hẹn nếu lượt trước đã biết còn việc (Important 1)
 *   5. Không hẹn CHỒNG timer (`reload` xóa timer đang chờ TRƯỚC khi tải lại)
 *   6. Poll ĐÃ DỪNG (hết việc) rồi có việc MỚI (`reload` sau khi thêm nguồn,
 *      bấm "Xử lý lại") thì TỰ KHỞI ĐỘNG LẠI
 *
 * Bug hồi quy vừa sửa (07d726c): `reload()` gọi thẳng MỘT lần tải, không đi
 * qua `motLuot` - một khi vòng lặp đã dừng (mọi nguồn `san_sang`/`hong`, tức
 * TRẠNG THÁI NGHỈ BÌNH THƯỜNG của trang), không còn gì hồi sinh nó: thêm
 * nguồn mới hay bấm "Xử lý lại" đều rơi vào ngõ cụt, badge/bảng đứng im tới
 * khi F5. `reload()` và `batDau()` ở đây đều gọi ĐÚNG `motLuot` - "làm mới
 * ngay" và "vòng lặp tự động" là HAI LỐI VÀO của CÙNG một cỗ máy, không phải
 * hai cơ chế tách rời.
 */
export function taoVongPoll(deps: VongPollDeps) {
  let timerId: unknown = null;
  let sourcesDaBiet: { trangThai: KbSourceStatus }[] | null = null;
  let huy = false;

  async function motLuot(): Promise<void> {
    // Chiều 5: một lượt MỚI bắt đầu (dù do hẹn giờ tự bắn hay do reload() gọi
    // tay) làm lượt hẹn CŨ (nếu còn) lỗi thời ngay lập tức - không bao giờ để
    // hai timer cùng chờ chồng lên nhau.
    if (timerId !== null) {
      deps.xoaGio(timerId);
      timerId = null;
    }
    const ketQua = await deps.tai();
    if (huy) return;
    if (ketQua.thanhCong) sourcesDaBiet = ketQua.items;
    // Chiều 1/2/4/6 đều quyết định ở ĐÚNG MỘT chỗ này - `nenHenLuotKe` xét cả
    // nhánh thành công lẫn thất bại, và vì `reload`/`batDau` cùng chạy hàm
    // này, "poll đã dừng rồi có việc mới" (chiều 6) tự động hẹn lại được.
    if (nenHenLuotKe(ketQua, sourcesDaBiet)) {
      timerId = deps.henGio(motLuot, CHU_KY_MS);
    }
  }

  return {
    /** Gọi lúc mount - bắt đầu vòng lặp lần đầu */
    batDau: (): Promise<void> => motLuot(),
    /**
     * Làm mới NGAY theo hành động chủ động của người dùng (thêm nguồn, bấm
     * "Xử lý lại", xóa nguồn) - ĐI QUA ĐÚNG `motLuot`, không phải một lần tải
     * trần, để chiều 6 (tự khởi động lại sau khi đã dừng) luôn đúng.
     */
    reload: (): Promise<void> => motLuot(),
    /** Gọi lúc unmount - dọn timer đang chờ (nếu có), chặn mọi lượt còn dang dở */
    dungHan: (): void => {
      huy = true;
      if (timerId !== null) {
        deps.xoaGio(timerId);
        timerId = null;
      }
    },
  };
}
