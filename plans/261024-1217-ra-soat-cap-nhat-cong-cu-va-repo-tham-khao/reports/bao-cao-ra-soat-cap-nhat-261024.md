# Báo cáo rà soát cập nhật: dependency, công cụ, repo tham khảo (2026-10-24)

Phạm vi: toàn bộ npm deps của `package.json`, toolchain (Node, pnpm, Docker base),
công cụ tải video (yt-dlp, TikWM), router 9Router, 9 repo trong
`D:\source-code\zalo-agent-references\`. Chỉ đọc + probe trong thư mục tạm, CHƯA
sửa file nào của dự án. Mỗi mục ghi rõ: đã xác minh (có bằng chứng) hay chưa.

## 0. Tóm tắt - việc nên làm theo thứ tự ưu tiên

| # | Việc | Mức | Xác minh |
|---|---|---|---|
| 1 | `image-size` 2.0.2 -> 2.0.4: ảnh ICNS giả làm TREO VÔ HẠN event loop, đơ cả process (mọi account) | KHẨN | Đã tự chạy lại: treo tới khi bị giết (exit 124) |
| 2 | Model vẽ ảnh `cx/gpt-5.5-image` đã bị Codex khai tử 2026-10-14 (theo commit 9router 7878f53) - DB local đang dùng đúng model này | CAO | DB local: `image_gen_model = cx/gpt-5.5-image`; HTTP 400 chưa tự test |
| 3 | Bug của mình: `tool-loop-guard` luật "không tiến triển" KHÔNG BAO GIỜ bắn với web_search/web_fetch/kb_search (nonce mỗi lần gọi làm hash luôn khác) | CAO | Đọc `tool-loop-guard.ts:181` + probe hash 2 lần bọc khác nhau |
| 4 | Bug của mình: câu fallback lỗi (`ROUTER_DOWN_REPLY`, `STEP_LIMIT_REPLY`) đi như câu trả lời thật - lịch hẹn gửi chủ động + trừ suất ngày, chat thì ghi vào history | CAO | Đọc `agent-loop.ts:697-705,748`, `run-scheduled-job.ts:217-220` |
| 5 | AI SDK 7.0.83 -> 7.0.150: bump được nhưng có 2 đổi hành vi đụng đúng đường bot dựa vào - cần quyết | CAO | Probe trên bản sao tạm, typecheck + 358 test xanh |
| 6 | zca-js 2.1.2 -> 2.2.0: an toàn, đường bot dùng gần như byte-identical | TB | Typecheck với tarball 2.2.0 xanh |
| 7 | yt-dlp: `deploy.sh` build có cache nên VPS có thể KHÔNG BAO GIỜ lên yt-dlp mới; nên ghim version trong Dockerfile | TB | Đọc `deploy.sh:54` + Dockerfile |
| 8 | Node 24.11.1 -> 24.22.1 (5 bản vá bảo mật, có TLS/DNS/zlib), pnpm 11.17 -> 11.28.x (ở lại 11, chưa lên 12) | TB | Nguồn release notes |
| 9 | Các deps khác trong `^` range (hono, zod, cron-parser, unpdf, vite...) - có vài advisory nhưng không cái nào đường tới được, trừ image-size | TB-THẤP | `pnpm audit` 41 advisory moderate+ |
| 10 | 9Router v0.5.40 -> v0.5.109: lợi nhiều, nhưng sau khi lên thì combo bị báo `vision:true` làm bot đoán sai (DB local `llm_model = gpt-combo`) + nên bật `STRICT_SSL=true` | TB | Đọc code router + DB local |
| 11 | Các bug/rủi ro khác soi ra từ repo tham khảo (MCP isError, tên người gửi chèn thẳng vào system prompt, HTML ẩn...) | TB-THẤP | Xem mục 7 |

## 1. npm dependencies

Tất cả bản đích đều trong `^` range hiện có (trừ zca-js ghim cứng), đều đã quá 24h
nên `minimumReleaseAge` không chặn (trừ `ai` 7.0.151/152 - chỉ đổi `@ai-sdk/gateway`
mà bot không dùng, nên lấy 7.0.150).

| Package | Hiện tại -> Mới | Bảo mật | Rủi ro đổi hành vi |
|---|---|---|---|
| image-size | 2.0.2 -> 2.0.4 | GHSA-w3rx-r6r6-pgpr (ICNS), GHSA-5p2g-fcmc-qvqq (JXL/HEIF): vòng lặp vô hạn. ĐƯỜNG TỚI THẬT: `send_file` URL `.jpg` trả byte ICNS -> zca-js `uploadAttachment` -> `imageMetadataGetter` (`src/zalo/zalo-client.ts:11-19`) -> `imageSize(buffer)` chọn parser theo BYTE | Layout package đổi (`dist/esm`, `dist/cjs`) - import vẫn như cũ |
| hono | 4.12.32 -> 4.13.13 | 9 GHSA, không cái nào đường tới (không dùng CORS/jsx/cache/proxy middleware) | RegExpRouter báo lỗi lúc đăng ký route thay vì lúc khớp |
| @hono/node-server | 2.0.11 -> 2.1.5 | 2.1.3 vá double-decode serveStatic (không áp: static là `web/dist` công khai) | serveStatic chỉ GET/HEAD; cần test tay SPA fallback sau `build:web` |
| zod | 4.4.3 -> 4.6.7 | GHSA-mrhx-c7xc-m3w5 (kiểm cỡ mảng trước khi parse phần tử) | 4.5 đổi đếm min/max theo code point, JSON Schema gộp check (tool schema gửi model đổi 1 lần = 1 lần trượt prompt cache). Đừng dừng ở 4.5.x (lỗi OOM) |
| cron-parser | 5.6.2 -> 5.10.2 | Chống DoS: trần giá trị 256, biểu thức 1024 ký tự | Biểu thức từng parse được nay NÉM (`0,7` thứ trong tuần, ngày không tồn tại). Job cron cũ bị từ chối -> `computeNextRun -> null` -> job im lặng chết. PHẢI chạy thử mọi job cron trên DB PROD trước khi nâng. DB local: 0 job |
| unpdf | 1.8.0 -> 1.9.1 | pdf.js 6.1 -> 6.4 (vá vòng lặp vô hạn trên Parent vòng tròn, CPU DoS text field) | 1.8.1 thêm polyfill `Math.sumPrecise` (Node 24 không có - 1.8.0 có thể ném trên vài font) |
| docx | 9.7.1 -> 9.14.0 | Không | Đổi nhiều nhất (7 minor/4 tuần, viết lại XML writer). Làm CUỐI hoặc giữ 9.7.1 |
| pino | 10.3.1 -> 10.4.0 | Escape key của child binding (không áp) | Thấp |
| vite (dev) | 8.1.5 -> 8.3.5 | 5 GHSA, có chuỗi launch-editor = command injection trên WINDOWS (máy dev chạy `dev:web`) | Không breaking với config hiện tại |
| react/react-dom (dev, nhưng bundle vào `web/dist`) | 19.2.8 -> 19.3.1 | 19.3.1 chỉ vá RSC | Thấp |
| react-router-dom | 7.18.1 -> 7.18.4 | GHSA-qwww (chỉ RSC) | Thấp |
| tsx, pino-pretty, @vitejs/plugin-react, @types/* | patch/minor | Không đáng kể | Thấp |
| exceljs 4.4.0 | đã mới nhất (không ra bản từ 2023-10) | Kéo theo brace-expansion, uuid 8.3.2 có GHSA - không đường tới | `pnpm audit --fix=update` gỡ brace-expansion; uuid ghi nhận rủi ro chấp nhận |

`pnpm audit`: 41 advisory moderate+ (18 high). Sau khi bump + `pnpm audit --fix=update`
dự kiến chỉ còn uuid (qua exceljs).

Câu hỏi: `@types/node` 26 trong khi runtime là Node 24 - cố ý? Nó cho code biên dịch
với API chưa có lúc chạy. Đề xuất hạ về `^24`.

## 2. Toolchain

- **Node**: local 24.11.1, mới nhất 24.22.1 (2026-10-20). Từ 24.11.1 có 5 bản vá bảo
  mật, liên quan bot: kiểm hostname/IP của TLS, NUL trong DNS (bot có `dns.lookup` tự
  viết trong `safe-remote-download.ts` với URL do người lạ chọn), zlib ghi tràn (bot đọc
  zip ở `read-zip-entry.ts`), undici nội bộ lên 7.30.1. 24.14.0 bật sqlite defensive
  mode mặc định -> local đang KHÁC prod. Nâng local; Docker rebuild `--pull`.
- **Docker base**: `node:24-alpine` hiện = 24.22.1 trên alpine3.24, Python 3.14.8.
  Chú thích Dockerfile ghi "Alpine của node:24 hiện cấp 3.12" đã cũ.
- **pnpm**: 11.17.0 -> ở lại nhánh 11, lên 11.28.x (vá: metadata registry đội tên gói
  khác lách được `allowBuilds`, 2 lỗi rò credential, cứng hóa lockfile/tarball).
  pnpm 12 (viết lại bằng Rust, mới 2 tháng, 15 minor) KHÔNG cần: key lạ trong
  `pnpm-workspace.yaml` làm lệnh hỏng, lockfile đổi 1 lần, corepack chỉ ghim launcher.
  `auditLevel` đã là cách viết cũ của `audit.level` (vẫn chạy, có cảnh báo).

## 3. zca-js 2.1.2 -> 2.2.0 (2026-09-09)

- Bot là ESM nên chỉ nạp `dist/*.js`: `listen.js`, `sendMessage`, `sendVideo`,
  `uploadAttachment`, `sendSeenEvent`, `sendDeliveredEvent`, `sendTypingEvent`,
  `addReaction`, `getAllFriends`, `login`, `loginQR`, `ZaloApiError` đều BYTE-IDENTICAL.
  ~60 file "đổi" là bản CJS chỉ thêm một dòng `require('../models/Bank.cjs')`.
- 7 bẫy ghi trong CLAUDE.md (sendVideo không ném khi HEAD 403, uploadAttachment video
  chờ websocket không timeout, không có `thumbUrl`, loginQR không tự lưu file, theo
  `location` đệ quy, "Unable to get video content" ném trước POST, `code` số) - KHÔNG
  đổi gì.
- Đổi thật ở runtime: `zpw_ver`/`client_version` 671 -> 685; lúc dựng API có đọc thêm
  `zpwServiceMap.aext[0]` (thiếu thì account đó không khởi động được - đã có catch theo
  account, dashboard vẫn sống). Chỉ smoke test thật mới kiểm được.
- API mới: bank account (create/update/delete/list), `getListDevice`, `lostFocus`,
  `registerCatalog`, `scanURL`. Bot không liệt kê method động nên không tự lộ tool
  ngân hàng. Tùy chọn rẻ: test chặn tool nào nhắc `BankAccount`/`getListBank`.
- **Chưa phát hành trên npm** (master sau v2.2.0): PR #378 xử lý cmd **551** trong
  `listen` - người báo "nhắn không nhận được", log ra cmd 551, thêm vào thì decode được
  tin. Tức là có ca tin nhắn tới bị listener BỎ QUA. Cùng đợt: `addReaction` ném rõ khi
  thread type sai (thay vì "Invalid URL"). Đề xuất: lên 2.2.0 ngay, chờ 2.2.1 cho fix 551
  (giữ luật "không fork"); chỉ cân nhắc `pnpm patch` nếu đã thấy mất tin thật.
- Chi tiết bảng API: report của agent zca-js (đã tóm ở đây).

## 4. AI SDK (ai 7.0.83 -> 7.0.150, mcp 2.0.83, openai-compatible 3.0.77, anthropic 4.0.87, google 4.0.104)

Bump CÙNG LÚC cả 5 gói (provider mới hơn `ai` là vỡ typecheck: đo được 5 lỗi). Trên
bản sao tạm: typecheck sạch, 35 file test đụng SDK = 358/358 xanh trước và sau. Nhưng
**2 đổi hành vi không test nào phủ** (đã probe):

1. **ai 7.0.130**: abort/timeout giờ REJECT mọi promise kết quả. Hôm nay: `totalMs`
   bắn ở step 2 sau khi step 1 có tool call -> resolve kết quả cụt -> `canLuotChot` ->
   lượt chốt vẫn ra câu trả lời. Sau bump: ném `TimeoutError` -> phân loại `transient`
   -> người dùng nhận câu báo lỗi kỹ thuật, mất lượt chốt.
2. **openai-compatible 3.0.33**: stream kết thúc mà KHÔNG có `finish_reason` giờ là LỖI
   (`InvalidResponseDataError`). Hôm nay: stream rỗng chỉ `[DONE]` -> `isGlitch` -> thử
   lại 1 lần. Sau bump: ném -> `unknown` -> không thử lại -> câu báo lỗi. Nguy cơ cơ chế
   thử-lại-khi-router-trả-rỗng (`agent-loop.ts:634`) chết câm nếu glitch của 9Router
   không kèm finish chunk (đọc code router: passthrough không tự thêm finish - khả năng
   cao nhưng chưa có mẫu SSE thật). Mặt tốt: text cụt rồi đóng sạch không finish nay
   thành lỗi thay vì gửi câu cụt như câu đủ.

Lợi đáng kể: Gemini thought signature qua provider tên `llmRouter` nay giữ được giữa
các step (3.0.32); tool-call id thiếu/trùng được xử lý; Anthropic báo `reasoningTokens`.
MCP 2.0.81: client chờ `server/discover` không còn timeout 1s - server cũ treo method
lạ sẽ treo tới `MCP_CONNECT_TIMEOUT_MS` (lỗ có sẵn: race timeout xong không đóng client
nối muộn). Fingerprint drift đọc code thấy ổn định (không bật `can_duyet_lai` oan).

## 5. Công cụ tải video

- **yt-dlp**: chỉ 1 bản ổn định sau 2026.08.19 là **2026.10.21**. `tiktok.py`,
  `facebook.py`, `instagram.py`, `generic.py`, bộ sắp format KHÔNG đổi. Không cần sửa
  code. Format `download` có watermark của TikTok vẫn tên cũ (`[format_id!=download]`
  vẫn đúng). Threads vẫn chưa có extractor (PR #9852 còn mở) - giữ chặn.
- **Rủi ro thật ở Docker**: dòng `RUN ... pip3 install yt-dlp` không đổi nên luôn trúng
  cache; `deploy.sh:54` build không `--pull`/`--no-cache` -> VPS rất có thể vẫn chạy bản
  yt-dlp của lần build ĐẦU. `pip install -U yt-dlp` trong container cũng không làm được
  (pip đã gỡ, user non-root). Câu "pip install -U yt-dlp là đủ" ở `nguon-yt-dlp.ts:13` và
  CLAUDE.md sai với Docker. Đề xuất ghim `ARG YTDLP_VERSION=2026.10.21` (đổi số = vỡ
  cache có chủ đích, mọi VPS cùng bản, kèm được `--require-hashes`).
- **certifi** (GHSA-6q48-6c7w-9gw2, Critical): Docker KHÔNG dính (core yt-dlp không kéo
  certifi). Máy dev dính: certifi 2026.4.22 trong user site-packages -> nâng.
- **TikWM**: không có thông báo đổi/đóng. Homepage + `/docs` nay sau Cloudflare
  challenge; `/api/` không tham số vẫn trả envelope cũ. Nếu Cloudflare chặn cả `/api/`
  thì bot nhận 403 và lùi sang yt-dlp (xuống cấp chứ không hỏng).
- Chú thích cũ cần sửa: `nguon-yt-dlp.ts` còn ghi trần song song 2 (nay 1) và "yt-dlp
  ghi thẳng ra đĩa" (nay `-o -` ra stdout).

## 6. 9Router v0.5.40 -> v0.5.109 (484 commit)

Repo tham khảo đã fetch; router đang chạy thật thì do anh tự triển khai - cần redeploy.

- **Cần làm**:
  - Đổi model vẽ ảnh khỏi `cx/gpt-5.5-image` (Codex khai tử gpt-5.5 2026-10-14, trả 400 -
    theo commit message, CHƯA tự test) sang `cx/gpt-image-2.5` (cần router mới) hoặc
    `cx/gpt-5.6-terra-image`. Rồi bấm "Vẽ thử 1 ảnh". Tránh `-sol-image` với tài khoản Go.
  - Sau redeploy, `/v1/models` gắn `capabilities.vision = true` cho combo nếu BẤT KỲ
    thành viên nào đọc được ảnh (`capabilities.js:678`). Bot kiểm `vision === true`
    TRƯỚC `comboIds` (`model-vision-detection.ts:165` vs `:170`) -> combo bị coi là
    vision, bỏ chế độ lai -> lượt sau rơi vào thành viên không đọc ảnh là ảnh lịch sử
    bị bỏ câm. DB local: `llm_model = gpt-combo`, `vision_mode = auto` -> ÁP DỤNG. Sửa
    bot: kiểm `comboIds` trước.
  - Bật `STRICT_SSL=true` trên router: v0.5.95 thêm tự thử lại với
    `rejectUnauthorized:false` khi lỗi chứng chỉ (`proxyFetch.js:262-270`) - MITM đọc
    được OAuth token + nội dung chat.
- **Lợi, chỉ cần redeploy router**: stream đứt sau HTTP 200 nay gửi khung lỗi (bot bắt
  được cụt thay vì tưởng thành công); 4xx theo request không còn khóa account (cắt-rồi-
  thử-lại khi tràn context mới chạy đúng); tool call song song của Codex không còn bị gộp
  vào index 0; chuyển tiếp `retry-after`; combo tự thử lại 200 rỗng; Codex hết bị đăng
  xuất do tái dùng refresh token.
- **Đổi nhỏ**: hết suất mọi account nay luôn 503 + `retry-after` (trước hay là 429) -
  nhánh chờ-rồi-thử của 429 trong bot không còn chạy (tùy chọn: coi 503 có `retry-after`
  là rate_limit). `requireApiKey: true` mặc định. Vision fallback pool BẬT mặc định
  (định tuyến sang model free bên thứ ba khi model không đọc ảnh) - cân nhắc tắt vì riêng tư.
- **Giới hạn cũ vẫn còn**: Codex bỏ `max_output_tokens` (nên `LLM_MAX_OUTPUT_TOKENS`
  vô tác dụng với `cx/`); `response.failed` của Codex về thành text `"[Error] ..."` với
  finish `stop` (bot có thể gửi nguyên câu đó cho người dùng); không có SSE keepalive
  cho chat (pha chỉ-reasoning > 100s vẫn có thể dính 524).
- License vẫn MIT.

## 7. Repo tham khảo - commit mới và thứ soi ra cho bot

| Repo | Commit mới | Ghi chú |
|---|---|---|
| zca-js | 8 (6 sau v2.2.0) | Fix cmd 551 + addReaction - xem mục 3 |
| zalo-agent-cli | 5 | Backoff reconnect khi bị phiên Zalo Web khác tranh - bot ĐÃ có (`reconnect-planner.ts`) |
| zalo-personal | 0 | |
| deplao-builder | 51 | Đã lên zca-js ^2.2.0; phần lớn UI/CRM/Telegram - không áp |
| 9router | 484 | Mục 6 |
| hermes-agent (MIT) | ~54.5k non-merge | Lọc theo path + từ khóa |
| goclaw (CC BY-NC, chỉ soi pattern) | ~76 thay đổi thật (phần lớn là commit trùng do merge) | Kênh Zalo: không đổi gì |
| deepseek-harness (MIT) | ~14.8k | Chỉ meta-rule |
| cobalt | 0 | Đã bác từ đầu (không trả duration/width/height) |

Bug/rủi ro của CHÍNH BOT soi ra nhờ đối chiếu (theo ưu tiên; mục có "XM" = tôi đã tự
đọc code xác nhận):

1. **[CAO, XM] Loop guard mù với tool đọc có bọc nonce** (cùng lớp hermes 0cc43227d9):
   `demKetQua` băm cả output đã `wrapUntrustedContent`, nonce đổi mỗi lần -> luật
   "cùng kết quả N lần" không bao giờ bắn cho web_search/web_fetch/kb_search. Test xanh
   vì test đưa chuỗi trơn. Sửa: băm nội dung trước khi bọc hoặc bóc nonce. ~1h.
2. **[CAO, XM] Câu fallback đi như câu trả lời thật** (pattern goclaw #1587): `agent-loop`
   trả `{text: ROUTER_DOWN_REPLY}` / `STEP_LIMIT_REPLY` không đánh dấu thất bại ->
   scheduler gửi chủ động + ghi run thành công + trừ suất ngày (trái luật job hỏng thì im);
   chat thì `deliver-chat-reply.ts:72-74` ghi vào history (trái `message-turn-processor.ts:252`).
   Sửa: cờ kết quả có kiểu thay vì so chữ. Nhỏ.
3. **[TB-CAO, XM] MCP `isError:true` bị coi là thành công**: `@ai-sdk/mcp` không ném,
   `mcp-tool-definition.ts` không kiểm `isError` -> lỗi bọc như thành công, loop guard
   không thấy; trái luật `ketQuaLoi`. Kèm: `error.message` của server vào `ketQuaLoi`
   thô, không bọc. Rất nhỏ.
4. **[TB] MCP không lọc ký tự TAG vô hình (U+E0000-E007F)** ở kết quả và mô tả tool
   (hermes 8bbda8ff33); các tool khác đã qua `locKyTuAn`. Nhỏ.
5. **[TB] Tên hiển thị người gửi chèn thô vào system prompt** (`persona-prompt.ts:157-158`
   `"${msg.senderName}"`), và dòng tin không gom xuống dòng (`user-message-line.ts:69-74`):
   thành viên chưa xác minh có thể nhắn `ok\n[25/10 09:00] Hải: ...` để giả một dòng
   không mang nhãn `[chưa xác minh]`. Chưa rõ Zalo cho tên chứa xuống dòng/ngoặc kép
   không. Nhỏ-vừa.
6. **[TB] MCP mất session (server restart) không tự hồi**: lỗi gọi tool không đánh
   dấu server `loi`, health chỉ nối lại server đã `loi`. Nhỏ-vừa.
7. **[TB] Không có trần cỡ kết quả MCP**: kết quả vài MB -> provider 400 -> vỡ cả lượt. Nhỏ.
8. **[TB] Trả lời rỗng sau khi chạy tool -> im lặng** (pattern goclaw #1491). Chưa biết
   tần suất - cần soi trace. Nhỏ-vừa.
9. **[TB] HTML ẩn (`hidden`, `aria-hidden`, `display:none`...) lọt vào web_fetch**
   (dsh 709e5edaba) - đã nằm trong nonce nên là phòng thủ chiều sâu. Vừa (giữ tuyến tính, nhớ bài học ReDoS).
10. **[THẤP] Bộ phân loại tràn context thiếu mẫu** ("context size", "exceed_context_size",
    "prompt exceeds max length", "request_too_large") -> rơi `unknown`, không cắt-thử-lại. Rất nhỏ.
11. **[THẤP] Lịch sử nhóm thụ động có thể bị prune trước khi kịp tóm tắt** (>500 tin giữa hai lần bot trả lời). Nhỏ.
12. **[THẤP] IPv6 dạng bọc IPv4 (`::127.0.0.1`, 6to4 `2002:7f00:1::`, `64:ff9b:1::`) bị coi là công khai** - probe xác nhận; VPS Linux thường không định tuyến. Nhỏ.
13. **[THẤP] docx: ký tự điều khiển C0 tạo XML không hợp lệ** (có từ trước, không do bump). Nhỏ.
14. **[THẤP] `schedule_task` expr cron không giới hạn độ dài** - thêm `.max(256)` đi kèm cron-parser. Rất nhỏ.
15. **[THẤP] Eval cho job `kind=agent`** - dsh bỏ câu "payload không tin cậy" (threat model khác,
    KHÔNG phải bằng chứng lật quyết định của mình), nhưng mình chưa có eval đo hành vi này.
16. Tùy chọn: trần số tool MCP; watchdog ngoài cho lượt LLM (undici đọc body có thể treo
    sau abort trên vài bản Node 24); job định kỳ bị ngắt do restart không chạy bù; shutdown
    bỏ rơi lượt đang chạy.

Đã có sẵn, không cần làm (đối chiếu xong): reconnect backoff, DNS pinning, redirect MCP
`error`, gửi lại tin đã chia phần, history không nhận assistant rỗng, chu kỳ A-B-A-B
tool call, đọc allowlist từ DB mỗi tin, chặn tool lịch trong lượt lịch...

## 8. Tài liệu đã cũ (sửa khi làm)

- CLAUDE.md dòng vẽ ảnh ghi `?response_format=binary`, code thật dùng SSE
  (`image-generation-client.ts:11-15,113`).
- CLAUDE.md "Rà cả 140 API của zca-js" -> 155 ở 2.2.0.
- CLAUDE.md + `nguon-yt-dlp.ts:13` "pip install -U yt-dlp là đủ" (sai với Docker).
- Dòng `ai 7.0.83` trong CLAUDE.md.
- Dockerfile: Python 3.12 -> 3.14.
- Comment `env.ts:203`, `create-image-tool-description.ts:8`, `image-generation-client.ts:9`
  nhắc `cx/gpt-5.5-image`.

## Câu hỏi chưa giải quyết

1. VPS đang chạy bản yt-dlp nào, router bản nào, `STRICT_SSL` đã bật chưa, model vẽ ảnh + model chat trên DB PROD là gì (combo?) - tôi chỉ đọc được DB local.
2. Job cron trên DB prod có biểu thức nào cron-parser 5.10.2 từ chối không.
3. Timeout giữa lượt sau khi bump AI SDK: giữ lượt chốt (như hôm nay) hay chấp nhận báo lỗi?
4. Glitch rỗng của 9Router có kèm `finish_reason` không (cần 1 mẫu SSE thật).
5. `send_file` có bật cho agent mà người lạ chat không (độ nặng của mục image-size).
6. Zalo có cho tên hiển thị chứa xuống dòng / `"` không.
7. `@types/node` 26 là cố ý?
