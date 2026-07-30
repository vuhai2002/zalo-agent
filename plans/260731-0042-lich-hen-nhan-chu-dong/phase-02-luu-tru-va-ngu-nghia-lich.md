# Phase 02 - Lưu trữ và ngữ nghĩa lịch

Liên kết: [plan.md](plan.md) - [Thiết kế mục 3 và mục 4](reports/thiet-ke-scheduler.md) -
[Phase 01](phase-01-nen-tang-gio-va-va-ngay-vn.md)

## Tổng quan

- Ưu tiên: cao - phần lõi, mọi thứ sau đứng trên nó
- Trạng thái: chưa bắt đầu
- Hai bảng SQLite + hai module thuần tính lịch. Chưa chạy gì, chưa gửi gì.

## Nhận định then chốt

**Chặn job hại ngay lúc TẠO, đừng đợi tới lúc gửi.** `every 1m` là 1440 tin/ngày vào một
nick cá nhân - đúng chữ ký để Zalo khóa nick. Trần tin ở phase 03 là lưới đỡ cuối, còn
lưới đầu phải ở đây: từ chối `every` dưới ngưỡng, và với `cron` thì tính 2 mốc kế tiếp rồi
đo khoảng cách (`* * * * *` phải chết ở bước này).

**Chống trôi lịch** (goclaw `executeJobByID`): job `every` tính mốc sau từ thời điểm ĐÃ
ĐỊNH, không phải từ `now`. Không có phép này thì mỗi lượt trễ vài giây, chạy vài tuần là
7h sáng thành 7h20.

**Tách hai bảng** (Hermes `executions.py`): cột `last_status` trên job chỉ nói lần cuối.
Job hỏng 5 lần rồi lần 6 chạy được sẽ trông khoẻ mạnh hoàn hảo. Bảng run log mới kể được
chuyện đã xảy ra, và cột `turn_id` biến một job agent chạy sai thành một cú bấm sang trang
Trace.

**Không bê `process_id`/`pid`/`process_started_at` của Hermes.** Họ cần vì gateway và CLI
là hai tiến trình tranh nhau cùng `jobs.json`. Đây là MỘT process với `node:sqlite` đồng
bộ - bê nguyên là gánh phần phức tạp của bài toán không tồn tại.

## Yêu cầu

**Chức năng**
- 3 kiểu lịch `once` / `every` / `cron`, validate và chuẩn hoá về một dạng
- Tính mốc chạy kế, có grace window và fast-forward khi bot vừa bật lại
- CRUD job + ghi/đọc lịch sử chạy, dọn theo `SCHEDULER_RUN_LOG_KEEP`

**Phi chức năng**
- `schedule-parser.ts` và `next-run.ts` **thuần**: không DB, không env, không logger.
  Nhận `timeZone` và các ngưỡng qua tham số (nếp `botEnabledForThread` và `parseIncomingMessage`)
- Mọi cột thời gian lưu UTC ISO có `Z`

## Kiến trúc

```
schedule-parser.ts   đầu vào từ tool/dashboard -> ParsedSchedule + lỗi có chữ
      |               (gọi zone-time cho once, cron-parser để validate cron)
next-run.ts          ParsedSchedule + lastRun + now -> mốc kế / null, kèm quyết định
      |               chạy bù hay bỏ lượt
scheduled-job-store.ts   CRUD, truy vấn due, đặt next_run_at
job-run-log-store.ts     mở/chốt run, đọc lịch sử, dọn theo KEEP
```

`ParsedSchedule` là union theo `kind`, đã chuẩn hoá: `once` giữ `runAtUtc`, `every` giữ
`minutes`, `cron` giữ `expr` + `timeZone`.

## File liên quan

**Tạo**: `src/scheduler/schedule-parser.ts` (+test), `src/scheduler/next-run.ts` (+test),
`src/scheduler/scheduled-job-store.ts` (+test), `src/scheduler/job-run-log-store.ts` (+test)

**Sửa**: `package.json` (thêm `cron-parser`), `src/conversation/database.ts` (2 bảng mới +
cột `agent_turns.source`), `src/conversation/usage-store.ts` (`openAgentTurn` nhận `source`),
`src/config/env.ts` + `.env.example` + `.env.production.example` +
`src/config/tuning-definitions.ts` (8 tham số)

## Khai báo 8 tham số ngay ở phase này

`TuningKey` là `keyof typeof TUNING_BY_KEY`, nên `getTuning("SCHEDULER_TICK_MS")` ở phase 03
sẽ không qua được typecheck nếu key chưa tồn tại. Khai đủ 8 tham số ở đây, các phase sau chỉ
việc dùng. Phase 06 giữ phần tài liệu, kiểm trang Cấu hình và nghiệm thu thật.

Mỗi tham số đủ 4 nơi: Zod trong `env.ts` (kèm `min`/`max`), `.env.example`,
`.env.production.example`, `tuning-definitions.ts` (tên key TRÙNG tên env var, `min`/`max`
khớp Zod). Nhóm mới `lich-hen` trong `TUNING_GROUPS`.

| Key | Mặc định | Khoảng |
|---|---|---|
| `SCHEDULER_ENABLED` | true | boolean |
| `SCHEDULER_TICK_MS` | 30000 | 5000 - 300000 |
| `SCHEDULER_MIN_INTERVAL_MINUTES` | 5 | 1 - 1440 |
| `SCHEDULER_MAX_JOBS_PER_THREAD` | 20 | 1 - 200 |
| `SCHEDULER_MAX_PROACTIVE_PER_DAY` | 10 | 1 - 100 |
| `SCHEDULER_SEND_GAP_MS` | 20000 | 0 - 300000 |
| `SCHEDULER_ONCE_GRACE_MINUTES` | 10 | 1 - 1440 |
| `SCHEDULER_RUN_LOG_KEEP` | 50 | 5 - 1000 |

