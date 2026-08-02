# Changelog

Các thay đổi đáng kể của zalo-agent. Định dạng theo
[Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), đánh số theo
[Semantic Versioning](https://semver.org/lang/vi/).

Bản `0.x` nghĩa là API và cấu hình còn có thể đổi giữa các bản minor.

## [Chưa phát hành]

## [0.1.0] - 2026-08-02

Bản đầu tiên được đánh số. Gom toàn bộ những gì đã làm từ đầu dự án.

### Tính năng

- **Bot Zalo đa tài khoản**: nhiều account chạy chung một process, mỗi account
  một "não" (agent) riêng - persona, model, số bước tối đa đặt độc lập
- **Agent loop tự viết** trên Vercel AI SDK, LLM gọi qua router proxy nên đổi
  nhà cung cấp bằng biến môi trường, không sửa code
- **13 công cụ**: tra ngày giờ, tìm kiếm web (DuckDuckGo miễn phí, Brave nếu có
  key), đọc trang web, thả cảm xúc, gửi file, tag thành viên, xem thông tin
  nhóm, đọc ảnh, vẽ ảnh, ghi nhớ lâu dài, tạo file Word/Excel, đặt lịch hẹn
- **Trí nhớ 3 lớp**: lịch sử gần, tóm tắt phần đã trôi, và fact bền do bot tự
  ghi - bật/tắt từng công cụ theo account
- **Lịch hẹn**: bot tự nhắn theo lịch `once`/`every`/`cron`, đặt qua chat hoặc
  dashboard. Hai lớp chống spam độc lập vì đây là tính năng rủi ro khóa nick
  cao nhất: chặn lịch lặp quá dày lúc TẠO, và trần tin chủ động mỗi ngày lúc GỬI
- **Dashboard web**: xem hội thoại, contacts, trí nhớ, trace từng bước của agent,
  log hệ thống, bật/tắt bot theo cuộc trò chuyện, đổi nhà cung cấp LLM
- **Trang Cấu hình**: 31 tham số trước đây chỉ sửa được trong `.env` rồi khởi
  động lại, giờ chỉnh trực tiếp và có hiệu lực ngay
- **Đổi mật khẩu dashboard** từ web, lưu dạng hash; đổi xong thu hồi mọi phiên
  đăng nhập khác
- **Chế độ tối** kèm ảnh nền riêng, nhớ lựa chọn giữa các lần mở

### Bảo mật

- Cookie Zalo mã hóa AES-256-GCM trên đĩa
- Chặn IDOR ở tầng lưu trữ cho lịch hẹn: đọc/sửa/xóa đều bắt buộc khớp cả
  account lẫn cuộc trò chuyện
- Chỉ tải được URL trỏ tới IP công cộng - chặn loopback, mạng nội bộ và
  endpoint metadata của cloud (phòng prompt injection lừa bot đọc dịch vụ nội bộ)
- Nội dung lấy từ web được bọc trong khối đánh dấu rõ là DỮ LIỆU, không phải
  mệnh lệnh; tin của người ngoài danh sách cho phép có nhãn riêng
- Rate limit đăng nhập dashboard, phiên lưu trong DB nên đăng xuất thu hồi được thật

[Chưa phát hành]: https://github.com/vuhai2002/zalo-agent/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/vuhai2002/zalo-agent/releases/tag/v0.1.0
