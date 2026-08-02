# Changelog

Các thay đổi đáng kể của zalo-agent. Định dạng theo
[Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), đánh số theo
[Semantic Versioning](https://semver.org/lang/vi/).

Bản `0.x` nghĩa là API và cấu hình còn có thể đổi giữa các bản minor.

## [Chưa phát hành]

### Thêm

- Agent tự khai được bộ công cụ của mình (`agents.disabled_tools`), GIAO với bộ
  công cụ của tài khoản Zalo. Công cụ dùng được là phần không bên nào tắt - agent
  khai năng lực, tài khoản áp chính sách, không bên nào bật ngược lại được bên
  kia. Nhờ vậy dựng được nhiều vai khác bộ công cụ trên cùng một nick.
- Ngân sách token thật cho ngữ cảnh (`LLM_CONTEXT_WINDOW`, đặt riêng được cho
  từng agent). Trước nay chỉ chặn bằng SỐ TIN, mà một tin Zalo dài tùy ý. Vượt
  ngân sách thì bot bỏ bớt ảnh cũ trước, rồi mới bỏ tin cũ; thêm điều kiện dừng
  giữa lượt theo usage thật.
- Trang sửa agent riêng (`/agents/:id`) chia nhóm Danh tính / Model / Công cụ.
  Màn tạo agent rút còn hai ô, ID tự sinh từ tên.

- Chặn vòng lặp công cụ trong một lượt: ba bộ đếm riêng (lỗi giống hệt, cùng
  công cụ lỗi, công cụ đọc trả cùng kết quả). Trước đó chặn trên duy nhất là số
  bước, nên bot gọi mãi một công cụ hỏng vẫn đốt hết lượt rồi trả lời cụt.
- Phân loại lỗi nhà cung cấp thay vì thử lại mù: hết quota tôn trọng
  `Retry-After` thật, tràn ngữ cảnh cắt sâu hơn rồi thử lại, sai khóa hoặc chưa
  cấu hình thì KHÔNG thử lại và báo câu riêng - chờ bao lâu cũng không tự hết.
- Lớp làm sạch câu trả lời trước khi chữ ra Zalo: bỏ markdown (Zalo không
  render nên `**đậm**` hiện nguyên ký tự), chặn hẳn câu lộ chỉ dẫn nội bộ, bỏ
  nhãn `[SILENT]` lọt vào chat thường. Giữ nguyên gạch đầu dòng, dấu sao giữa
  số và dấu tiếng Việt.
- `pnpm eval` - bộ kiểm thử chạy MODEL THẬT, khẳng định trên hành vi (gọi công
  cụ nào) chứ không trên câu chữ. Khác `pnpm test` ở mục đích: model giả không
  nói được gì về việc model thật có tra cứu thay vì đoán không.
- Luật hỏi lại khi thiếu thông tin (12-Factor #7): bot hỏi lại trước việc làm
  xong mới biết sai, gom hết thứ còn thiếu vào một câu, và KHÔNG hỏi vặn khi
  yêu cầu đã đủ rõ.
- Dải cảnh báo trên trang Tổng quan khi chưa cấu hình LLM - trước đó bot vẫn
  khởi động bình thường nên dashboard xanh trong khi mọi tin nhắn đều hỏng.

### Sửa

- Ô chọn nhà cung cấp của agent gửi API key của router thẳng sang endpoint của
  bên khác: `resolveLanguageModel` chỉ đổi provider và model, còn key luôn lấy
  từ cấu hình chung. Vừa lộ khóa sang bên thứ ba vừa làm bot câm vì 401. Nay
  override nhà cung cấp lệch bị bỏ qua ngay tại chỗ dựng client.
- Trang Tools hiện trạng thái ngược với bộ công cụ model thật nhận (công tắc ở
  đó chỉ nói lớp tài khoản).
- Rời trang sửa agent khi còn thay đổi chưa lưu thì mất trắng, không hỏi.
- Gõ nhầm một chữ vào ô số bước làm mất âm thầm giới hạn bước của agent.

- Kết quả HỎNG của công cụ nay có đánh dấu máy đọc được nên bộ chặn vòng lặp
  đếm được chúng; trước đó hai trong ba bộ đếm là code chết vì không công cụ
  nào ném lỗi. Trang Trace cũng tô đỏ nhánh hỏng thay vì hiện như kết quả thường.
- Lưu trang Providers với ô Model để trống làm mất luôn API key vừa nhập.
### Đổi

- `pnpm test` quét cả `web/src` - cây này trước đó không có test nào.
- `.env.example` từ 68 biến còn 13. Gần như mọi tham số đã có trên dashboard và
  dashboard ĐÈ `.env`, nên danh sách dài kia vừa thừa vừa gây hiểu nhầm: giá trị
  cũ nằm lại trong `.env` trong khi DB đang gánh. `LLM_MODEL` và `LLM_BASE_URL`
  hết bắt buộc - cài mới giờ chỉ cần điền `CREDENTIALS_ENCRYPTION_KEY`, phần còn
  lại nhập trên dashboard. **Nâng cấp không cần làm gì**: `.env` cũ vẫn chạy y hệt.

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
