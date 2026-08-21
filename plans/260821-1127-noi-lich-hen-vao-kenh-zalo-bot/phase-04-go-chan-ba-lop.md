# Phase 04 - Gỡ chặn ba lớp

Ưu tiên: cao. Phụ thuộc: phase 02 (BẮT BUỘC). Trạng thái: [x] xong.
Bối cảnh: [reports/nguyen-nhan-goc.md](reports/nguyen-nhan-goc.md) mục 5.

## Vấn đề

Ba lớp chặn tồn tại vì scheduler không có đường gửi cho kênh bot. Phase 02 đã
làm ra đường đó. Gỡ chặn TRƯỚC phase 02 là mở đúng vòng dispatch vô hạn mà ba
lớp này sinh ra để ngăn - nên thứ tự là ràng buộc cứng, không phải sở thích.

## Files sửa

| File | Việc |
|---|---|
| `src/zalo-bot/nang-luc-kenh-bot.ts` | Xóa mục `schedule_task` khỏi `TOOL_KHONG_CHAY_TREN_BOT` (còn 7) |
| `src/server/routes/schedule-routes.ts` | Xóa nhánh 400 cho `acc.loai === "bot"` ở `POST /` |
| `src/scheduler/run-scheduled-job.ts` | Nhánh `loai === "bot"` đã bỏ ở phase 02 - chỉ xác nhận |

## Không sửa (đã kiểm, cố ý giữ)

- `LUAT_PERSONA_KENH_BOT` **không nhắc lịch hẹn** - câu hiện tại liệt kê "file,
  tài liệu Word/Excel, ảnh tự vẽ, thả cảm xúc, tag" và không có chữ nào về
  lịch. Nên không phải sửa. Nhưng PHẢI có test khẳng định điều đó, không thì
  lần sau ai thêm chữ "không đặt được lịch" vào đó là persona nói dối mà không
  ai biết.
- `schedule_task` giữ `runsInScheduledTurn: false` - job không đẻ job (luật số
  1 của Hermes), không liên quan tới kênh.
- `PATCH /api/schedule/:id` không kiểm `loai` - mục treo cũ trong roadmap, giờ
  thành vô nghĩa vì bot đã được phép. Đóng mục đó ở phase 05.
- `web/src/pages/schedule-page.tsx` không hề phân biệt `loai` - không có gì để
  gỡ. Trang tự chạy đúng.
- Trang Tools tự đúng: badge và `unavailableHint` đọc `kiemTraKhaDung`, mà hàm
  đó đọc thẳng `TOOL_KHONG_CHAY_TREN_BOT`. Xóa một mục là UI đổi theo.

## Tests

Viết lại `src/zalo-bot/chan-lich-hen-kenh-bot.test.ts` thành
`src/zalo-bot/lich-hen-tren-kenh-bot.test.ts`.

Đây là file khẳng định hành vi CŨ, nên nó SẼ đỏ từ phase 02. Không xóa trắng:
ba ca trong đó đo những bất biến vẫn còn đúng, phải chuyển sang file mới
nguyên vẹn.

| # | Ca | Khẳng định | Nguồn |
|---|---|---|---|
| 1 | `POST /api/schedule` cho account bot | **201**, không còn 400 | đảo ca cũ |
| 2 | account cá nhân vẫn tạo được | 201 (chốt chống chặn nhầm) | giữ từ file cũ |
| 3 | `schedule_task` CÓ trong tool của lượt CHAT trên bot | `listAvailableTools` chứa key; `/api/tools?accountId=<bot>` trả `available: true`, không có `unavailableHint` | mới |
| 4 | bot còn ĐÚNG 7 tool bị chặn | `Object.keys(TOOL_KHONG_CHAY_TREN_BOT).length === 7` và `schedule_task` vắng mặt | mới |
| 5 | persona kênh bot KHÔNG nói bot không đặt được lịch | `LUAT_PERSONA_KENH_BOT` không khớp `/lịch|hẹn|schedule/i` | mới, canh nợ tương lai |
| 6 | job CŨ của account bot giờ CHẠY | dựng job qua store cho account bot đang chạy -> `client.sendMessage` nhận tin, run = `ok`, job KHÔNG bị tắt | đảo ca cũ |
| 7 | job `every` của account bot không bị tắt | `enabled: true`, có `nextRunAt` mới | đảo ca cũ |
| 8 | XÓA account thì dọn luôn lịch hẹn | job mồ côi không sống dậy khi tạo lại cùng id | **giữ nguyên** từ file cũ - bất biến này không liên quan bot |

Ca 6 và 7 trùng ý với ca 1/8 của phase 02 nhưng đi qua ĐƯỜNG KHÁC (route
dashboard + store trực tiếp thay vì gọi thẳng `runScheduledJob`). Giữ cả hai:
đó đúng là hai đường vào mà mục 5 báo cáo gốc liệt kê.

### Phép phá bắt buộc

| Phá gì | Ca phải ĐỎ |
|---|---|
| Thêm lại mục `schedule_task` vào `TOOL_KHONG_CHAY_TREN_BOT` | 1 (route vẫn 201 nhưng 3, 4 đỏ), 3, 4 |
| Thêm lại nhánh 400 ở route | 1 |
| Thêm chữ "không đặt được lịch" vào `LUAT_PERSONA_KENH_BOT` | 5 |
| Bỏ bước dọn job lúc `deleteAccount` | 8 |

## Tiêu chí xong

- 8 ca xanh, 4 phép phá đỏ đúng ca.
- File cũ `chan-lich-hen-kenh-bot.test.ts` đã xóa (nội dung đã chuyển hết).
- `chan-tool-tren-kenh-bot.test.ts`, `nang-luc-kenh-bot.test.ts`,
  `tao-tai-khoan-bot.test.ts` xanh - sửa số 8 thành 7 ở đâu cần.
- Full suite xanh.

## Rủi ro

- Đây là phase DUY NHẤT đổi hành vi nhìn thấy được của người dùng cuối. Nếu
  phase 02 sót một đường, lỗi sẽ hiện ra dưới dạng job quay vòng mỗi tick trên
  máy thật. Ca 5 của phase 02 (`concludeBlockedNotRun` khi account tắt) và ca
  6/7 ở đây là hai chốt chặn cho đúng ca đó.
- Số "8 tool bị chặn" nằm rải trong README, README.en, system-architecture và
  roadmap. Phase 05 lo phần chữ.
