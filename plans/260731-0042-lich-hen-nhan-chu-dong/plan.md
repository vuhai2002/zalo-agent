# Lịch hẹn - bot nhắn chủ động theo lịch

Thiết kế đầy đủ + lý do từng quyết định: [reports/thiet-ke-scheduler.md](reports/thiet-ke-scheduler.md)

Bot tự nhắn theo lịch: nhắc hẹn một lần, báo cáo định kỳ, theo dõi có gì mới mới báo.
Job tạo được bằng cách nói chuyện với bot ("nhắc tôi 3h chiều mai họp") hoặc trên dashboard.

Học từ `hermes-agent/cron/` (phiên cô lập, `[SILENT]`, grace window, cấm job đẻ job) và
`goclaw/internal/cron/` (clear-before-dispatch, chống trôi lịch, job lỗi không deliver).

## Phạm vi

| Có làm | Không làm |
|---|---|
| Job `message` (0 token) + job `agent` (có tool) | Giờ im lặng (user đã loại) |
| Lịch `once` / `every` / `cron` | Job chạy lệnh shell (goclaw có, quá rủi ro ở đây) |
| Tool `schedule_task` create/list/cancel/update | Gửi tới thread khác thread tạo job |
| Trang Lịch hẹn trên dashboard | Chuỗi job nối nhau (`context_from` của Hermes) |
| Trần tin chủ động + rải đều toàn cục | Retry ở tầng scheduler |
| Vá "hôm nay" đang tính theo ngày UTC | |

## Các phase

| # | Phase | Trạng thái |
|---|---|---|
| 01 | [Nền tảng giờ + vá ngày VN](phase-01-nen-tang-gio-va-va-ngay-vn.md) | Chưa bắt đầu |
| 02 | [Lưu trữ, ngữ nghĩa lịch, 8 tham số](phase-02-luu-tru-va-ngu-nghia-lich.md) | Chưa bắt đầu |
| 03 | [Vòng chạy và gửi tin](phase-03-vong-chay-va-gui-tin.md) | Chưa bắt đầu |
| 04 | [Tool schedule_task](phase-04-tool-schedule-task.md) | Chưa bắt đầu |
| 05 | [Dashboard trang Lịch hẹn](phase-05-dashboard-trang-lich-hen.md) | Chưa bắt đầu |
| 06 | [Tài liệu và nghiệm thu](phase-06-tham-so-tai-lieu-nghiem-thu.md) | Chưa bắt đầu |

## Phụ thuộc giữa các phase

```
01 (zone-time)  ->  02 (lịch)  ->  03 (chạy + gửi)  ->  04 (tool)  ->  05 (web)  ->  06
     |                                    |                              |
     +-- vá ngày VN chạy độc lập được ----+------------------------------+
```

Phase 01 phải xong trước 02 vì `schedule-parser` và `next-run` đều gọi `zone-time`.
Phần vá ngày VN trong phase 01 không phụ thuộc gì ở sau, kiểm chứng được ngay.

## Dependency mới

`cron-parser` ^5.6.2 và `luxon` ^3.7.2 (dependencies), `@types/luxon` ^3.7.2 (dev).
Luxon vốn là phụ thuộc của cron-parser nhưng pnpm layout chặt không cho import gián tiếp,
phải khai trực tiếp. Chú ý `minimumReleaseAge: 1440` - bản chưa đủ 24h sẽ bị chặn.

## Ràng buộc xuyên suốt

- **Lưu UTC, hiểu và hiện theo `BOT_TIMEZONE`.** Không cột nào lưu giờ tường thiếu zone.
- Test lịch chạy với `TZ=UTC` **và** `TZ=America/New_York`, phải ra cùng kết quả.
- File dưới 200 dòng, kebab-case, tên tự mô tả.
- Env var mới phải có đủ ở `.env.example`, `.env.production.example`, schema Zod `env.ts`,
  và `tuning-definitions.ts` (tên key trùng tên env var, `min`/`max` khớp Zod).
- Chuỗi tiếng Việt giữ nguyên dấu, chỉ dùng dấu câu ASCII.
- `pnpm typecheck` + `pnpm test` sạch trước khi báo xong từng phase.

## Rủi ro lớn nhất

Bot nhắn chủ động là hành vi rủi ro khóa nick cao nhất từ trước tới nay của dự án. Ba lớp
chặn: trần `every` tối thiểu 5 phút lúc TẠO, trần 10 tin/thread/ngày lúc GỬI, và sentinel
`[SILENT]` để job theo dõi im khi không có gì mới. Nghiệm thu thật phải bắt đầu bằng một
job `once` duy nhất, không bật job `every` cho tới khi thấy log sạch.
