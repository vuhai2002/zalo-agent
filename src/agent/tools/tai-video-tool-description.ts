/**
 * Mô tả tool `tai_video`.
 *
 * Chỉ nói những điều model KHÔNG tự suy ra được từ schema, đúng nếp của
 * `schedule-task-tool-description.ts`. Không kê ví dụ cụ thể để model chép
 * nguyên văn - bài học đã trả giá ở `create-image-tool-description.ts` (nhét
 * "brief thiết kế 5 mục" làm mọi ảnh ra một khuôn).
 *
 * Ba điều bắt buộc phải có trong mô tả:
 *
 * 1. CHỈ TikTok và Facebook. Không nói thì model gọi tool với link YouTube rồi
 *    nhận lỗi, tốn một lượt vô ích.
 * 2. Gửi THẲNG, không trả về đường dẫn. Model hay tưởng tool trả link để nó
 *    chép vào câu trả lời, rồi người dùng nhận một đoạn URL thay vì video.
 * 3. Video ĐĂNG LẠI thì watermark gỡ không được. Đây là giới hạn có thật của
 *    bài toán (watermark nằm sẵn trong file gốc), và người dùng cần nghe lý do
 *    thay vì tưởng bot làm sai.
 */
export const TAI_VIDEO_DESCRIPTION =
  "Tải video từ link TikTok hoặc Facebook rồi GỬI THẲNG vào cuộc trò chuyện này. " +
  "Chỉ nhận hai nguồn đó - link YouTube, Instagram hay nơi khác đều không dùng được.\n" +
  "Tool tự gửi video, KHÔNG trả đường dẫn cho bạn chép lại. Gọi xong chỉ cần nói ngắn " +
  "gọn là đã gửi, đừng dán lại link.\n" +
  "Video quá dài sẽ bị từ chối kèm số phút cụ thể - đọc con số đó cho người dùng nghe.\n" +
  "Bản tải về đã bỏ watermark của TikTok. Nhưng nếu video là bản ĐĂNG LẠI (người đăng " +
  "tải từ nơi khác rồi đăng lên), watermark đã nằm sẵn trong file gốc và không gỡ được - " +
  "gặp trường hợp đó thì nói thật với người dùng, đừng hứa gửi bản sạch hơn.";
