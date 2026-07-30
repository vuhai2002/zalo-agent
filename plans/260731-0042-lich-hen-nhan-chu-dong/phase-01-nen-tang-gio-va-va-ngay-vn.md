# Phase 01 - Nền tảng giờ + vá "hôm nay" đang tính theo ngày UTC

Liên kết: [plan.md](plan.md) - [Thiết kế mục 2 và mục 11](reports/thiet-ke-scheduler.md)

## Tổng quan

- Ưu tiên: **cao nhất** - mọi phase sau đều gọi `zone-time`
- Trạng thái: chưa bắt đầu
- Dựng module quy đổi giờ dùng chung, rồi vá luôn ba chỗ đang tính "hôm nay" theo ngày UTC

## Nhận định then chốt

Codebase đang **sạch** ở phần lưu trữ: mọi cột thời gian là UTC có hậu tố `Z`
(`strftime('%Y-%m-%dT%H:%M:%fZ','now')` và `toISOString()`), `BOT_TIMEZONE` chỉ dùng để
hiển thị. Phải giữ bất biến đó.

Chỗ hỏng nằm ở các câu hỏi dạng "hôm nay". Ba chỗ, cùng gốc bệnh, **phải sửa cùng lúc**:
sửa backend mà bỏ frontend thì từ 00:00 tới 07:00 giờ VN hai ô "Lượt hôm nay" và
"Token hôm nay" hiện 0 vì key ngày VN không khớp key ngày UTC.

Dùng luxon chứ không tự cộng trừ offset: VN không có DST nên tự tính "trông dễ", nhưng
`BOT_TIMEZONE` là cấu hình - ai đặt `Europe/Paris` là gặp DST ngay.

## Yêu cầu

**Chức năng**
- Quy đổi giờ tường theo zone sang mốc UTC và ngược lại
- Mốc đầu ngày theo zone, trả về dạng UTC ISO để so với cột DB
- Khoá ngày (`YYYY-MM-DD`) của một mốc UTC theo zone
- "Tin hôm nay", biểu đồ 7 ngày, và ô "Lượt/Token hôm nay" đều tính theo ngày VN

**Phi chức năng**
- `zone-time.ts` thuần: không import `env`, không chạm DB, không tạo logger (nếu không
  test của module thuần sẽ đẻ file log trong `data/` - lỗi đã dính ở `html-to-text`)
- Zone hỏng thì fallback UTC, không ném lỗi làm chết lượt (theo nếp `getDateTimeParts`)

## Kiến trúc

`src/shared/zone-time.ts` - caller tự truyền `timeZone` vào, giống hệt cách
`current-datetime.ts` đang làm. Đặt ở `shared/` vì cả `server/`, `conversation/` và
`scheduler/` đều dùng - để ở `scheduler/` là bắt hai module kia đi mượn ngược chiều
(bài học `stripHtmlTags`).

```ts
zonedWallClockToUtc(date: string, time: string, timeZone: string): string | null
startOfDayUtc(timeZone: string, now?: Date): string
dayKeyOf(utcIso: string, timeZone: string): string
todayKey(timeZone: string, now?: Date): string
```

## File liên quan

**Tạo**: `src/shared/zone-time.ts`, `src/shared/zone-time.test.ts`

**Sửa**:
- `package.json` - thêm `luxon`, `@types/luxon`
- `src/server/overview-stats.ts` - `messagesToday` nhận mốc UTC làm tham số
- `src/conversation/usage-store.ts` - `getDailyUsage` gom theo ngày VN
- `src/server/routes/overview-routes.ts` - trả thêm `todayKey` + `timezone`
- `web/src/pages/overview-page.tsx` - dùng `todayKey` của API
- `web/src/dashboard-api-client.ts` - kiểu trả về

## Các bước

1. `pnpm add luxon` + `pnpm add -D @types/luxon`. Nếu vướng `minimumReleaseAge` thì lấy
   bản phát hành trước đó, không hạ cấu hình bảo mật.
2. Viết `zone-time.ts` với 4 hàm trên. `zonedWallClockToUtc` trả `null` khi chuỗi không
   hợp lệ để caller báo lỗi tử tế thay vì ném.
3. Viết test TRƯỚC khi sửa 3 chỗ kia, chạy với `TZ=UTC` và `TZ=America/New_York`.
4. `overview-stats.ts`: bỏ `strftime('%Y-%m-%dT00:00:00Z','now')` khỏi câu SQL, đổi thành
   tham số ràng buộc. `getAccountStats` nhận thêm mốc hoặc tự gọi `startOfDayUtc`.
5. `usage-store.ts`: `getDailyUsage` giữ `WHERE created_at >= ?` (vẫn chặn phạm vi quét)
   nhưng trả từng dòng rồi gom bằng `dayKeyOf` trong JS. **Không** dùng
   `datetime(created_at, '+7 hours')` - offset cứng sai ở zone có DST. Chi phí ổn: đo
   trên DB thật có 67 dòng `agent_turns`.
6. `overview-routes.ts`: `since` tính bằng `startOfDayUtc` lùi 7 ngày; response thêm
   `todayKey` và `timezone`.
7. `overview-page.tsx`: bỏ `new Date().toISOString().slice(0,10)`, dùng `data.todayKey`.
   Trình duyệt không cần biết `BOT_TIMEZONE` - cùng nguyên tắc đã áp cho danh sách icon
   reaction (server cấp để frontend không lệch).

## Todo

- [ ] Thêm `luxon` + `@types/luxon`
- [ ] `zone-time.ts` với 4 hàm
- [ ] `zone-time.test.ts` chạy 2 giá trị `TZ`
- [ ] Vá `overview-stats.ts`
- [ ] Vá `getDailyUsage`
- [ ] Vá `overview-routes.ts` (trả `todayKey` + `timezone`)
- [ ] Vá `overview-page.tsx` + kiểu ở `dashboard-api-client.ts`
- [ ] `pnpm typecheck` + `pnpm test` sạch

## Tiêu chí hoàn thành

- Test khẳng định `startOfDayUtc("Asia/Ho_Chi_Minh")` lúc 03:00 VN ngày 31/07 trả
  `2026-07-30T17:00:00.000Z`, KHÔNG phải `2026-07-31T00:00:00Z`
- Test khẳng định `zonedWallClockToUtc("2026-08-01","15:00","Asia/Ho_Chi_Minh")` ra
  `2026-08-01T08:00:00.000Z` khi chạy dưới cả `TZ=UTC` lẫn `TZ=America/New_York`
- Có ít nhất một test dùng zone CÓ DST (`Europe/Paris`) hai bên mốc chuyển giờ, khẳng định
  offset đổi theo - đây là thứ bản tự-cộng-7-tiếng sẽ trượt
- Mở dashboard lúc trước 07:00 sáng: "Tin hôm nay" và "Lượt hôm nay" khớp với số đếm tay
  từ DB theo ngày VN

## Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Đổi khoá ngày làm vỡ biểu đồ web | Sửa frontend trong CÙNG phase, không tách |
| `getDailyUsage` gom trong JS chậm khi DB lớn | Vẫn giữ `WHERE created_at >= ?`; đo được 67 dòng hiện tại, cửa sổ 7 ngày luôn nhỏ |
| Test viết theo giờ máy dev (VN) nên không bắt được bug | Bắt buộc set `TZ` tường minh trong test, không dựa vào giờ máy |

## An toàn

Không đụng tới xác thực hay dữ liệu nhạy cảm. `zone-time.ts` không log gì.

## Tiếp theo

Phase 02 dùng `zonedWallClockToUtc` cho `once` và `startOfDayUtc` cho trần tin theo ngày.
