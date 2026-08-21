# Phase 02 - Scheduler gửi qua `KenhLuot`

Ưu tiên: cao. Phụ thuộc: phase 01. Trạng thái: [x] xong.
Bối cảnh: [reports/nguyen-nhan-goc.md](reports/nguyen-nhan-goc.md) mục 2 và 4.

## Vấn đề

Hai chỗ dựng `ReplyTarget` bằng `duongGuiZcaJs` cứng:

- `run-scheduled-job.ts:132` - đường gửi CHÍNH.
- `scheduled-job-cap-guard.ts:83` (`toTarget`) - đường gửi THÔNG BÁO CHẠM TRẦN
  NGÀY. Hỏng câm: bot chạm trần thì không ai được báo.

Và `runAgentJob` nhận `api: API` (không nullable) rồi truyền vào `runAgentTurn`.

## Cách làm

Gom việc dựng `ReplyTarget` cho job vào MỘT nhà máy - ba chỗ tự viết là ba cơ
hội quên một trường (đúng lý lẽ `duongGuiZcaJs` đã ghi trong docstring của nó).

### File mới

`src/scheduler/scheduled-job-reply-target.ts`

```ts
/** ReplyTarget cho 1 job, theo ĐÚNG kênh của account. undefined = account không chạy. */
export function taoReplyTargetChoJob(job: ScheduledJob): ReplyTarget | undefined
```

Đọc `getRunningAccountKenh(job.accountId)`; không có thì trả `undefined`. Có
thì trả `{ guiMotDoan: kenh.duongGui(job.threadId, job.threadType as ThreadType),
tranKyTuMotTin: kenh.tranKyTuMotTin, threadKey, threadId, threadType }`.

KHÔNG đặt `quote` - job theo lịch không trả lời tin nào (luật đã ghi sẵn trong
docstring `ReplyTarget.quote`).

### Files sửa

| File | Việc |
|---|---|
| `src/scheduler/run-scheduled-job.ts` | Bỏ nhánh `account?.loai === "bot"`; dùng `taoReplyTargetChoJob`; `runAgentJob` nhận `api: API \| null` |
| `src/scheduler/scheduled-job-cap-guard.ts` | `toTarget` dùng `taoReplyTargetChoJob` |

### Chi tiết `run-scheduled-job.ts`

```ts
const account = getAccount(job.accountId);
const target = taoReplyTargetChoJob(job);
if (!account || !target) {
  concludeBlockedNotRun(job, runId, ACCOUNT_NOT_RUNNING_REASON, options.scheduledFor);
  return;
}
```

Nhánh `tatJobKhongCanPhamVi` biến mất - nó tồn tại CHỈ vì bot không có đường
gửi. Giờ có rồi thì tài khoản bot đi chung đúng một đường với cá nhân: đang
chạy thì gửi, không chạy thì `concludeBlockedNotRun` (giữ suất, phục hồi
`next_run_at`, thử lại tick sau). Đây là hành vi ĐÚNG - và nó cũng chính là
lý do phase 04 phải nằm SAU phase này.

`runAgentJob` truyền `api: kenh.api` (có thể `null`) xuống `runAgentTurn`.
`AgentTurnParams.api` đã khai `API | null` (`agent-loop.ts:85`) nên không phải
đụng agent-loop. Lấy `api` từ đâu: thêm `kenh` vào giá trị trả về của
`taoReplyTargetChoJob`, hoặc `runAgentJob` tự gọi `getRunningAccountKenh` một
lần nữa. Chọn cách MỘT (trả `{ target, kenh }`) - hai lời gọi là hai cơ hội
đọc trúng hai trạng thái khác nhau nếu account bị dừng xen giữa.

### Bất biến phải giữ nguyên

- `options.now` vẫn là tham số BẮT BUỘC, không thêm `= new Date()` ở đâu.
- Thứ tự `blockedByGuard` -> `sendAndConclude` không đổi.
- `lamSachTheoCauHinh` chạy trước khi gửi, nhánh `chan` KHÔNG lùi về bản thô.

## Tests

File mới: `src/scheduler/lich-hen-kenh-bot.test.ts`

Khuôn: y hệt `run-scheduled-job.test.ts` (DB thật, account-manager thật, chỉ
giả đường ra mạng + model). Account bot "online" bằng `startAccount` với
`tiemClientRunnerChoTest`.

