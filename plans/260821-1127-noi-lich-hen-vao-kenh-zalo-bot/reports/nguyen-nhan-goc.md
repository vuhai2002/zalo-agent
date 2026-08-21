# Nguyên nhân gốc: vì sao lịch hẹn không chạy trên kênh Zalo Bot

Ngày điều tra: 2026-08-21. Mọi khẳng định dưới đây lấy từ đọc code, không suy
từ tài liệu.

## 1. Nền tảng KHÔNG chặn

| Bằng chứng | Ở đâu |
|---|---|
| Bot API gửi được 10 tin trong 416ms, không bị rate-limit | `docs/project-roadmap.md:4312` (số đo thật) |
| `sendMessage` là CÙNG method bot đang dùng để trả lời tin thường | `zalo-bot-api-client.ts:185` |
| `kenhBot.duongGui` đã chạy sản xuất mỗi ngày | `kenh-bot.ts:29` |
| Không có method riêng cho "nhắn chủ động" - không có gì để thiếu | dò 17 method, `docs/project-roadmap.md:4318` |

So sánh 8 dòng trong `TOOL_KHONG_CHAY_TREN_BOT` (`nang-luc-kenh-bot.ts:27`):
7 dòng đều dẫn được một số đo 404 hoặc ràng buộc cứng. Riêng `schedule_task`
ghi "chưa nối vào bộ hẹn lịch" - tức *chưa làm*, không phải *không làm được*.

Ràng buộc thật duy nhất: bot chỉ nhắn được `chat_id` nó đã thấy (người đó phải
nhắn trước). Đã tự được phủ - `checkAccountAndThreadReady`
(`proactive-send-guard.ts:54`) vốn bắt buộc thread phải có trong DB.

## 2. Nguyên nhân: scheduler khóa cứng vào zca-js

`run-scheduled-job.ts:dispatch()`:

```
101:  const api = getRunningAccountApi(job.accountId);   // trả zca-js API
132:  guiMotDoan: duongGuiZcaJs(api, job.threadId, ...)  // đường gửi kênh cá nhân
```

Trong khi `ReplyTarget.guiMotDoan` (`send-reply-in-parts.ts:70`) ĐÃ trung lập
kênh - docstring của chính nó nói nó là ranh giới duy nhất giữa logic cắt/chữa
lỗi và API thật của kênh. `KenhLuot` (`kenh-luot.ts:23`) đã có `duongGui` +
`tranKyTuMotTin` cho cả hai kênh.

Nghĩa là trừu tượng hóa kênh đã có từ V3.16, chỉ scheduler chưa chuyển sang.

## 3. Chỗ nghẽn thật: đối tượng kênh bot không lấy lại được

Đây mới là mảnh thiếu, không phải đường gửi:

- `bot-account-runner.ts:108`: `const kenh = kenhBot(client)` dựng BÊN TRONG
  `chayTaiKhoanBot`, chỉ truyền vào callback `onUpdate` của vòng poll.
- `chayTaiKhoanBot` trả về đúng `{ dung }` (`bot-account-runner.ts:38`).
- `account-manager.ts:134`:
  `running.set(id, { config, api: null, selfId: "", stopListener: dung })` -
  KHÔNG lưu `kenh`.

Nên không tồn tại `getRunningAccountKenh(accountId)` để scheduler gọi.

## 4. Hai chỗ khóa cứng, không phải một

Vòng rà lần hai tìm thêm một chỗ mà bản báo cáo đầu bỏ sót:

- `run-scheduled-job.ts:132` - đường gửi CHÍNH.
- `scheduled-job-cap-guard.ts:83` (`toTarget`) - đường gửi THÔNG BÁO CHẠM TRẦN
  NGÀY, cũng `duongGuiZcaJs(api, ...)` cứng, cũng lấy `getRunningAccountApi`.

Chỗ thứ hai hỏng CÂM: tài khoản bot chạm trần ngày thì `api` là `undefined` ->
`toTarget` trả `undefined` -> `notifyCapHitOnce: false` -> không ai được báo.
Sửa mỗi chỗ đầu là mở tính năng với một lỗ im lặng sẵn bên trong.

## 5. Vì sao phải chặn cứng ở BA chỗ

Không phải phán quyết về năng lực - là chống VÒNG DISPATCH VÔ HẠN. Nếu job bot
lọt tới dispatch mà không có `api`:

