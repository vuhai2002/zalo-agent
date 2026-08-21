# Nối lịch hẹn vào kênh Zalo Bot

Mở `schedule_task` + trang Lịch hẹn cho tài khoản Zalo Bot chính thức.

## Vì sao làm

Lịch hẹn bị chặn trên kênh bot KHÔNG phải vì nền tảng thiếu năng lực - đây là
dòng DUY NHẤT trong `TOOL_KHONG_CHAY_TREN_BOT` không dẫn được một số đo 404
hay ràng buộc cứng nào. Bot API gửi chủ động được (số đo thật: 10 tin trong
416ms, không bị chặn - `docs/project-roadmap.md:4312`), và `kenhBot.duongGui`
đang chạy mỗi ngày để trả lời tin thường.

Nguyên nhân thật: **scheduler khóa cứng vào zca-js**, và **đối tượng kênh bot
không lấy lại được từ ngoài runner**. Chi tiết + bằng chứng:
[reports/nguyen-nhan-goc.md](reports/nguyen-nhan-goc.md).

## Phases

| # | Nội dung | Trạng thái |
|---|---|---|
| [01](phase-01-lo-kenh-ra-khoi-runner.md) | Lộ `KenhLuot` ra khỏi runner - `getRunningAccountKenh()` | [x] xong |
| [02](phase-02-scheduler-gui-qua-kenh-luot.md) | Scheduler gửi qua `KenhLuot` thay `duongGuiZcaJs` (3 chỗ) | [x] xong |
| [03](phase-03-ngan-sach-byte-theo-kenh.md) | Kênh không mang định dạng thì không tính `styles` vào ngân sách byte | [x] xong |
| [04](phase-04-go-chan-ba-lop.md) | Gỡ chặn 3 lớp + persona + dashboard | [x] xong |
| [05](phase-05-ra-soat-va-tai-lieu.md) | Rà soát toàn cục, test dưới tải, cập nhật tài liệu | [x] xong |

## Ràng buộc phải giữ

- **Kênh cá nhân không được hồi quy.** Toàn bộ `run-scheduled-job.test.ts`,
  `scheduled-job-send.test.ts`, `run-scheduled-job-trial.test.ts` phải xanh
  nguyên vẹn sau mỗi phase.
- **Bất biến "một lời nhắc chưa từng gửi được thì không bao giờ được coi là đã
  chạy"** (`scheduled-job-conclude.ts`) - không đụng.
- **Sổ sách trần ngày dùng CHUNG một mốc `now`** cho cả lượt - mọi hàm trong
  `proactive-send-guard.ts` vẫn KHÔNG được có `= new Date()`.
- **`loai` chốt lúc tạo account**, không đổi được sau đó - phase 04 không nới
  chỗ này.
- Job không đẻ job: `schedule_task` giữ nguyên `runsInScheduledTurn: false`.
- File < 200 dòng, kebab-case, chuỗi tiếng Việt giữ dấu, dấu câu ASCII.

## Phụ thuộc

Phase 02 cần 01. Phase 04 cần 02 (gỡ chặn trước khi có đường gửi là mở đúng
cái vòng dispatch vô hạn mà lớp chặn sinh ra để ngăn). Phase 03 độc lập, có
thể làm song song nhưng nên nằm trước 04 để lượt bot đầu tiên chạy thật đã
đúng ngân sách.

## Ngoài phạm vi (cố ý)

- `create_image` trên kênh bot (cần đường phục vụ ảnh qua HTTPS công khai).
- `pnpm zalo-login <id>` không kiểm `loai` - đường vào riêng, việc riêng.
- Định dạng đậm/nghiêng cho kênh bot (cần đo phương ngữ markdown của Zalo).
- Nhắn chủ động cho người CHƯA từng nhắn bot - `chat_id` chỉ có sau khi họ
  nhắn, và `checkAccountAndThreadReady` vốn đã bắt buộc thread có trong DB.
