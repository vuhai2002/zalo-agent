/**
 * Mô tả tool `schedule_task` - chưng cất từ `cronjob_tools.py` của Hermes
 * (mục 7, `thiet-ke-scheduler.md`), CHỈ giữ 4 điều có lý do CHỨC NĂNG. Không kê
 * đơn ví dụ cụ thể để model chép nguyên văn - bài học đã trả giá ở
 * `create-image-tool-description.ts` (nhét "brief thiết kế 5 mục" làm mọi ảnh
 * ra một khuôn). Ví dụ cú pháp cron là NGOẠI LỆ chấp nhận được: không phải gu
 * thẩm mỹ, mà là hình dạng bắt buộc của tham số (5 trường cách nhau bằng dấu
 * cách) mà model không thể tự suy ra nếu thiếu.
 */
export const SCHEDULE_TASK_DESCRIPTION =
  "Đặt, xem, sửa hoặc hủy lịch để bot tự nhắn vào ĐÚNG cuộc trò chuyện này ở một mốc giờ " +
  "trong tương lai (nhắc hẹn, báo cáo định kỳ...). Không đặt được lịch gửi sang hội thoại khác.\n" +
  "action='create': kind='message' gửi nguyên văn payload lúc tới giờ, không tốn lượt LLM - " +
  "dùng cho nhắc hẹn đơn thuần, RẺ HƠN NHIỀU. kind='agent' chạy một lượt agent (có tool) với " +
  "payload là PROMPT - chỉ dùng khi lúc chạy cần tra cứu/tổng hợp gì đó.\n" +
  "Payload của kind='agent' phải TỰ CHỨA đủ ngữ cảnh: lúc job chạy KHÔNG còn thấy lại cuộc " +
  "trò chuyện hiện tại, chỉ có đúng payload này.\n" +
  "action='list': xem lịch đang có trong cuộc trò chuyện này, trả về id từng lịch.\n" +
  "action='cancel'/'update': PHẢI gọi action='list' trước để lấy đúng id - TUYỆT ĐỐI không tự đoán id.\n" +
  "Sau khi tạo/sửa xong, đọc lại mốc giờ tool vừa trả cho người dùng nghe để họ xác nhận đúng ý.";
