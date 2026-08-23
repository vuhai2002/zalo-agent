# Kết quả điều tra Phase 00 - abort-signal cho tool mạng

## Kết luận: ĐÚNG là có lỗ hổng, nhưng cơ chế khác dự đoán ban đầu (và tệ hơn một chút)

Dự đoán ban đầu: "tool bỏ qua abortSignal + download không nhận signal". Đúng cả hai,
NHƯNG mắt xích gốc nằm ở tầng SDK: **cái signal đó không hề tồn tại để mà bỏ qua.**

## Bằng chứng (đọc code ai@7.0.37 + zalo-agent)

1. `agent-loop.ts:399,491` gọi `streamText({... timeout: { totalMs: LLM_TURN_TIMEOUT_MS } })`,
   KHÔNG truyền `abortSignal`, KHÔNG có `timeout.toolMs`/`timeout.tools`.
2. AI SDK dựng signal cho tool như sau (minified `ai/dist/index.js`):
   - `getToolTimeoutMs(timeout, toolName)` = `timeout.tools?.[`${toolName}Ms`] ?? timeout.toolMs`
     - KHÔNG đọc `totalMs`. Ta chỉ đặt `totalMs` -> hàm trả `undefined`.
   - `toolAbortSignal = mergeAbortSignals(abortSignal, toolTimeoutMs)` = `merge(undefined, undefined)` = `undefined`.
   - Tool được gọi: `execute(input, { toolCallId, messages, abortSignal: toolAbortSignal, ... })`.
   -> **tool execute nhận `abortSignal: undefined`.** `totalMs` chỉ bao lời gọi LLM, KHÔNG abort tool.
3. `web-fetch-tool.ts:62` `execute: async ({ url }) =>` bỏ qua tham số thứ hai (dù có cũng là undefined).
4. `safe-remote-download.ts:39` `DownloadOptions = { maxBytes; timeoutMs? }` - KHÔNG có `signal`.
5. `safe-remote-download.ts:187,190` timeout là **idle socket timeout** (`req.on("timeout")` +
   option `timeout`), KHÔNG phải total deadline. Mặc định 15s (`DEFAULT_TIMEOUT_MS`).

## Hệ quả (severity: hygiene/DoS nhẹ, KHÔNG critical)

- Khi trần lượt (`LLM_TURN_TIMEOUT_MS`) bắn, `streamText` reject và lượt bỏ cuộc, NHƯNG mọi
  tool đang tải vẫn CHẠY NỀN (promise execute không bị hủy) tới khi tự xong/lỗi. Kết quả bị vứt.
- Chặn thực tế chỉ còn: idle-timeout 15s + `maxBytes`. Nguồn **nhỏ giọt** (gửi 1 byte mỗi <15s)
  reset idle timer liên tục -> kết nối sống tới khi chạm `maxBytes` (= maxBytes / tốc độ giọt),
  lâu hơn hẳn trần lượt. Bot đọc URL người lạ -> đây là vector lãng phí tài nguyên/DoS nhẹ.
- Sắc nhất ở tool tải nặng: `tai_video` (`taiTuUrlVaoRam`), tải ảnh bìa (`chuan-bi-anh-bia-video`),
  cùng `web-fetch` (nhưng web-fetch cap HTML nhỏ nên nhẹ). Đều đi qua `downloadFromPublicUrl`.

## Phát hiện thêm đáng ghi (theo yêu cầu user)

- **dsh model = "mỗi tool tự khai `timeoutMs`, harness ép bằng per-tool signal"** map THẲNG vào
  `timeout.toolMs`/`timeout.tools[name+'Ms']` của AI SDK. Tức cách idiomatic để vá là ĐẶT
  per-tool timeout, chứ không nhất thiết tự dựng AbortController lượt. Đây là pattern dsh và
  vừa vặn với SDK ta đang dùng - một điểm "hợp" bất ngờ.
- `totalMs` KHÔNG bao tool là hành vi dễ hiểu lầm: comment ở `agent-loop.ts:397` viết "totalMs
  bao gồm cả thời gian chạy tool" - ĐÚNG về nghĩa "trần cho cả lượt tính từ lúc bắt đầu tới
  khi stream xong", nhưng SAI nếu hiểu là "sẽ hủy tool đang chạy". Nên đính chính comment.

## Đề xuất sửa (Phase 01) - 2 lớp, khớp dsh

- **Lớp 1 (SDK wiring):** thêm `timeout.toolMs` (per-tool budget) HOẶC truyền một `abortSignal`
  lượt vào `streamText`, để `toolAbortSignal` khác `undefined`. Khuyến nghị: **turn AbortController**
  truyền `abortSignal` - hủy đúng lúc lượt bỏ cuộc, khớp ngữ nghĩa hơn per-tool budget cố định.
- **Lớp 2 (đường tải):** `downloadFromPublicUrl` nhận thêm `signal?: AbortSignal`, nối vào
  `http.request({ signal })` và hủy stream khi abort; GIỮ idle-timeout 15s (hai lớp). Các tool
  mạng forward `options.abortSignal` xuống. Tool bị abort trả `ketQuaLoi(...)`, KHÔNG ném.

## Cần user duyệt
Xác nhận đây là bug đáng vá (hygiene, không critical) và chọn Lớp-1 theo hướng turn-signal.

---

## ĐÍNH CHÍNH (sau review Opus + probe runtime của chính tôi)

**Chẩn đoán gốc ở trên SAI một phần, review bắt được, probe xác nhận.**

Sai ở đâu: tôi đọc `toolAbortSignal = mergeAbortSignals(abortSignal, toolTimeoutMs)`
ở tầng tool và kết luận "tool nhận undefined vì getToolTimeoutMs không đọc totalMs".
Nhưng THAM SỐ ĐẦU `abortSignal` ở đó ĐÃ được gộp `totalMs` từ trên. Probe runtime
(streamText -> tool execute, ai@7.0.37):

```
chi totalMs=300         -> tool abortSignal = DEFINED, fired 302ms
totalMs=3000+toolMs=300 -> DEFINED, fired 314ms   (toolMs chỉ ăn khi < totalMs)
khong timeout           -> UNDEFINED
```

Sự thật: **`totalMs` ĐÃ cấp abortSignal fire cho tool.** Bug thật KHÔNG phải "tool
nhận undefined" mà là **tool/`downloadFromPublicUrl` không tiêu cái signal có sẵn**
(execute bỏ qua tham số 2; download không có param `signal`) -> tải nền tiếp sau
khi lượt bỏ cuộc.

Hệ quả cho bản vá:
- **Layer 2 (download honor signal) = bản sửa THẬT** - giữ.
- **Layer 1 (`toolMs`) = no-op** - đã GỠ. `totalMs` (đã có sẵn) bắn trước hoặc bằng.
- Comment `agent-loop.ts` viết lại theo sự thật đo được.

Bài học: đọc minified code dừng ở tầng cục bộ mà không truy nguồn tham số là chỗ
sai. Probe runtime mới là bằng chứng dứt khoát - review đã đúng khi đòi probe.
