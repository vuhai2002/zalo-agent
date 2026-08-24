/**
 * MỘT nguồn chân lý cho cách yt-dlp chọn format video. Dùng ở CẢ HAI đường:
 * đọc metadata (`nguon-yt-dlp.ts`) và tự tải file (`tai-video-vao-ram.ts`).
 *
 * VÌ SAO PHẢI CHUNG: hai đường là hai lời gọi yt-dlp RIÊNG. Đường metadata đọc
 * `url`/`width`/`height` của format ĐÃ CHỌN rồi khai cho Zalo dựng bề mặt phát;
 * đường tải (khi phải để yt-dlp tự tải từ URL gốc) lại CHỌN LẠI. Hai bên lệch
 * bộ chọn thì bot khai kích thước của format này nhưng gửi byte của format khác
 * - đúng thứ đã làm CRASH ứng dụng Zalo trên điện thoại. Nên bộ chọn là ràng
 * buộc ĐÚNG ĐẮN, không chỉ là DRY.
 *
 * ---
 *
 * `CHON_FORMAT` - ưu tiên luồng mp4 đã ghép sẵn hình+tiếng, KHÔNG phải bản
 * `download`:
 *
 *   - `[format_id!=download]`: yt-dlp gắn `format_note: "watermarked"` cho format
 *     tên `download` của TikTok (đo thật). Loại nó khi còn lựa chọn sạch. Nhánh
 *     thứ hai `b[ext=mp4]` vẫn cho nó lọt nếu đó là mp4 DUY NHẤT - thà watermark
 *     còn hơn không gửi được.
 *   - KHÔNG có nhánh ghép `bv*+ba`: ghép cần ffmpeg, mà image cố ý không cài
 *     ffmpeg (chạy ffmpeg trên nội dung người lạ là thứ thiết kế này tránh).
 *     `b`/`best` chỉ lấy luồng ĐÃ có sẵn cả hình lẫn tiếng.
 *
 * `CHON_SORT` - ưu tiên h264 hơn h265/av1 để máy cũ phát được.
 *
 *   VÌ SAO `-S vcodec:h264` chứ KHÔNG phải `[vcodec^=avc]` như bản cũ: bản cũ lọc
 *   theo tiền tố chuỗi `avc`, nhưng yt-dlp bản nay khai h264 của TikTok là
 *   `vcodec="h264"` chứ KHÔNG phải `"avc1.*"`. Nên `^=avc` khớp RỖNG, lặng lẽ rơi
 *   xuống `b[ext=mp4]` rồi lấy phân giải cao nhất = h265 - đúng codec cần tránh,
 *   hỏng CÂM (đo tất định qua `--load-info-json`, xem `chon-format-video.test.ts`).
 *   `-S vcodec:h264` đi qua bộ chuẩn hóa codec NỘI BỘ của yt-dlp: gom
 *   `avc1.*`/`h264`/`H264` về cùng một rọ, không phân biệt hoa thường, nên miễn
 *   nhiễm với đổi nhãn - và vì nó chỉ SẮP XẾP chứ không LỌC, không còn cửa "khớp
 *   rỗng câm". Chỉ có h265 thì `-f` vẫn lấy h265 (lùi mềm, không rỗng).
 *
 * `-S` (`--format-sort`) là tính năng ổn định nhiều năm của yt-dlp; cú pháp
 * `vcodec:<codec>` được tài liệu hóa và không đổi.
 */

/** Bộ chọn `-f`: mp4 đã ghép sẵn, tránh bản watermark khi còn lựa chọn sạch */
export const CHON_FORMAT = "b[ext=mp4][format_id!=download]/b[ext=mp4]/b";

/** Sắp xếp `-S`: ưu tiên h264 để tương thích máy cũ (dùng chuẩn hóa codec của yt-dlp) */
export const CHON_SORT = "vcodec:h264";

/** Đối số yt-dlp chọn format - dùng CHUNG cho cả đường metadata lẫn đường tải */
export function argsChonFormat(): string[] {
  return ["-f", CHON_FORMAT, "-S", CHON_SORT];
}
