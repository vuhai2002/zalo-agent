# Thiết kế: Lịch hẹn - bot nhắn chủ động theo lịch

Ngày: 2026-07-31. Trạng thái: chờ duyệt, chưa viết code.

Nguồn tham khảo đã đọc source: `hermes-agent/cron/` (scheduler.py 4298 dòng, jobs.py,
executions.py, lifecycle_guard.py, tools/cronjob_tools.py) và `goclaw/internal/cron/`
(service.go, service_execution.go, types.go, retry.go) + `docs/08-scheduling-cron.md`.

## Quyết định đã chốt với người dùng

| Câu hỏi | Chốt |
|---|---|
| Loại job | Cả hai: `message` (0 token) + `agent` (chạy LLM có tool) |
| Ai tạo được | Tool cho LLM + trang dashboard |
| Kiểu lịch | `once` / `every` / `cron`, dùng `cron-parser` |
| Sentinel `[SILENT]` | Có |
| Giờ im lặng | **Không làm** |
| Trần tin chủ động | Có, 10/thread/ngày |
| Rải đều toàn cục | Có |

---

## 1. Hai loại job

| | `message` | `agent` |
|---|---|---|
| Nội dung | Text cố định, gửi nguyên văn | Prompt tự chứa |
| Chi phí | 0 token, không chạm LLM | Một lượt agent có tool |
| Dùng cho | "nhắc tôi 3h chiều họp anh Nam" | "mỗi sáng 7h tóm tắt tin công nghệ" |
| `[SILENT]` | Không áp dụng | Có |

Mô tả tool dạy model chọn đúng loại: nhắc hẹn đơn thuần thì `message`, đừng đốt một
lượt agent chỉ để đọc lại đúng câu người ta vừa gõ.

## 2. Luật giờ - phần dễ sai nhất

### Bất biến sẵn có của codebase (phải giữ)

Mọi cột thời gian trong DB lưu **UTC có hậu tố `Z`**: `strftime('%Y-%m-%dT%H:%M:%fZ','now')`
của SQLite và `toISOString()` của JS đều là UTC. `BOT_TIMEZONE` (`Asia/Ho_Chi_Minh`) hiện
CHỈ dùng để **hiển thị** - dòng ngày trong system prompt (`persona-prompt.ts:57`) và tool
`get_datetime` (`get-datetime-tool.ts:17`). Nó chưa bao giờ chạm tới lưu trữ.

Scheduler giữ nguyên: **lưu UTC, hiểu và hiện theo `BOT_TIMEZONE`**. Tuyệt đối không lưu
giờ tường (wall clock) thiếu zone vào DB.

### Năm chỗ có thể nhầm UTC/VN và cách chặn từng chỗ

**(1) LLM đưa mốc giờ - nguy hiểm nhất, lệch đúng 7 tiếng**

