# Phase 06 - Tài liệu và nghiệm thu

> Đổi so với bản đầu: 8 tham số đã chuyển sang **phase 02** vì `TuningKey` là
> `keyof typeof TUNING_BY_KEY` - phase 03 gọi `getTuning("SCHEDULER_TICK_MS")` sẽ không
> qua typecheck nếu key chưa tồn tại. Phase này còn tài liệu, kiểm trang Cấu hình, và
> nghiệm thu thật. Bảng tham số giữ lại bên dưới để đối chiếu khi kiểm.

Liên kết: [plan.md](plan.md) - [Thiết kế mục 10](reports/thiet-ke-scheduler.md) -
[Phase 05](phase-05-dashboard-trang-lich-hen.md)

## Tổng quan

- Ưu tiên: trung bình, nhưng KHÔNG được bỏ - đây là chỗ tính năng thành dùng được thật
- Trạng thái: chưa bắt đầu
- Đưa 8 tham số lên trang Cấu hình, cập nhật tài liệu, chạy thật trên Zalo

## Nhận định then chốt

**Tên tuning key phải TRÙNG tên env var** - `tuning-definitions.ts` ghi rõ "env chính là
giá trị mặc định". Và `min`/`max` phải khớp schema Zod trong `env.ts`: hai nơi lệch nhau
thì hoặc dashboard cho nhập giá trị mà env từ chối, hoặc chặn oan giá trị hợp lệ.

**Cẩn thận ràng buộc chéo.** Đợt trước đã dính: một luật chéo áp cho MỌI lần lưu khiến một
cấu hình sẵn có đã lệch sẽ **khóa cứng cả trang Cấu hình** và không còn đường sửa lại. Mỗi
luật phải khai rõ nó liên quan ô nào, chỉ áp khi ô đó đang đổi.

**Nghiệm thu phải bắt đầu bằng đúng một job `once`.** Đây là tính năng có rủi ro khóa nick
cao nhất dự án từng làm; không bật `every` cho tới khi thấy log sạch một vòng.

## Yêu cầu

- 8 tham số có đủ 4 nơi: Zod trong `env.ts`, `.env.example`, `.env.production.example`,
  `tuning-definitions.ts`
- Nhóm mới `lich-hen` trong `TUNING_GROUPS`
- `docs/system-architecture.md` và `docs/project-roadmap.md` cập nhật theo nếp sẵn có
- README nhắc tính năng mới

## Tham số

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

## File liên quan

**Sửa**: `src/config/env.ts`, `src/config/tuning-definitions.ts`, `.env.example`,
`.env.production.example`, `docs/system-architecture.md`, `docs/project-roadmap.md`,
`README.md`

## Các bước

1. Đối chiếu 8 tham số đã khai ở phase 02 với bảng trên: `min`/`max` giữa Zod và
   `tuning-definitions.ts` phải khớp từng cặp, và có mặt đủ ở cả hai file `.env*.example`.
2. Mở trang Cấu hình kiểm nhóm `lich-hen` hiện đủ 8 ô, sửa được, lưu được, và ô đang lấy
   từ `.env` có nhãn riêng + nút trả về mặc định.
3. `docs/system-architecture.md`: thêm các dòng quyết định kỹ thuật vào bảng - mỗi dòng
   phải có LÝ DO và số đo, đúng văn phong file đó. Ít nhất:
   - Vì sao tool không nhận chuỗi datetime (lệch 7 tiếng, ca của Hermes)
   - Vì sao dùng luxon thay vì tự tính offset (pnpm layout chặt buộc khai trực tiếp)
   - Vì sao `once` trễ vẫn gửi kèm nhãn, khác cả Hermes lẫn goclaw
   - Vì sao không retry ở tầng scheduler (đã có 2 tầng)
   - Vì sao loại `save_memory` khỏi lượt theo lịch
   - Vì sao gom `getDailyUsage` trong JS thay vì `datetime(..., '+7 hours')`
5. `docs/project-roadmap.md`: mục mới cho đợt này, gạch mục "src/scheduler/ - nhắn chủ động
   theo lịch" ở phần "V2 còn lại". Ghi thẳng những gì CHƯA nghiệm thu thật.