| # | Ca | Khẳng định |
|---|---|---|
| 1 | job `message` trên bot | `client.sendMessage` nhận đúng payload; run = `ok`; history có dòng `assistant` đúng chữ đã gửi |
| 2 | trần ký tự của KÊNH thắng trần chung | đặt `ZALO_MAX_MESSAGE_CHARS=4000`, payload 2500 ký tự -> **2** tin, tin đầu <= 2000. Chứng minh `tranKyTuMotTin` được truyền qua |
| 3 | job `agent` trên bot | model giả trả chữ; `runAgentTurn` chạy với `api: null` không ném; chữ ra `client.sendMessage`; `agent_turns` có dòng usage |
| 4 | bộ tool lượt theo lịch trên bot | `listAvailableTools({account bot, agent}, {isolated:true})` ra ĐÚNG 4 key: `get_datetime`, `web_search`, `web_fetch`, `kb_search`. Khẳng định RIÊNG `schedule_task` vắng mặt (job không đẻ job) và `get_group_info` vắng mặt (bot chặn) |
| 5 | account bot ĐANG TẮT | `concludeBlockedNotRun`: run = `skipped`, `next_run_at` phục hồi ĐÚNG `scheduledFor`, `enabled` VẪN true. Đây là ca chứng minh nhánh `tatJobKhongCanPhamVi` đã đi đúng chỗ chứ không bị bỏ quên |
| 6 | trần tin chủ động vẫn đếm trên bot | gửi tới `SCHEDULER_MAX_PROACTIVE_PER_DAY` rồi lượt kế bị chặn; bảng `proactive_send_counters` cộng đúng |
| 7 | thông báo chạm trần GỬI ĐƯỢC trên bot | `concludeCapBlockedAtTick` với `notifyCapHitOnce` -> `client.sendMessage` nhận câu báo trần. Đây là lỗ câm ở mục 4 báo cáo gốc |
| 8 | job `every` trên bot | chạy xong vẫn `enabled: true` và có `nextRunAt` mới - KHÔNG bị tắt như hành vi cũ |

Hồi quy kênh cá nhân (bổ sung vào `run-scheduled-job.test.ts`):

| # | Ca | Khẳng định |
|---|---|---|
| 9 | job trên kênh cá nhân vẫn nhận `styles` | payload có `**đậm**` -> `api.sendMessage` nhận `styles` khác rỗng (chốt chống "sửa cho bot làm hỏng kênh đang chạy") |

### Phép phá bắt buộc

| Phá gì | Ca phải ĐỎ |
|---|---|
| `taoReplyTargetChoJob` luôn dùng `duongGuiZcaJs` | 1, 3, 7 |
| Bỏ `tranKyTuMotTin` khỏi target | 2 |
| `runAgentJob` ném khi `api === null` | 3 |
| Khôi phục nhánh `tatJobKhongCanPhamVi` cho bot | 5, 8 |
| `toTarget` của cap-guard giữ nguyên bản cũ | 7 |
| Bỏ `styles` cho MỌI kênh | 9 |

## Tiêu chí xong

- 9 ca xanh, 6 phép phá đỏ đúng ca.
- `run-scheduled-job.test.ts`, `scheduled-job-send.test.ts`,
  `run-scheduled-job-trial.test.ts`, `scheduler-loop.test.ts` xanh nguyên.
- `chan-lich-hen-kenh-bot.test.ts` sẽ ĐỎ ở đây (nó khẳng định hành vi cũ) -
  ĐÚNG dự kiến, phase 04 viết lại nó. Ghi rõ trong commit để không ai tưởng là
  hồi quy.
- `run-scheduled-job.ts` vẫn dưới 200 dòng sau khi bỏ nhánh bot (hiện ~298 -
  bỏ nhánh này giảm ~20 dòng, vẫn vượt; ghi vào phase 05 chứ không tách vội).

## Rủi ro

- Bỏ nhánh `loai === "bot"` mà chưa có đường gửi = mở đúng vòng dispatch vô
  hạn. Phase 01 phải xong TRƯỚC, và ca 5 là chốt chặn cho điều đó.
- `scheduled-job-cap-guard.ts` bị gọi KHÔNG AWAIT từ tick - hàm mới tuyệt đối
  không được ném. `taoReplyTargetChoJob` chỉ đọc map + dựng object, không I/O.
