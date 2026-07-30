# Phase 04 - Tool `schedule_task`

Liên kết: [plan.md](plan.md) - [Thiết kế mục 7](reports/thiet-ke-scheduler.md) -
[Phase 03](phase-03-vong-chay-va-gui-tin.md)

## Tổng quan

- Ưu tiên: cao - đây là chỗ tính năng có giá trị thật với người dùng
- Trạng thái: chưa bắt đầu
- Model tự đặt và tự hủy lịch qua hội thoại

## Nhận định then chốt

**Không nhận chuỗi datetime trong schema.** Nếu tool nhận `"2026-08-01T15:00"` rồi
`new Date(...)`, Node hiểu theo giờ hệ điều hành - VPS đặt UTC là lệch đúng 7 tiếng. Nhận
`{date, time}` rời rồi tự quy đổi bằng `zonedWallClockToUtc`. Đây là chỗ duy nhất chặn
được tận gốc, vì mọi cách viết chuỗi khác của model đều không đổi được ý nghĩa nữa.

**Hủy được bằng chat là yêu cầu, không phải tuỳ chọn.** Đặt được mà không hủy được thì
người dùng phải mở web mỗi lần đổi ý. Mô tả tool chép luật của Hermes: `list` trước để lấy
id, **cấm đoán id**.

**Phạm vi nhìn thấy chỉ trong thread hiện tại.** Hermes không cần luật này vì một người
dùng; zalo-agent đọc tin người lạ nên người ở nhóm khác không được liệt kê hay hủy job của
chủ.

**`schedule_task` phải nằm ngoài lượt theo lịch** - luật số 1 của Hermes: job không được
đẻ job. Đặt `runsInScheduledTurn: false` khi đăng ký.

## Yêu cầu

**Chức năng**
- `create` / `list` / `cancel` / `update`, mọi action giới hạn trong thread hiện tại
- Model chọn được `kind: message | agent` và hiểu khi nào dùng cái nào
- Lỗi trả về dạng chữ đọc được cho model diễn giải, không throw ra agent loop (cùng luật
  với `web_search` và `read_image`)

**Phi chức năng**
- Chỉ người trong allowlist tạo được job
- Trần `SCHEDULER_MAX_JOBS_PER_THREAD` job đang bật mỗi thread
- Luật dùng tool ở `persona-tool-rules.ts`, gate theo tool đang bật (nếp đã có)

## Kiến trúc

```
schedule-task-tool.ts
  |-- create -> kiểm allowlist -> kiểm trần số job -> schedule-parser -> store.create
  |-- list   -> store.listByThread(accountId, threadId)
  |-- cancel -> store.get + kiểm ĐÚNG thread -> store.delete
  +-- update -> store.get + kiểm ĐÚNG thread -> parser (nếu đổi lịch) -> store.update
```

Kiểm `(accountId, threadId)` nằm ở **tầng store**, không chỉ ở tool - đúng nếp "chọn Brave
mà chưa có key bị chặn ngay ở tầng store nên API và mọi caller khác đều dính cùng luật".

## File liên quan

**Tạo**: `src/agent/tools/schedule-task-tool.ts` (+test)

**Sửa**: `src/agent/tools/tool-registry.ts` (đăng ký, `runsInScheduledTurn: false`),
`src/agent/persona-tool-rules.ts` (luật dùng tool)

## Các bước

1. Schema Zod cho tham số. `schedule` là union rời theo `kind`, KHÔNG có trường chuỗi
   datetime nào.
2. Mô tả tool dạy đúng 4 điều:
   - Prompt của job phải **tự chứa** - lúc chạy không còn ngữ cảnh hội thoại này
   - Muốn hủy thì `list` trước lấy id, cấm đoán id
   - Nhắc hẹn đơn thuần dùng `kind='message'`, rẻ hơn nhiều
   - Job chỉ gửi về đúng hội thoại này
   Theo bài học đã ghi ở `create_image`: mô tả tool **chỉ nói điều có lý do chức năng**,
   không kê đơn thẩm mỹ hay ví dụ cụ thể để model chép.
3. Đăng ký vào `TOOL_DEFINITIONS` nhóm `action`, `runsInScheduledTurn: false`.
   `available()` trả theo `SCHEDULER_ENABLED` để tắt tính năng là tool biến khỏi schema.
4. `persona-tool-rules.ts`: khối luật gate bằng tên `schedule_task`. Dặn thêm: sau khi tạo
   xong phải xác nhận lại mốc giờ bằng lời cho người dùng kiểm ("15:00 ngày 01/08"), vì
   đọc lại là cách rẻ nhất để bắt lỗi hiểu sai ý.
5. Test: đủ 4 action, ca người ngoài allowlist bị từ chối, ca `cancel` job của thread khác
   bị từ chối, ca chạm trần số job, ca lịch không hợp lệ trả câu lỗi có chữ.

## Todo

- [ ] Schema + mô tả tool
- [ ] 4 action, kiểm phạm vi thread ở tầng store
- [ ] Đăng ký registry với `runsInScheduledTurn: false`
- [ ] Luật trong `persona-tool-rules.ts`
- [ ] Test 4 action + 4 ca từ chối
- [ ] Test đối chiếu key trong luật với registry (nếp đã có - đổi tên tool mà quên sửa
      luật thì đỏ ngay)
- [ ] `pnpm typecheck` + `pnpm test` sạch

## Tiêu chí hoàn thành

- `create` với `{date:"2026-08-01", time:"15:00"}` lưu `run_at` = `2026-08-01T08:00:00.000Z`
  dưới cả `TZ=UTC` lẫn `TZ=America/New_York`
- `list` từ thread A không thấy job của thread B
- `cancel` job của thread khác trả thông báo từ chối, job vẫn còn nguyên
- Người ngoài allowlist gọi `create` bị từ chối
- Lượt theo lịch không có `schedule_task` trong schema
- Tắt `SCHEDULER_ENABLED` thì tool biến khỏi schema và trang Tools hiện "Chưa dùng được"

## Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Model đặt sai giờ mà người dùng không biết | Persona bắt đọc lại mốc giờ bằng lời để xác nhận |
| Model đoán id rồi hủy nhầm job | Mô tả tool cấm đoán id; store chỉ cho hủy job đúng thread nên phạm vi thiệt hại nhỏ |
| Prompt injection dụ model đặt job spam | Trần số job/thread + ngưỡng lịch tối thiểu ở parser + trần tin/ngày. Ba lớp, lớp nào cũng chặn được một mình |
| Mô tả tool phình làm tốn token mỗi lượt | Gate qua `persona-tool-rules` như các tool khác - tắt tool là chữ luật biến mất |

## An toàn

Đây là bề mặt tấn công lớn nhất của cả đợt: một tin nhắn khéo có thể tạo ra tác vụ chạy
lặp lại không ai để ý. Bốn lớp chặn: chỉ allowlist tạo được, job ghim cứng vào thread tạo
ra nó (không có tham số đích), trần số job mỗi thread, và ngưỡng lịch tối thiểu ở parser.

## Tiếp theo

Phase 05 dựng trang Lịch hẹn để nhìn thấy và sửa job không qua chat.
