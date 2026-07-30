# Phase 05 - Dashboard trang Lịch hẹn

Liên kết: [plan.md](plan.md) - [Thiết kế mục 9](reports/thiet-ke-scheduler.md) -
[Phase 04](phase-04-tool-schedule-task.md)

## Tổng quan

- Ưu tiên: trung bình - tính năng chạy được không cần trang này, nhưng không có nó thì job
  chạy sai là một hộp đen
- Trạng thái: chưa bắt đầu
- API + trang xem/sửa job và lịch sử chạy

## Nhận định then chốt

**Giờ hiển thị phải pin theo `BOT_TIMEZONE`, không theo trình duyệt.** Web đang dùng
`toLocaleTimeString("vi-VN")` không truyền `timeZone` (`logs-page.tsx:28`) nên lấy zone
máy đang xem. Với máy ở VN thì đúng do trùng, nhưng "job chạy 7h sáng" là 7h sáng của
**bot**. API trả kèm tên zone, web dùng nguyên - trình duyệt không cần biết `BOT_TIMEZONE`,
cùng nguyên tắc đã áp cho danh sách icon reaction.

**Job lỗi phải nhìn thấy được.** Phase 03 chốt job lỗi không nhắn gì cho người dùng, nên
trang này là đường DUY NHẤT để biết một job đang hỏng. Badge đỏ + `last_error` là bắt buộc,
không phải trang trí.

**Nút "Chạy thử ngay" là thứ giá trị nhất trang này.** Không có nó thì kiểm một job `cron`
hàng ngày phải đợi tới hôm sau.

## Yêu cầu

**Chức năng**
- Liệt kê job theo account, hiện kiểu lịch + mốc chạy kế + trạng thái lần cuối
- Bật/tắt, xóa (có confirm), chạy thử ngay
- Drawer lịch sử chạy, job `agent` có link sang trang Trace
- Tạo/sửa job từ web (không bắt buộc phải qua chat)

**Phi chức năng**
- Mọi route sau `requireAuth` như các route khác
- Thao tác ghi đi qua cùng tầng store với tool nên dính cùng ràng buộc

## Kiến trúc

```
GET    /api/schedule?accountId=       danh sách job + timezone
POST   /api/schedule                  tạo
PATCH  /api/schedule/:id              sửa / bật tắt
DELETE /api/schedule/:id              xóa
POST   /api/schedule/:id/run          chạy thử ngay
GET    /api/schedule/:id/runs         lịch sử chạy
```

Web: `schedule-page.tsx` + mục mới trên `sidebar-nav`, dùng lại `ui-bits`,
`confirm-dialog`, `account-filter` đã có.

## File liên quan

**Tạo**: `src/server/routes/schedule-routes.ts` (+test),
`web/src/pages/schedule-page.tsx`, `web/src/pages/schedule-edit-drawer.tsx`

**Sửa**: `src/server/dashboard-server.ts` (gắn route), `web/src/app.tsx`,
`web/src/layout/sidebar-nav.tsx`, `web/src/dashboard-api-client.ts`

## Các bước

1. `schedule-routes.ts`: 6 route trên. Route ghi dùng đúng store của phase 02 nên phạm vi
   thread và ngưỡng lịch tự áp. Response luôn kèm `timezone`.
2. "Chạy thử ngay" gọi thẳng `run-scheduled-job` **không** đổi `next_run_at` - chạy thử
   không được làm lệch lịch thật. Vẫn qua guard: chạy thử cũng là tin chủ động, cũng tính
   vào trần ngày.
3. `schedule-page.tsx`: danh sách + lọc theo account. Mỗi dòng: tên, badge kiểu lịch, mốc
   kế (format với `timeZone` từ API), badge trạng thái, cụm nút. Job lỗi hiện `last_error`
   ngay trên dòng, không bắt mở drawer.
4. Drawer sửa: dùng lại bố cục `account-edit-drawer` sẵn có. Ô nhập lịch chọn kiểu trước
   rồi mới hiện ô tương ứng (`once` -> ngày + giờ; `every` -> số phút; `cron` -> biểu thức
   kèm dòng mô tả mốc kế tính từ server).
5. Drawer lịch sử: bảng các lần chạy, trạng thái, thời điểm, lý do khi `skipped`, link
   Trace khi có `turn_id`.
6. Bám thang chữ và cách phân vùng đã chốt: cỡ chữ chỉ dùng số nguyên (11/12/13/14/15/17),
   chữ nhỏ giãn dòng >= 1.5, phân vùng bằng nền `bg-tile` chứ không bằng đường kẻ mảnh, ô
   nhập BẮT BUỘC có nhãn (không dựa vào placeholder).

## Todo

- [ ] 6 route + test API (gồm ca 401 khi chưa đăng nhập)
- [ ] Gắn route vào `dashboard-server.ts`
- [ ] `schedule-page.tsx` + mục sidebar
- [ ] Drawer sửa job
- [ ] Drawer lịch sử chạy + link Trace
- [ ] Kiểu trong `dashboard-api-client.ts`
- [ ] `pnpm typecheck` (gồm `-p web`) + `pnpm test` sạch
- [ ] Kiểm bằng trình duyệt thật trên instance riêng (port 3901, DB tạm) - nếp đã có

## Tiêu chí hoàn thành

- Tạo job trên web, mốc kế hiện đúng giờ VN kể cả khi máy chủ chạy `TZ=UTC`
- "Chạy thử ngay" gửi được tin mà `next_run_at` không đổi
- Job lỗi hiện badge đỏ + câu lỗi ngay trên dòng
- Xóa job có confirm-dialog (không phải `window.confirm`)
- Drawer lịch sử mở được trang Trace của một lần chạy job `agent`
- Không route nào trả dữ liệu khi chưa đăng nhập

## Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Web tự tính giờ rồi lệch với server | API trả `timezone`, web pin theo nó, không tự suy |
| Nút chạy thử làm lệch lịch thật | Không đụng `next_run_at`, có test khẳng định |
| Nút chạy thử thành đường spam | Vẫn qua guard, vẫn tính vào trần ngày |
| Ô nhập cron cho gõ biểu thức hại | Validate ở server bằng đúng parser của phase 02, hiện mốc kế để người dùng tự thấy sai |

## An toàn

Mọi route sau `requireAuth`. Route ghi không nhận `accountId`/`threadId` tuỳ ý cho job đã
tồn tại - đích ghim từ lúc tạo, sửa được lịch và nội dung chứ không sửa được nơi gửi.

## Tiếp theo

Phase 06 đưa tham số lên trang Cấu hình, cập nhật tài liệu, nghiệm thu trên Zalo thật.