Cẩn thận ràng buộc chéo: đợt trước đã dính một luật chéo áp cho MỌI lần lưu khiến một cấu
hình sẵn có đã lệch **khóa cứng cả trang Cấu hình**. 8 tham số này không có ràng buộc chéo
nào với nhau - đừng tự thêm.

## Các bước

1. `pnpm add cron-parser`.
2. `database.ts`: tạo `scheduled_jobs` và `scheduled_job_runs` theo mục 3 của thiết kế, kèm
   2 index. Thêm `agent_turns.source` bằng `addColumnIfMissing` (mặc định `'message'` để
   mọi dòng cũ vẫn hợp lệ).
3. `schedule-parser.ts`:
   - `once`: nhận `{date, time}` (giờ địa phương) hoặc `{inMinutes}`. **Không nhận chuỗi
     datetime** - đó là đường để LLM làm lệch 7 tiếng. Quy đổi bằng `zonedWallClockToUtc`.
   - `every`: chặn dưới `minIntervalMinutes` (tham số).
   - `cron`: validate bằng cron-parser **có truyền `tz`**, rồi lấy 2 mốc kế tiếp và chặn
     khi khoảng cách dưới ngưỡng.
   - Lỗi trả về dạng chuỗi tiếng Việt đọc được, vì nó đi thẳng cho model và lên UI.
4. `next-run.ts`:
   - `computeNextRun(schedule, from)` cho từng kiểu; `every` dùng công thức neo mốc
     `next = scheduled + (elapsed / interval + 1) * interval`.
   - `graceSecondsFor(schedule)`: recurring = nửa chu kỳ kẹp `[120, 7200]`; `once` dùng
     `SCHEDULER_ONCE_GRACE_MINUTES`.
   - `decideDueAction(job, now)` trả `run` | `run-late` | `skip-forward`, khớp bảng 4 dòng
     ở mục 4 của thiết kế.
5. `scheduled-job-store.ts`: create/get/list theo thread/update/setEnabled/delete,
   `listDueJobs(nowUtc)`, `setNextRun(id, iso)`, `markRun(id, status, error)`. Chạm
   `max_runs` thì `enabled = 0` + `next_run_at = NULL`, **giữ nguyên row** (Hermes và
   goclaw đều xoá - làm lời nhắc biến mất không dấu vết).
6. `job-run-log-store.ts`: `openRun` / `finishRun` / `listRuns(jobId)` / dọn quá KEEP.
7. `openAgentTurn(accountId, threadId, source)` - `source` mặc định `'message'` để mọi lời
   gọi hiện có không phải sửa.

## Todo

- [ ] Thêm `cron-parser`
- [ ] 8 tham số đủ 4 nơi (Zod, 2 file `.env*.example`, tuning-definitions) + nhóm `lich-hen`
- [ ] 2 bảng mới + cột `agent_turns.source`
- [ ] `schedule-parser.ts` + test (gồm ca chặn `every 1m` và `* * * * *`)
- [ ] `next-run.ts` + test (gồm 4 nhánh của `decideDueAction`)
- [ ] `scheduled-job-store.ts` + test
- [ ] `job-run-log-store.ts` + test (gồm dọn theo KEEP)
- [ ] `openAgentTurn` nhận `source`
- [ ] `pnpm typecheck` + `pnpm test` sạch

## Tiêu chí hoàn thành

- Test chạy dưới `TZ=UTC`: mốc kế của `cron "0 7 * * *"` với `tz=Asia/Ho_Chi_Minh` ra
  `...T00:00:00.000Z`, **không** phải `...T07:00:00Z`. Đây là test quan trọng nhất phase này.
- `every 1m` và `cron "* * * * *"` đều bị từ chối kèm câu giải thích
- `once` với `{date:"2026-08-01", time:"15:00"}` cho `run_at` = `2026-08-01T08:00:00.000Z`
  dưới mọi giá trị `TZ`
- Job `every 30m` bị lỡ 3 tiếng: `decideDueAction` trả `skip-forward` và mốc mới nằm ở
  tương lai, không sinh ra 6 lượt dồn
- Job `once` lỡ 2 tiếng: trả `run-late` (không phải vứt)
- Migration chạy được trên **bản sao DB thật** (nhớ chép cả file `-wal`, chép thiếu là
  trông như mất dữ liệu)

## Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| cron-parser đổi API giữa v4 và v5 | Đọc type nó ship kèm trước khi viết, không đoán chữ ký |
| Test dùng giờ máy nên xanh giả | Set `TZ` tường minh, chạy 2 giá trị |
| Test mở DB rồi không đóng, `EPERM` khi dọn thư mục tạm trên Windows | `closeDatabase()` trước `cleanupTestEnv` - đúng lỗi đã dính ở 7 file test đợt trước |
| Ngưỡng chặn cron quá chặt, chặn oan lịch hợp lệ | Ngưỡng lấy từ `SCHEDULER_MIN_INTERVAL_MINUTES`, cùng một con số với `every` |

## An toàn

Chặn lịch bắn quá dày chính là biện pháp an toàn quan trọng nhất của cả đợt - nó chặn cả
tai nạn cấu hình lẫn prompt injection dụ model đặt job spam. Đặt ở tầng parser nên mọi
đường tạo job (tool, API dashboard) đều dính cùng một luật.

## Tiếp theo

Phase 03 dùng `listDueJobs` + `decideDueAction` để dựng vòng tick.