- job `once` -> `concludeBlockedNotRun` PHỤC HỒI `next_run_at` -> bị dispatch
  lại mỗi tick, mãi mãi, kèm lý do sai sự thật "Account hiện không chạy" trong
  khi account ĐANG chạy.
- job `every`/`cron` đi qua `conclude` -> `markRun` chỉ đặt `enabled = 0` khi
  CHẠM TRẦN số lần chạy, mà trần đó chỉ tồn tại với `once` (`max_runs = 1`).
  Nên `every`/`cron` giữ nguyên `enabled` lẫn `next_run_at` -> cùng vòng lặp.

Ba lớp chặn hiện tại:

| # | Chỗ | Đường vào nó bịt |
|---|---|---|
| 1 | `nang-luc-kenh-bot.ts:50` | tool - gỡ khỏi schema gửi model |
| 2 | `schedule-routes.ts:73` | dashboard `POST /api/schedule` trả 400 |
| 3 | `run-scheduled-job.ts:111` | job CŨ (tạo trước khi có chặn, hoặc account đổi loại) |

## 6. Ba cái bẫy phải xử cùng đợt

### 6a. `styles` bị tính vào ngân sách byte rồi bị vứt

`soByteTin` (`split-styled-message.ts:42`) =
`Buffer.byteLength(text) + Buffer.byteLength(JSON.stringify({styles}))`.

Trên kênh bot, `dinhDangNeuBat` vẫn sinh `styles` (bóc markdown ra thành
`Style[]`), rồi `kenhBot.duongGui` VỨT chúng. Nên ngân sách byte đếm phần
không bao giờ đi trên dây -> chẻ thừa tin.

**Đính chính so với bản báo cáo đầu**: tôi từng viết "cơ chế thử lại của
scheduler dựa vào `laLoiMayChuTuChoi`". Sai - grep ra `laLoiMayChuTuChoi` chỉ
có 2 caller: `sendOneCoDuongLui` (`send-reply-in-parts.ts:187`) và
`send-attachment-with-caption.ts:37` (tool đã bị chặn trên bot).
`concludeDeliveryFailed` KHÔNG hề gọi nó - nó đếm `delivery_attempts` cho mọi
loại lỗi, giống hệt nhau ở cả hai kênh. Nên đây là hành vi có sẵn, không phải
rủi ro mới của kênh bot.

Nhưng hệ quả thứ hai thì có thật: trên kênh bot `coCaiDeBo` là TRUE
(`styles.length > 0`) trong khi `laLoiMayChuTuChoi` trả false cho
`LoiZaloBotApi` (nó đọc `err.code` dạng số của `ZaloApiError`). Tức là hôm nay
đường lui "gửi lại chữ trơn" không chạy trên kênh bot, và điều đó ĐÚNG một
cách tình cờ - vì styles vốn đã bị vứt nên gửi lại y hệt chỉ tốn một lời gọi
API. Không ai ghi điều đó xuống. Ai "dọn dẹp" `laLoiMayChuTuChoi` cho hiểu
`LoiZaloBotApi` (một việc trông rất hợp lý) là bật ra một lời gọi thừa mỗi lần
server từ chối.

Sửa gốc: kênh khai có mang định dạng hay không, đường gửi không sinh `styles`
cho kênh không mang. Cả hai hệ quả tắt cùng lúc.

### 6b. `ReplyTarget.threadType` vẫn là kiểu zca-js

`job.threadType as ThreadType`. Bot API không có khái niệm này -
`kenhBot.duongGui` bỏ qua tham số thứ hai. Không hỏng, nhưng là dấu hiệu
trừu tượng kênh mới xong một nửa. Không sửa trong đợt này (rộng hơn phạm vi).

### 6c. Bộ tool của lượt theo lịch trên kênh bot

Sau khi gỡ chặn, lượt `kind='agent'` cô lập trên bot còn ĐÚNG 4 tool:
`get_datetime`, `web_search`, `web_fetch`, `kb_search`.

Phép tính: 14 tool, trừ hợp của hai tập:
- `runsInScheduledTurn: false` (9): `add_reaction`, `send_file`,
  `create_word_document`, `create_excel_file`, `create_image`, `tag_member`,
  `save_memory`, `schedule_task`, `read_image`.
- bot chặn sau đợt này (7): 6 tool gửi/tag/react + `get_group_info`.

Hợp = 10, còn 4. Đủ cho "tra cứu rồi báo cáo" - đúng mục đích job `agent`.
Job `kind='message'` không đụng LLM nên không ảnh hưởng.