Nếu tool nhận chuỗi `"2026-08-01T15:00"` (không zone) rồi `new Date(...)`, Node hiểu theo
giờ **hệ điều hành**. Trên VPS đặt UTC thì "3h chiều" thành 22:00 giờ VN. Hermes dính đúng
ca này (ghi trong `jobs.py`, issue #51021) và phải vá bằng cách neo timestamp naive vào
timezone cấu hình thay vì timezone máy chủ.

Chặn tận gốc: **schema tool KHÔNG nhận chuỗi datetime.** Nhận thành phần rời, luôn hiểu
theo `BOT_TIMEZONE`:

```ts
{ kind: "once", date: "2026-08-01", time: "15:00" }   // giờ địa phương, tường minh
{ kind: "once", inMinutes: 30 }                        // tương đối, không dính zone
{ kind: "every", minutes: 120 }
{ kind: "cron", expr: "0 7 * * *" }
```

Code tự quy đổi: `DateTime.fromISO("2026-08-01T15:00", { zone: tz }).toUTC().toISO()`.
Không còn đường nào để cách LLM viết chuỗi làm đổi ý nghĩa.

**(2) Cron expression**

`0 7 * * *` phải là 7h **VN**. `cron-parser` mặc định theo giờ hệ thống nên **bắt buộc
truyền `tz: BOT_TIMEZONE`**. Test hồi quy chạy với `TZ=UTC`: mốc kế của `0 7 * * *` phải
ra `...T00:00:00Z` (= 07:00+07), không phải `...T07:00:00Z`.

**(3) "Mỗi ngày" của trần tin**

`SCHEDULER_MAX_PROACTIVE_PER_DAY` đếm theo **ngày VN**, không phải ngày UTC. Mốc 00:00 VN
= 17:00Z hôm trước. Tính bằng `DateTime.now().setZone(tz).startOf("day").toUTC()` rồi so
với cột UTC. KHÔNG được copy pattern của `overview-stats.ts` (xem mục 11).

**(4) Hiển thị trên dashboard**

Web đang dùng `toLocaleTimeString("vi-VN")` **không truyền `timeZone`** (`logs-page.tsx:28`)
nên lấy zone của trình duyệt. Với máy ở VN thì đúng do trùng, nhưng "job chạy 7h sáng" là
7h sáng **của bot** chứ không phải của người đang xem. Trang Lịch hẹn pin
`timeZone: BOT_TIMEZONE` (API trả kèm tên zone để web không hardcode).

**(5) `every N phút`**

Thuần số học khoảng thời gian, không dính zone. An toàn - đây là lý do `every` không cần
luật gì thêm.

### Test bắt buộc

Test của `schedule-parser` và `next-run` chạy với `process.env.TZ = "UTC"` **và**
`TZ = "America/New_York"`, phải ra cùng kết quả. Máy dev ở VN mà test theo giờ máy thì
lớp bug này không bao giờ lộ - đúng loại "test xanh một cách vô nghĩa" mà dự án đã dính
một lần ở `read-zip-entry`.

### Vì sao dùng luxon thay vì tự tính offset

`cron-parser@5.6.2` phụ thuộc `luxon@^3.7.2`, tức luxon vào cây dependency dù muốn hay
không. Nhưng **pnpm layout chặt không cho import dependency gián tiếp** (dự án đã dính
đúng lỗi này khi thử import `@ai-sdk/provider` để lấy kiểu, ghi ở roadmap 2026-07-29),
nên phải khai `luxon` là dependency TRỰC TIẾP mới dùng được.

Đổi lại được: mọi phép quy đổi giờ tường VN sang mốc UTC đi qua thư viện đã kiểm chứng
thay vì tự cộng trừ offset. VN không có DST nên tự tính "trông có vẻ dễ", nhưng
`BOT_TIMEZONE` là cấu hình - đặt `Europe/Paris` là gặp DST ngay. Tự viết offset math ở
đúng chỗ vừa được cảnh báo là ngược hướng.

Thêm: `cron-parser` ^5.6.2, `luxon` ^3.7.2 (dependencies), `@types/luxon` ^3.7.2
(devDependency - luxon không ship type riêng). Lưu ý `minimumReleaseAge: 1440` trong
`pnpm-workspace.yaml`: bản phát hành chưa đủ 24h sẽ bị chặn.

## 3. Dữ liệu - 2 bảng mới trong `database.ts`

**`scheduled_jobs`** - trạng thái HIỆN TẠI:

| Cột | Ghi chú |
|---|---|
| `id` | hex 12 ký tự |
| `account_id`, `thread_id`, `thread_type` | đích gửi, ghim cứng lúc tạo |
| `name` | nhãn hiển thị |
| `kind` | `message` \| `agent` |
| `payload` | text gửi (message) hoặc prompt (agent) |
| `schedule_kind` | `once` \| `every` \| `cron` |
| `run_at` | ISO **UTC**, cho `once` |
| `every_minutes` | cho `every` |
| `cron_expr` | cho `cron` |
| `timezone` | rỗng = theo `BOT_TIMEZONE` lúc chạy |
| `enabled`, `next_run_at`, `last_run_at`, `last_status`, `last_error` | `next_run_at` ISO UTC |
| `run_count`, `max_runs` | `max_runs` NULL = vô hạn; `once` mặc định 1 |
| `created_by` | senderId người tạo, để audit |
| `created_at`, `updated_at` | |

Index `(enabled, next_run_at)` cho truy vấn due; `(account_id, thread_id)` cho tool `list`.

**`scheduled_job_runs`** - sổ ghi ĐÃ XẢY RA GÌ:
`id`, `job_id`, `turn_id` (link `agent_turns`), `status`
(`running|ok|silent|skipped|error|interrupted`), `detail`, `delivered_chars`,
`started_at`, `finished_at`. Index `(job_id, id DESC)`.

Vì sao tách hai bảng (lý do của Hermes trong `executions.py`): cột `last_status` trên job
chỉ nói lần cuối. Job hỏng 5 lần rồi lần 6 chạy được sẽ trông khoẻ mạnh hoàn hảo. Và
`turn_id` khiến một job agent chạy sai bấm một phát sang thẳng trang Trace - tận dụng đúng
thứ dự án đã đầu tư nhiều nhất. Dọn theo `SCHEDULER_RUN_LOG_KEEP` mỗi job.

Khác Hermes có chủ đích: **không có cột `process_id`/`pid`/`process_started_at`.** Hermes
cần chúng vì gateway và CLI là hai tiến trình tranh nhau cùng một `jobs.json`; zalo-agent
là MỘT process với `node:sqlite` đồng bộ. Bê nguyên là gánh phần phức tạp của bài toán
không tồn tại.

`agent_turns` thêm cột `source` (`message` | `schedule`, ALTER mặc định `'message'`).

## 4. Ngữ nghĩa lịch

`schedule-parser.ts` (thuần, không DB không env) chuẩn hoá + validate.
`next-run.ts` (thuần) tính mốc kế.

### Chặn ngay lúc TẠO, không đợi tới lúc gửi

- `every` nhỏ hơn `SCHEDULER_MIN_INTERVAL_MINUTES` (5) thì từ chối. `every 1m` = 1440
  tin/ngày; chặn ở nguồn rẻ hơn chặn ở trần.
- `cron`: validate bằng cron-parser, rồi **tính 2 mốc kế tiếp**, khoảng cách dưới ngưỡng
  thì từ chối. `* * * * *` phải chết ở đây.
- `once` đã quá hạn quá xa: từ chối kèm câu giải thích (Hermes ném `ValueError` y vậy).

### Chống trôi lịch (goclaw)

Job `every` tính mốc sau từ **thời điểm ĐÃ ĐỊNH**, không phải từ `now`:
`next = scheduled + (elapsed / interval + 1) * interval`. Không có phép này thì mỗi lượt
trễ vài giây, chạy vài tuần là 7h sáng thành 7h20.

### Bot tắt rồi bật lại

| Tình huống | Xử lý |
|---|---|
| `every`/`cron` trễ trong grace | Chạy bù **một lần** rồi fast-forward tới mốc tương lai. Không bắn dồn backlog |
| `every`/`cron` trễ quá grace | Bỏ lượt, ghi run `skipped`, fast-forward |
| `once` trễ trong grace (10 phút) | Gửi bình thường |
| `once` trễ quá grace | **Vẫn gửi, kèm tiền tố "(nhắc trễ, lịch gốc 15:00)"** |

Grace của recurring = nửa chu kỳ, kẹp `[2 phút, 2 giờ]` (công thức
`_compute_grace_seconds` của Hermes).

### Job chạy hết lượt thì thành gì

Chạm `max_runs` (hoặc `once` chạy xong): đặt `enabled = 0`, `next_run_at = NULL`, **giữ
nguyên row**. Hermes xoá hẳn job khỏi `jobs.json`, goclaw xoá khi `deleteAfterRun` - cả
hai đều làm lời nhắc biến mất không dấu vết. Giữ row thì trang Lịch hẹn còn hiện "đã nhắc
xong lúc ..." và lịch sử chạy vẫn tra được; dọn cùng nhịp `SCHEDULER_RUN_LOG_KEEP`.

Ô cuối cố ý khác cả hai repo: Hermes vứt luôn one-shot quá hạn
(`_recoverable_oneshot_run_at` trả None), goclaw tắt job. Với bot cá nhân, nhắc hẹn bị
nuốt im lặng là kết cục tệ nhất - user đã hẹn thì phải biết nó đã xảy ra, kể cả biết muộn.

## 5. Vòng tick

`setInterval` mỗi `SCHEDULER_TICK_MS` (30s), `.unref()`. Mỗi tick:

1. `SELECT WHERE enabled = 1 AND next_run_at <= now`
2. Với mỗi job: **ghi `next_run_at` mới NGAY, trước khi dispatch** (mẹo
   clear-before-dispatch của goclaw `checkJobs`). Một process nên chỉ cần thế.
3. Dispatch qua **`runOnThreadChain(threadKey, ...)`** tách ra từ `message-batcher` - job
   và tin người dùng cùng thread không bao giờ chồng nhau.
4. **Không await trong tick**: một job chạy 3 phút không được chặn tick kế. Đúng bài
   goclaw học được khi `wg.Wait()` làm đứng cả scheduler.

Lúc boot: run còn `running` thành `interrupted` (một process - mọi row `running` lúc khởi
động đều là đứt, không cần chứng minh pid như Hermes), job `next_run_at` quá hạn thì tính lại.

## 6. Lượt agent theo lịch khác lượt tin nhắn ở đâu

| | Lượt tin nhắn | Lượt theo lịch |
|---|---|---|
| History vào input | Có | **Không** (phiên cô lập) |
| Memory + summary | Có | **Không** |
| Persona | Có | **Có** |
| Trace + token | Có | **Có** |
| Câu bot gửi ra ghi history | Có | **Có** |
| Lỗi thì nhắn "trục trặc kỹ thuật" | Có | **Không** |

Hai dòng cuối là cặp quan trọng nhất:

- **Vào input thì cô lập, ra output thì ghi history.** Không ghi thì user trả lời "ok làm
  rồi" mà bot không biết đang nói chuyện gì. Đây đúng là cặp `phiên cô lập +
  attach_to_session` của Hermes; khác ở chỗ với Zalo thì `attach` bật mặc định (Hermes tắt
  mặc định vì cron của họ hay broadcast ra kênh chung, còn ở đây job luôn thuộc về đúng
  một cuộc trò chuyện).
- **Job lỗi thì im** (luật goclaw: chỉ output thành công mới deliver). Ở lượt tin nhắn có
  người đang ngồi chờ nên phải báo; ở đây không ai chờ, nhắn "trục trặc kỹ thuật" lúc 7h
  sáng chỉ là spam. Nhưng phải THẤY được: dashboard hiện badge đỏ + `last_error`.

`runAgentTurn` thêm `isolated?: boolean` (mặc định false) - bỏ qua `getRecentMessages` +
memory + summary. Rẻ hơn tách hàm riêng; agent-loop đang 409 dòng.

### Tool bị loại khỏi lượt theo lịch

`ToolDefinition` thêm `runsInScheduledTurn?: boolean` (mặc định true):

| Tool | Vì sao loại |
|---|---|
| `schedule_task` | Luật số 1 của Hermes: job không được đẻ job |
| `add_reaction` | Không có `msgId` thật để thả vào |
| `read_image` | Lượt này không có ảnh |
| `save_memory` | Job đọc web rồi ghi memory vĩnh viễn = injection có đường vào trí nhớ dài hạn. Mà lượt theo lịch vốn không có phát ngôn nào của user để mà học |

### Prompt của lượt theo lịch

Chưng cất `cron_hint` của Hermes:

```
[Đây là lượt CHẠY THEO LỊCH, không phải người dùng vừa nhắn.
GỬI: câu trả lời cuối của bạn được gửi thẳng cho người dùng - không cần gọi
tool gửi tin, cứ viết ra là xong.
IM LẶNG: nếu thật sự không có gì mới để báo, trả lời đúng [SILENT] và không
gì khác. Tuyệt đối không vừa [SILENT] vừa kèm nội dung.
KHÔNG HỎI LẠI: không có ai đang ngồi chờ để trả lời câu hỏi của bạn.]

<payload của job>
```

## 7. Tool `schedule_task`

`action: create | list | cancel | update`.

Mô tả tool dạy đúng 4 điều (chưng cất từ `cronjob_tools.py`):

1. Prompt phải **tự chứa** - lúc chạy không còn ngữ cảnh hội thoại này
2. Muốn hủy thì `list` trước để lấy id, **cấm đoán id** (câu này Hermes ghi hẳn vào mô tả)
3. Nhắc hẹn đơn thuần dùng `kind='message'` - rẻ hơn nhiều
4. Job chỉ gửi về đúng hội thoại này, không đặt được đích khác

Luồng hủy bằng chat:

```
User: nhắc tôi 3h chiều mai họp với anh Nam
Bot:  [create] -> "Ok, 15:00 mai mình nhắc anh nhé."
User: thôi hủy cái nhắc đó đi
Bot:  [list] -> thấy job -> [cancel] -> "Đã hủy nhắc họp 15:00 mai."
```

### Bảo mật (phần Hermes không cần vì họ một người dùng)

- `list`/`cancel`/`update` **chỉ thấy job của đúng `(accountId, threadId)` hiện tại.**
  Người ở nhóm khác hay người lạ nhắn DM không liệt kê được, không hủy được job của chủ.
- Chỉ người trong allowlist tạo được job (dùng lại `senderTrust` đã có).
- Trần `SCHEDULER_MAX_JOBS_PER_THREAD` (20) job đang bật mỗi thread.

## 8. Guardrail lúc gửi (`proactive-send-guard.ts`)

Kiểm theo thứ tự trước mỗi lần gửi chủ động: account đang chạy -> thread còn trong bảng
`threads` và `bot_enabled = 1` -> chưa chạm trần ngày. Hỏng bất kỳ điều nào thì ghi run
`skipped` kèm lý do, không gửi.

- **Trần 10 tin/thread/ngày (VN)**, chỉ đếm tin scheduler tự bắn, không đếm tin trả lời.
  Chạm trần thì bỏ lượt + nhắn **một** câu cho biết job nào bị chặn - im luôn thì user
  không hiểu vì sao job chết.
- **Rải đều toàn cục**: hàng đợi chung, các tin chủ động cách nhau `SCHEDULER_SEND_GAP_MS`
  (20s). Khác `rate-limiter` hiện tại vốn chỉ xếp hàng TRONG một thread.
- **`[SILENT]`**: lấy nguyên cơ chế `_is_cron_silence_response` của Hermes - nhận khi
  sentinel là toàn bộ câu trả lời, hoặc đứng riêng ở dòng đầu / dòng cuối, nhưng nằm GIỮA
  câu thì vẫn gửi ("mình định [SILENT] nhưng đây là tóm tắt..." phải tới nơi).

Không retry ở tầng scheduler: agent-loop đã có retry glitch router + `maxRetries: 2` của
SDK. Thêm tầng thứ ba là ba tầng chồng nhau, một job hỏng có thể nhân lên 6 lần gọi
provider. Job lỗi thì ghi run `error`, đợi lượt sau theo lịch.

## 9. Dashboard

Trang mới **Lịch hẹn**: danh sách job theo account, badge kiểu lịch + lần chạy kế +
trạng thái lần cuối, bật/tắt, **Chạy thử ngay**, Xóa (dùng `confirm-dialog` đã có), drawer
lịch sử chạy có link sang Trace cho job `agent`.

Mọi mốc giờ hiển thị pin `timeZone` theo `BOT_TIMEZONE` do API trả về.

## 10. Tham số mới

Nhóm mới `lich-hen` trong `TUNING_GROUPS`. Mỗi tham số phải có đủ 4 nơi: schema Zod trong
`env.ts`, `.env.example`, `.env.production.example`, `tuning-definitions.ts` (tên key
TRÙNG tên env var, `min`/`max` khớp Zod).

| Key | Mặc định |
|---|---|
| `SCHEDULER_ENABLED` | true |
| `SCHEDULER_TICK_MS` | 30000 |
| `SCHEDULER_MIN_INTERVAL_MINUTES` | 5 |
| `SCHEDULER_MAX_JOBS_PER_THREAD` | 20 |
| `SCHEDULER_MAX_PROACTIVE_PER_DAY` | 10 |
| `SCHEDULER_SEND_GAP_MS` | 20000 |
| `SCHEDULER_ONCE_GRACE_MINUTES` | 10 |
| `SCHEDULER_RUN_LOG_KEEP` | 50 |

## 11. Vá "hôm nay" đang tính theo ngày UTC (đã chốt: gộp vào đợt này)

Phát hiện khi rà timezone. Ba chỗ, cùng một gốc bệnh, phải sửa CÙNG LÚC - sửa lẻ một chỗ
làm hỏng chỗ khác.

**(a) `server/overview-stats.ts:14-17` - "Tin hôm nay"**

```sql
WHERE created_at >= strftime('%Y-%m-%dT00:00:00Z', 'now')
```

`strftime(...,'now')` là giờ UTC, nên mốc là 00:00 UTC của ngày UTC hiện tại = **07:00 giờ
VN**. Lệch cả hai chiều tuỳ giờ xem:

- 10:00 VN ngày 31/07 (03:00Z 31/07): mốc = `2026-07-31T00:00:00Z` = 07:00 VN hôm nay
  -> **mất toàn bộ tin từ 00:00 tới 07:00 sáng nay**.
- 03:00 VN ngày 31/07 (20:00Z 30/07): mốc = `2026-07-30T00:00:00Z` = 07:00 VN hôm qua
  -> **"hôm nay" gồm cả 20 tiếng của hôm qua**.

Sửa: bỏ `strftime` khỏi câu SQL, truyền tham số mốc đầu ngày VN quy về UTC
(`startOfDayUtc(tz)`). Đúng cả với zone có DST vì luxon tính offset tại đúng thời điểm đó.

**(b) `conversation/usage-store.ts:59-69` - `getDailyUsage` gom theo ngày UTC**

`substr(created_at, 1, 10)` cắt phần ngày của chuỗi UTC. Comment có ghi rõ "theo ngày
(UTC)" nên không phải bug ẩn, nhưng biểu đồ 7 ngày trên Overview đang lệch 7 tiếng so với
ngày VN. Người dùng đã chốt sửa sang ngày VN.

Cách sửa: **gom trong JS thay vì trong SQL.** Câu SQL giữ mệnh đề `created_at >= ?` (vẫn
chặn phạm vi quét), trả về từng dòng rồi `dayKeyOf(created_at, tz)` để gom. Không dùng
`datetime(created_at, '+7 hours')` vì offset cứng sai ở zone có DST, mà quy ước của repo
là `BOT_TIMEZONE` cấu hình được. Chi phí chấp nhận được: đo trên DB thật có **67 dòng**
`agent_turns` tổng cộng (179 `messages`) - cửa sổ 7 ngày luôn là vài chục dòng.

**(c) `web/src/pages/overview-page.tsx:56` - frontend cũng tự tính ngày UTC**

```ts
const today = new Date().toISOString().slice(0, 10);
const todayUsage = dailyByDay.get(today);
```

Hiện hai bên cùng sai theo cùng một kiểu nên tra khớp nhau một cách tình cờ. **Sửa backend
mà bỏ chỗ này là hỏng thật**: từ 00:00 tới 07:00 giờ VN, key ngày VN không khớp key ngày
UTC nên hai ô "Lượt hôm nay" và "Token hôm nay" hiện 0.

Sửa: `/api/overview` trả thêm `todayKey` và `timezone`, frontend dùng nguyên chứ không tự
tính. Trình duyệt không cần biết `BOT_TIMEZONE` - cùng nguyên tắc đã áp cho danh sách icon
reaction (server cấp để frontend không lệch).

**Điểm chung với scheduler**: cả trần tin `SCHEDULER_MAX_PROACTIVE_PER_DAY` lẫn ba chỗ
trên đều hỏi cùng một câu "đầu ngày VN là mốc UTC nào". Vì thế `zone-time.ts` để ở
`src/shared/` chứ không phải `src/scheduler/` - đúng bài học `stripHtmlTags` đã rút
(module dùng chung phải ở đúng nhà, không để chỗ này đi mượn hàm của chỗ kia).

## 12. Danh sách file

**Mới** (đều dưới 200 dòng):

```
src/shared/zone-time.ts                 quy đổi giờ tường <-> UTC qua luxon, mốc đầu ngày VN
src/scheduler/schedule-parser.ts        chuỗi/đối tượng lịch -> ParsedSchedule + validate
src/scheduler/next-run.ts               mốc chạy kế + grace + fast-forward (thuần)
src/scheduler/scheduled-job-store.ts    CRUD bảng scheduled_jobs
src/scheduler/job-run-log-store.ts      bảng scheduled_job_runs + dọn theo KEEP
src/scheduler/scheduler-loop.ts         tick, gom due, ghi next_run, dispatch
src/scheduler/run-scheduled-job.ts      một lần chạy: prompt -> agent -> [SILENT]? -> gửi
src/scheduler/proactive-send-guard.ts   trần ngày, rải đều, kiểm thread
src/agent/tools/schedule-task-tool.ts   tool cho LLM
src/server/routes/schedule-routes.ts    API dashboard
web/src/pages/schedule-page.tsx         trang Lịch hẹn
```

**Sửa cho scheduler**: `conversation/database.ts` (2 bảng + cột `source`),
`middleware/message-batcher.ts` (export `runOnThreadChain`), `agent/agent-loop.ts`
(`isolated`), `agent/tools/tool-registry.ts` (`runsInScheduledTurn` + đăng ký tool),
`agent/persona-tool-rules.ts`, `config/tuning-definitions.ts`, `config/env.ts`,
`index.ts` (start/stop scheduler), `conversation/usage-store.ts` (cột `source`),
web sidebar-nav + app + dashboard-api-client, `.env.example`, `.env.production.example`,
`package.json`.

**Sửa cho mục 11 (ngày VN)**: `server/overview-stats.ts`, `conversation/usage-store.ts`
(`getDailyUsage`), `server/routes/overview-routes.ts` (trả `todayKey` + `timezone`),
`web/src/pages/overview-page.tsx`, `web/src/dashboard-api-client.ts`.

## 13. Ba chỗ cố ý khác repo tham khảo

1. **`once` trễ quá grace vẫn gửi kèm nhãn "(nhắc trễ)"** - Hermes vứt luôn. Nuốt im lặng
   một lời nhắc là kết cục tệ nhất cho bot cá nhân.
2. **Không retry ở tầng scheduler** - agent-loop đã có hai tầng retry, thêm nữa là ba tầng
   chồng nhau.
3. **Loại `save_memory` khỏi lượt theo lịch** - không repo nào làm, nhưng đường nội dung
   web đi vào trí nhớ vĩnh viễn là prompt injection thật, và lượt theo lịch không có phát
   ngôn nào của user để mà học.

## Câu hỏi còn treo

Không còn. Mục 11 đã chốt gộp vào đợt này, gồm cả `getDailyUsage` đổi sang ngày VN.
