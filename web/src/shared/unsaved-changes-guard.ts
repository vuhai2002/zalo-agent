/**
 * Chốt "còn thay đổi chưa lưu" cho điều hướng TRONG app.
 *
 * Vì sao không dùng `useBlocker` của react-router: hook đó đòi data router
 * (`createBrowserRouter`), còn app dựng bằng `<BrowserRouter>` - gọi vào là ném
 * "useBlocker must be used within a data router" và trắng cả trang. Đã thử và
 * đã dính. Chuyển cả app sang data router là việc riêng, đụng cả phần chặn
 * đăng nhập.
 *
 * Nên chốt nằm ngoài React, đúng nếp `use-theme.ts` đã dùng trong dự án: trang
 * đang sửa dở ĐĂNG KÝ một hàm hỏi, sidebar HỎI trước khi điều hướng.
 *
 * Chỉ MỘT ô đăng ký chứ không phải tập subscriber (khác `use-theme.ts`): mỗi
 * lúc chỉ có đúng một trang được mount, nên không có chuyện hai nơi cùng sửa dở.
 *
 * Giới hạn còn lại, nói rõ để khỏi tưởng đã kín: nút Back của trình duyệt KHÔNG
 * đi qua đây (không có sự kiện nào chặn trước được). Đóng tab và F5 thì đã có
 * `beforeunload` ở trang lo.
 */

/** Trả true = cho đi, false = ở lại */
type XinPhepRoiTrang = () => Promise<boolean>;

let dangGiuCho: XinPhepRoiTrang | null = null;

/**
 * Trang gọi trong `useEffect`: truyền hàm hỏi khi còn sửa dở, truyền `null` khi
 * sạch. Nhớ gọi lại với `null` ở hàm dọn dẹp, nếu không trang đã rời đi vẫn
 * chặn được điều hướng của trang khác.
 */
export function dangKyChuaLuu(xinPhep: XinPhepRoiTrang | null): void {
  dangGiuCho = xinPhep;
}

/**
 * Có cần hỏi không - kiểm ĐỒNG BỘ.
 *
 * Cần bản đồng bộ vì `e.preventDefault()` của sự kiện click phải gọi ngay, không
 * chờ được promise. Đường không có gì chưa lưu thì đi thẳng, không đụng gì tới
 * hành vi mặc định của link.
 */
export function coCanHoiTruocKhiRoi(): boolean {
  return dangGiuCho !== null;
}

/** Hỏi người dùng. Không có gì chưa lưu thì cho đi ngay. */
export async function xinPhepRoiTrang(): Promise<boolean> {
  if (!dangGiuCho) return true;
  return dangGiuCho();
}