6. README: thêm dòng mô tả tính năng ở đầu file.

## Nghiệm thu trên Zalo thật (theo thứ tự, không nhảy bước)

1. Tạo job `message` kiểu `once` sau 3 phút bằng chat. Kỳ vọng: bot xác nhận có nêu mốc
   giờ; đúng 3 phút sau nhận được tin; `agent_turns` **không** tăng (0 token).
2. Nhắn "hủy cái nhắc đó đi" cho một job `once` khác. Kỳ vọng: bot `list` rồi `cancel`,
   job biến khỏi trang Lịch hẹn.
3. Tạo job `agent` kiểu `once` sau 3 phút, prompt cần tra cứu. Kỳ vọng: nhận được tin có
   nội dung; trang Trace có lượt với `source='schedule'`; log mang `turnId`.
4. Kiểm cô lập: job `agent` với prompt "nhắc lại tin nhắn cuối tôi gửi là gì". Kỳ vọng bot
   nói không có ngữ cảnh - đó là bằng chứng phiên cô lập chạy đúng.
5. Kiểm `[SILENT]`: job `agent` với prompt "nếu không có gì mới thì trả lời [SILENT]".
   Kỳ vọng không nhận tin nào, run ghi `silent`.
6. Kiểm giờ: tạo job `cron "0 7 * * *"`, xem mốc kế trên dashboard phải là 07:00 hôm sau
   giờ VN. Đối chiếu `next_run_at` thô trong DB phải là `...T00:00:00.000Z`.
7. Kiểm bot tắt: dừng bot, đợi qua mốc một job `once`, bật lại. Trong grace thì gửi bình
   thường, quá grace thì gửi kèm nhãn "(nhắc trễ...)".
8. Chỉ sau khi 1-7 sạch mới bật một job `every`.

## Todo

- [ ] Đối chiếu `min`/`max` giữa Zod và tuning cho cả 8 tham số
- [ ] Kiểm trang Cấu hình hiện nhóm `lich-hen` đủ 8 ô
- [ ] `docs/system-architecture.md` - 6 dòng quyết định
- [ ] `docs/project-roadmap.md` - mục mới + gạch mục cũ
- [ ] README
- [ ] `pnpm typecheck` + `pnpm test` sạch toàn bộ
- [ ] Trang Cấu hình hiện nhóm mới, sửa được, lưu được
- [ ] Nghiệm thu Zalo thật bước 1-7
- [ ] Bật job `every` đầu tiên

## Tiêu chí hoàn thành

- `pnpm typecheck` và `pnpm test` sạch
- Trang Cấu hình hiện đủ 8 ô, ô nào đang lấy từ `.env` có nhãn riêng và nút trả mặc định
- Đổi `SCHEDULER_MAX_PROACTIVE_PER_DAY` trên web ăn ngay, không cần restart
- `SCHEDULER_ENABLED=false` thì không tick, tool biến khỏi schema, trang Lịch hẹn báo tắt
- Nghiệm thu bước 1-7 đạt, có ghi lại kết quả vào roadmap

## Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Ràng buộc chéo khóa cứng trang Cấu hình | Mỗi luật khai rõ ô liên quan, chỉ áp khi ô đó đang đổi |
| `min`/`max` lệch giữa Zod và tuning | Đối chiếu tay từng cặp; cân nhắc test khẳng định hai bên khớp |
| Nghiệm thu thật gây spam nick | Làm đúng thứ tự 1-7, job `once` trước, `every` sau cùng |
| Tài liệu viết chung chung, mất giá trị | Mỗi dòng trong system-architecture phải có lý do + số đo, đúng văn phong file đó |

## An toàn

`SCHEDULER_ENABLED` là công tắc tắt cả tính năng: tắt thì không tick, không tool, không
route. Có sẵn đường tắt nhanh khi thấy dấu hiệu bất thường từ phía Zalo.

## Tiếp theo

Đợt sau (không thuộc phạm vi): job chạy lệnh có sandbox, chuỗi job nối nhau, cho job nhắm
tới thread khác thread tạo ra nó.
