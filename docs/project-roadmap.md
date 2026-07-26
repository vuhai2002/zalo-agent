# Project Roadmap - zalo-agent

## V1 - Lõi (2026-07-25)

- [x] Multi-account: config/accounts.json + account-manager, cookie mã hóa riêng từng account
- [x] Agent loop (Vercel AI SDK): LLM tự gọi tool nhiều bước rồi trả lời
- [x] Tools: add_reaction, send_file (giới hạn shared-files/URL), tag_member, get_group_info
- [x] Đọc ảnh người dùng gửi (download -> base64 -> vision)
- [x] History SQLite (node:sqlite) theo account + thread
- [x] Middleware: allowlist, group @mention gating, rate-limit gửi tin
- [x] Login QR (pnpm zalo-login <id>, ảnh QR tự mở), listener auto-reconnect backoff, graceful shutdown, pino logging
- [x] Console UTF-8 trên Windows (log tiếng Việt không vỡ dấu)
- [x] Test end-to-end với account Zalo thật (nick "Minh Triết") - chat, tool calling (thả tim thật), vision (mô tả đúng ảnh) đều chạy qua 9Router
- [x] Gộp tin nhắn cùng thread thành 1 lượt agent + chạy tuần tự (sửa lỗi trả lời 2 tin mâu thuẫn khi gửi ảnh kèm câu hỏi)
- [x] Unit test (`pnpm test`, dùng `node --test` + tsx, không thêm dependency): allowlist-filter, message-batcher, zalo-message-parser, history-store - 29 test
- [x] Prune history: mỗi thread giữ tối đa `HISTORY_MAX_MESSAGES_PER_THREAD` (mặc định 500) tin mới nhất, dọn ngay sau mỗi lần ghi
- [x] Sửa `engines` trong package.json: `>=22.13` (bản Node đầu tiên dùng được `node:sqlite` mà không cần flag) - trước ghi nhầm `>=20.6`, deploy lên Node 20 sẽ crash lúc khởi động

## Đang treo (việc tiếp theo khi mở session mới)

- [ ] **Test lại fix batcher trên Zalo thật**: gửi ảnh rồi hỏi ngay -> kỳ vọng 1 câu trả lời duy nhất, không phải 2 tin mâu thuẫn. Unit test đã phủ phần gộp tin + chạy tuần tự, nhưng chưa chạy với Zalo thật.
- [ ] Thêm nick phụ thứ 2 (`pnpm zalo-login acc-hai`) để test multi-account thật + persona riêng từng nick

## V2 - Dashboard + Memory (2026-07-25, plan: plans/260725-1650-web-dashboard-and-memory/)

- [x] Data layer: bảng threads (bot_enabled per thread), contacts (auto-collect), agent_turns (token usage), backfill từ messages cũ
- [x] Passive listening group: tin không @mention vẫn ghi history (không tốn LLM), timestamp trong replay
- [x] Dashboard API (Hono, cùng process, 127.0.0.1): auth password + HMAC cookie + rate-limit login, threads/messages/contacts/overview/provider/memories
- [x] Dashboard UI (React + Vite + Tailwind, tone xanh Zalo #0068FF): Overview, Sessions (+ drawer xem hội thoại + toggle bot), Contacts, Memory, Providers
- [x] Providers: đổi provider/model/base URL/API key runtime từ UI (key mã hóa AES-256-GCM, response luôn masked), test kết nối, rollback về env
- [x] Memory 3 lớp (mô hình ChatGPT/OpenClaw): rolling summary per thread (async sau reply), tool save_memory với quy tắc privacy bất đối xứng (fact học ở DM không bao giờ inject trong group), timestamps
- [x] Fetch sanitizer chống response lỗi từ 9Router (JSON dính đuôi SSE)

## V2.1 - Accounts + Agents + QR web (2026-07-25, plan: plans/260725-1910-accounts-agents-qr-web/)

- [x] Tách "kênh" khỏi "não" theo mô hình GoClaw: bảng `agents` (icon, persona, model override, max_steps) + `accounts` (label, policies, agent_id) - N account dùng chung 1 agent
- [x] DB là source of truth; config/accounts.json chỉ seed 1 lần (persona cũ tự tách thành agent riêng)
- [x] Trang Accounts: thêm/đổi tên/bật tắt account, sửa policies + allowlist, gắn não, xóa (kèm credentials)
- [x] Trang Agents: tạo/sửa não, model override per agent, không xóa được agent mặc định/đang dùng
- [x] QR login ngay trên web: lấy base64 từ event loginQR (không ghi file), polling status, QR hết hạn tự thay, phiên 3 phút, login xong tự start listener
- [x] account-manager lifecycle per account (start/stop runtime, đọc policies mới nhất từ DB mỗi tin) - bot không account nào vẫn sống để login qua web
- [ ] Chưa test Zalo thật: quét QR end-to-end, persona agent ăn vào trả lời

## V2.2 - Phản hồi tức thì (2026-07-25)

- [x] Chỉ báo "đang nhập" trong lúc agent xử lý. Zalo KHÔNG có API tắt chỉ báo (đã rà hết `zca-js/src/apis`) - nó tự hết sau vài giây nên phải bắn lặp mỗi `TYPING_REFRESH_MS` (mặc định 3s), dừng trong `finally` kể cả khi agent lỗi, kèm chốt chặn tự tắt sau 2 phút
- [x] Auto-react khi nhận tin (mặc định bật, tim). Chỉ thả với tin bot SẼ trả lời - tin group passive-listen mà thả sẽ gây hiểu nhầm là bot sắp trả lời
- [x] Bật/tắt riêng từng account + chọn icon trong 9 loại ngay trên UI; danh sách icon do server cấp (`GET /api/accounts/reaction-icons`) để không lệch giữa frontend và `reaction-icons.ts`
- [ ] Chưa test Zalo thật: chỉ báo có hiện đủ lâu với chu kỳ 3s không (TTL thật của Zalo chưa biết), reaction có bị coi là bất thường không

Ghi chú rủi ro: typing làm bot GIỐNG người hơn (client Zalo thật cũng bắn event này khi gõ). Auto-react thì ngược lại - không ai thả cảm xúc vào mọi tin nhận được; user đã chọn bật mặc định sau khi được cảnh báo.

## V2.3 - Bot xem lại được ảnh cũ (2026-07-25)

Sửa lỗi thật user gặp: gửi ảnh, vài phút sau hỏi lại về ảnh -> bot trả lời "không xem lại được ảnh trước đó" (history chỉ lưu text `[gửi kèm N ảnh]`).

- [x] Ảnh nhận được lưu vào `data/media/<account>/<thread>/` (media-store), cột `images` trong bảng messages trỏ tới file
- [x] Agent loop nạp lại tối đa `HISTORY_IMAGE_CONTEXT_LIMIT` ảnh gần nhất (mặc định 3, 0 = tắt) vào context từ đĩa - ảnh ngoài ngân sách rơi về text như cũ để không phình token
- [x] Lượt hiện tại đọc ảnh từ đĩa thay vì tải lại từ URL Zalo (persist trước khi chạy agent); passive listen ghi tin ngay, ảnh tải xong async mới gắn vào row
- [x] Dọn file media cũ hơn `MEDIA_RETENTION_DAYS` (mặc định 7 ngày) lúc khởi động + mỗi 24h; file đã dọn thì history tự rơi về text, không lỗi
- [x] Unit test: media-store (lưu/đọc/sanitize/chặn path traversal/cleanup), history-to-model-messages (ngân sách ảnh ưu tiên tin mới), history-store (round-trip cột images)
- [ ] Chưa test Zalo thật: gửi ảnh -> hỏi lại sau vài phút -> bot phải mô tả lại được ảnh

## V2.4 - Vá lỗi trước khi deploy (2026-07-25)

Rà soát toàn bộ codebase, 7 lỗi tìm được đều đã vá. Không phải tính năng mới - dọn
đường để mục "Deploy VPS" bên dưới không mang lỗ hổng lên mạng.

- [x] **Mất tin khi agent lỗi**: history chỉ được ghi sau khi `runAgentTurn` thành công -> provider chết là tin người dùng biến mất. Giờ ghi ở cả nhánh lỗi (cờ ghi-một-lần)
- [x] **Bypass rate-limit login**: `x-forwarded-for.split(",")[0]` lấy entry do client bịa -> brute-force password không giới hạn. Giờ lấy IP socket, chỉ tin XFF khi `DASHBOARD_BEHIND_PROXY=true` và lấy entry phải nhất. Map bucket cũng được dọn khi hết cửa sổ
- [x] **SSRF trong tool `send_file`**: URL do LLM quyết, không kiểm host. Thêm `shared/private-address-guard.ts` + `shared/safe-remote-download.ts`: chặn IP nội bộ/loopback/metadata cloud (kiểm cả literal IP, từng hop redirect, và qua `lookup` của socket nên chặn cả DNS rebinding), cắt kích thước theo stream. Áp cho cả `download-image`
- [x] **Bug thật do test bắt được**: guard tính `base` của CIDR ra int32 âm nên mọi dải có bit cao bật (172.16/12, 192.168/16, **169.254/16**) không hề bị chặn. Test đã kết nối thật vào 192.168.1.1 và nhận HTTP 401 trước khi sửa
- [x] **`data/tmp` không ai dọn**: file tải từ URL nằm lại vĩnh viễn. Giờ xóa trong `finally` sau khi gửi + sweep file mồ côi (>6h) mỗi 24h
- [x] **Phiên dashboard không thu hồi được**: chuyển token HMAC stateless sang bảng `dashboard_sessions` (logout xóa row thật, đổi `DASHBOARD_PASSWORD` kick sạch phiên qua `password_fingerprint`), cookie gắn `Secure` khi đứng sau proxy HTTPS
- [x] **Map theo thread không bao giờ xóa**: `rate-limiter.queues` + `message-batcher.threadChains` giữ 1 promise đã settled cho mỗi thread từng nhắn. Giờ tự dọn khi thread rảnh, có test hồi quy
- [x] **`LLM_API_KEY` bắt buộc lúc boot** dù dashboard cho nhập key runtime -> giờ optional, thiếu thì log warn + lỗi có hướng dẫn khi chạy agent
- [x] **Lỗi phát hiện thêm khi sửa env**: `KEY=` trong .env cho ra chuỗi rỗng chứ không phải undefined, nên `DASHBOARD_PASSWORD=` (đúng dạng `.env.example` ship) làm `process.exit(1)` lúc boot dù ý nghĩa mong muốn là "không set = tắt dashboard". Thêm `emptyToUndefined` cho các biến tùy chọn (`DASHBOARD_PASSWORD`, `LLM_BASE_URL`, `DASHBOARD_BEHIND_PROXY`)
- [x] Test: 191 pass (thêm private-address-guard, safe-remote-download, temp-file-store, client-ip, rate-limiter + test hồi quy rò rỉ Map). `persistBatchImages` nhận downloader tiêm vào để test không chạm mạng
- [ ] Chưa test Zalo thật: gửi file bằng URL công khai (đường tải mới), login/logout dashboard sau khi đổi cơ chế phiên

Ghi chú: các phiên dashboard đang đăng nhập sẽ bị đăng xuất 1 lần sau khi cập nhật
(token định dạng cũ không còn hợp lệ) - đăng nhập lại là xong.

## V2.5 - Tool tra cứu + trang Tools (2026-07-25)

Sửa 2 thiếu sót user gặp thật (bot trả lời sai ngày hôm nay, không tra web được)
+ trang bật/tắt tool kiểu GoClaw. Nghiên cứu trước khi làm: soi GoClaw v2.23.7
(UI + `internal/tools/`) và Hermes Agent của Nous Research (2 repo đã clone về
`zalo-agent-references/`).

- [x] `get_datetime` tool + bơm dòng ngày vào system prompt: CHỈ ngày + thứ, không
  giờ (giữ prompt cache nguyên ngày - pattern GoClaw); thứ do server tính, dặn model
  dùng nguyên văn. `BOT_TIMEZONE` kiểm IANA hợp lệ lúc boot bằng Zod refine
- [x] `web_search` tool: chuỗi Brave (khi có `BRAVE_SEARCH_API_KEY`, free tier
  2000 query/tháng) -> DuckDuckGo scraping (luôn cuối, không key, miễn phí) -
  đúng pattern chain của GoClaw/Hermes. Mọi provider chết trả thông báo cho model,
  không throw
- [x] `web_fetch` tool: đi qua `safe-remote-download` (thừa hưởng guard SSRF + cap
  stream), bóc text bằng `html-to-text.ts` tự viết (không thêm dependency), cap
  8000 ký tự để không phình context, đánh dấu nội dung web là dữ liệu tham khảo
- [x] Tool registry (`tool-registry.ts`): catalog 8 tool một nguồn duy nhất, nhóm
  read/action theo mức rủi ro (học webhook-safe toolset của Hermes), UI đọc qua
  `GET /api/tools`
- [x] Bật/tắt tool per account: cột `accounts.disabled_tools` (lưu danh sách TẮT -
  tool mới tự bật cho account cũ), tool tắt không vào schema LLM, key lạ bị chặn
  400 ở API
- [x] Trang Tools trên dashboard kiểu GoClaw Built-in Tools: nhóm + toggle mỗi
  dòng, chọn account, badge hiện provider search đang hiệu lực
- [x] Test: 215 pass (thêm current-datetime, web-search-providers với fetch tiêm,
  html-to-text, tool-registry, API tools/disabledTools)
- [ ] Chưa test Zalo thật: hỏi "hôm nay ngày mấy" (kỳ vọng đúng ngày), nhờ tra
  thông tin mới (kỳ vọng bot search rồi trả lời kèm nguồn), tắt tool trên UI rồi
  kiểm tra bot không dùng nữa

Ghi chú license: GoClaw là CC BY-NC 4.0 - chỉ học pattern, không copy code.
Hermes MIT - dùng thoải mái.

## V2.5.1 - Vá vụ dò vé số: web_fetch mù vì menu rác (2026-07-25)

Test thật đầu tiên thất bại đúng kiểu quý giá: gửi ảnh 2 vé số Đà Lạt nhờ dò, bot
đọc số vé chuẩn (vision OK), agent_turns ghi steps=3 (CÓ gọi tool) nhưng trả lời
"chưa lấy được kết quả". Tái hiện được nguyên nhân: search ra đúng 5 trang, còn
web_fetch trả về 8000 ký tự ĐẦU của minhngoc.net.vn - toàn menu, bảng kết quả nằm
từ ký tự 8314 nên bị cắt đúng trước phần có số.

- [x] `html-to-text` học tín hiệu Readability/Defuddle (GoClaw): vứt list có >= 3
  link và >= 70% chữ nằm trong link (menu điều hướng), match list trong cùng trước
  để gỡ menu lồng; bỏ thêm form/select/header/aside; decode entity tên
  (&Ecirc; -> Ê) qua `html-entities.ts`; ô bảng ngăn " | " để số không dính cột
- [x] Cap fetch 8000 -> `WEB_FETCH_MAX_CHARS` (mặc định 15000). Kiểm chứng lại
  trang minhngoc: text 9438 -> 5591 ký tự, TOÀN BỘ số trong bảng kết quả sống sót
  và nằm gọn trong cap
- [x] Persona thêm khối "quy tắc tra cứu" chưng cất từ `<tool_persistence>` +
  `<missing_context>` của Hermes: thông tin thời sự phải search trước khi từ chối,
  trang đầu hỏng thì thử trang khác, chỉ hỏi ngược user khi tool bó tay, cấm bịa
  số liệu, chuyện tiền phải nêu nguồn + ngày
- [x] Log "Hoàn thành lượt agent" nâng lên info kèm TÊN tool đã gọi - trước chỉ có
  số steps, debug phải đoán bot đã làm gì
- [x] Ảnh gửi model đổi content part `image` -> `file` (kiểu cũ AI SDK v7
  deprecated, in cảnh báo mỗi ảnh trong terminal)
- [x] Test: 225 pass (thêm html-entities, menu link-density, menu lồng, bảng)
- [ ] Chưa test Zalo thật: gửi lại ảnh vé số -> kỳ vọng bot search, fetch, đối
  chiếu và trả lời trúng/trượt kèm nguồn + ngày quay

## V2.5.2 - Vòng 2 vụ dò vé số: nguồn xấu + tự neo thất bại cũ (2026-07-26)

Thử lại sau V2.5.1 vẫn thua dù extraction đã tốt (audit 5 nguồn: 3 trang cho bảng
sạch ngay đầu text). Lượt mới steps=3, câu trả lời gần như COPY câu thất bại cũ
trong history - model tự neo vào tiền lệ xấu thay vì tin dữ liệu tool mới.

- [x] Bảng HTML5 bỏ thẻ đóng: xoso.com.vn viết `<tr><td>8<td><span>36</span>` không
  có `</td></tr>` (hợp lệ HTML5) - rule bám thẻ đóng làm cả bảng dính thành 1 dòng
  "836791064644...". Đổi sang bám thẻ MỞ tr/td/th
- [x] Số trong span liền kề dính chùm: chèn khoảng trắng ở ranh giới `</span><span`
  (span đơn giữa từ không bị chẻ)
- [x] Persona: thêm quy tắc "lượt trước tra không ra là chuyện cũ - lượt mới luôn
  thử tool lại từ đầu, không lặp lại câu trả lời thất bại trong lịch sử"
- [x] Log từng tool call (onStepFinish: tên + input + 300 ký tự đầu output) - vụ này
  chẩn đoán phải đi đường vòng qua DB + tái hiện tay vì không thấy bot fetch gì
- [x] Audit lại cả 4 nguồn sống: minhngoc (bảng tại ký tự 656), xs.com.vn (598),
  xoso.net.vn (107), xoso.com.vn (333) - tất cả ra bảng đủ nhãn giải + số
- [x] **Bắt được bệnh thật nhờ log mới**: lượt 00:17 hiện nguyên hình
  `steps=1, toolCalls=[], usage toàn 0, không lỗi` - 9Router thỉnh thoảng trả
  HTTP 200 với completion RỖNG. Chuỗi turn chập chờn (00:05 rỗng, 00:07 chạy ngon
  34k token, 00:17 rỗng) chứng minh là upstream flaky, không phải code bot.
  `maxRetries` của SDK không cứu vì response "thành công"
- [x] Chống chịu glitch router: nhận diện chữ ký rỗng (text trống + 0 tool call +
  0 token) -> tự retry 1 lần; vẫn rỗng thì trả lời fallback "đang trục trặc kỹ
  thuật" thay vì im lặng bỏ treo người nhắn. Lượt "chỉ thả reaction" hợp lệ (có
  tool call + token) không dính nhánh này. Log thêm finishReason mỗi lượt
- [ ] Gốc bệnh nằm ở 9Router (ngoài repo này): soi log router xem vì sao trả 200
  rỗng - tối 25/07 lặp ít nhất 5 lần
- [ ] Chưa test Zalo thật: gửi lại ảnh vé - lưu ý history vẫn còn 2 câu thất bại cũ,
  persona mới phải thắng được cái neo đó

## V2.5.3 - Bật thinking cho model (2026-07-26)

Lượt dò vé 07:30: steps=4, input 51k token - dữ liệu bảng kết quả ĐÃ vào context
mà model vẫn kết luận "chưa lấy được bảng", kèm đọc số trên vé thiếu cẩn thận.
Chẩn đoán: thiếu bước NGHĨ, không phải thiếu dữ liệu (log cũ cho thấy
reasoningTokens luôn = 0 - thinking chưa từng bật).

- [x] Học chokepoint resolve_reasoning_config của Hermes (một nơi quyết định
  tham số thinking cho mọi surface, map theo provider): `reasoning-options.ts`
  thuần + `resolveReasoningOptions` trong llm-provider dùng đúng thứ tự ưu tiên
  provider như resolveLanguageModel
- [x] `LLM_REASONING_EFFORT` (off/low/medium/high/xhigh, mặc định medium):
  openai-compatible gửi `reasoning_effort` chuẩn OpenAI qua router;
  anthropic trực tiếp dùng adaptive thinking + effort. off = tắt tường minh
- [x] Log thêm `model` (model THẬT trả lời - lộ việc router âm thầm route sang
  model khác) và `reasoningEffort` mỗi lượt. Kiểm chứng thinking hoạt động bằng
  `usage.outputTokenDetails.reasoningTokens > 0`
- [x] Summarizer + nút test kết nối không bật thinking - việc nhẹ, không đốt token
- [ ] Chưa test Zalo thật: gửi lại ảnh vé, soi log xem reasoningTokens > 0 và
  model có đọc bảng + đối chiếu đúng không. Nếu reasoningTokens vẫn = 0 thì
  9Router đang nuốt tham số reasoning_effort - phải sửa ở router

## V2.5.4 - Giảm token: ảnh mới là khoản chi chính (2026-07-26)

Lượt dò vé đã chạy đúng nhưng tốn 70.824 token input cho 1 lượt (5 request).
Đo trên dashboard 9Router: request text thuần ~2.600 token, request có ảnh
~12.650 - chênh ~10.000 chính là 4 tấm ảnh (1 mới + 3 nạp lại từ history),
nhân tiếp với số step vì mỗi step gửi lại toàn bộ hội thoại. Persona chỉ
~1.087 token, không phải thủ phạm.

- [x] **Ảnh Zalo lấy cỡ `normal` thay vì `hd`**: parser đang lấy `content.hd`
  đầu tiên (bản to nhất - đúng cái badge "HD" trên tin nhắn). Ảnh vé đo được
  977x2128 px ~2772 token mỗi lần vào context. Zalo gửi kèm sẵn nhiều cỡ nên
  chỉ cần đổi thứ tự ưu tiên qua `zalo-image-variant.ts` + `ZALO_IMAGE_QUALITY`,
  KHÔNG cần thư viện resize
- [x] `HISTORY_IMAGE_CONTEXT_LIMIT` mặc định 3 -> 1: mỗi ảnh cũ tốn ~2500 token
  ở MỌI step, mà nhu cầu thật chỉ là "hỏi lại về ảnh vừa gửi"
- [x] Persona thêm guidance gọi tool song song (chưng cất
  `PARALLEL_TOOL_CALL_GUIDANCE` của Hermes): gộp các tool độc lập vào 1 step để
  giảm số lần gửi lại cả hội thoại
- [x] Log kích thước ảnh thật + token ước lượng khi lưu ảnh - đo được hiệu quả
  thay vì đoán
- [x] Sửa lỗi tự tạo: parser lỡ import env (module vốn thuần) - test dùng import
  tĩnh sẽ chết trên máy không có `.env`. Chuyển sang truyền `imageQuality` vào
  như cách `botEnabledForThread` của allowlist-filter đang làm

Ghi chú về caching: ban đầu kết luận nhầm là "phải cấu hình ở 9Router". Sau khi
clone source 9Router về đọc thì hoá ra client TỰ LÀM được - xem V2.5.5 bên dưới.
9Router còn có trang Token Saver (nén tool output RTK, nén prompt Headroom) - chưa bật.

## V2.5.5 - Bật prompt caching từ phía bot (2026-07-26)

Clone `9router` (MIT) về `zalo-agent-references/` đọc source, tìm được đường bật
caching mà client tự làm - không phải chỉnh gì ở router.

- [x] Chuỗi bằng chứng: `codex.js:420` bơm `body.prompt_cache_key = _currentSessionId`;
  `_currentSessionId` từ `extractClientSessionId` đọc header `x-session-id` TRƯỚC,
  rồi `body.prompt_cache_key`, cuối cùng FALLBACK băm text assistant;
  `chatCore.js:120` xác nhận header client tới được đúng chỗ
- [x] Nguyên nhân `CACHED TOKENS: 0`: bot không gửi gì nên rơi vào fallback, mà text
  assistant dài thêm sau mỗi câu trả lời -> khóa đổi mỗi lượt -> cache luôn trượt
- [x] `cache-session-id.ts`: khóa sha256(accountId:threadId) gửi qua header
  `x-session-id`, bật/tắt bằng `LLM_CACHE_SESSION_ENABLED`. Băm chứ không ghép id
  thô vì thread id là định danh người dùng thật
- [x] Chọn HEADER thay vì `prompt_cache_key` trong body: header là đường chung cho
  codex/grok/claude/kiro/antigravity, provider không hiểu thì bỏ qua - đổi provider
  trên router sau này không phải sửa code bot
- [x] Không tự gắn `cache_control`: đường Anthropic của router xoá sạch rồi tự đặt lại
- [x] Log thêm `cachedTokens` mỗi lượt để kiểm chứng ngay trong terminal
- [ ] Chưa test Zalo thật: gửi vài tin trong cùng cuộc chat, kỳ vọng `cachedTokens > 0`
  từ lượt thứ 2 và `CACHED TOKENS` trên dashboard 9Router tăng

## V2.6 - web_fetch 2 tầng + cấu hình search trên dashboard (2026-07-26)

Bot không tra được giá vàng. Tái hiện ra HAI lỗi riêng biệt, không phải một:

- `web_search` trả 0 kết quả: DuckDuckGo chặn IP (HTTP 202 + trang challenge trên
  cả `html.` lẫn `lite.`). Thử SearXNG công khai (searx.be) cũng "Verifying your
  browser". Scraping miễn phí là đường cụt, không phải bug code
- `web_fetch` bị 403/406: `safe-remote-download` KHÔNG gửi header nào - không
  User-Agent, không Accept. Đây là bug thật của mình

Đã làm:
- [x] Thêm header trình duyệt vào fetch tự làm. Kết quả đo: vnexpress từ 406 thành
  chạy được ở tầng 1 trong 503ms
- [x] `jina-reader-fallback.ts`: tầng 2 khi tầng 1 hỏng hoặc ra dưới 200 ký tự.
  Cứu được `giavang.doji.vn` (tầng 1 ra 11 ký tự vì trang render JS -> Jina ra 938).
  Không cần key, tắt bằng `WEB_FETCH_FALLBACK_ENABLED`. Phải soi dòng
  `Warning: Target URL returned error` vì Jina trả 200 cả khi trang đích chặn nó
- [x] `runtime-search-settings.ts`: provider + key Brave lưu DB (mã hóa), sửa ở
  trang Tools. Chọn Brave phải có key (chặn ở store, không chỉ ở UI); mất key thì
  tự hạ về DDG. DDG luôn là lưới đỡ cuối, không tắt được
- [x] Tách `secret-cipher.ts` dùng chung - trước đó encrypt/decrypt AES-GCM chỉ
  nằm trong runtime-llm-settings, thêm chỗ thứ hai là bắt đầu có nguy cơ lệch
- [x] Test: 277 pass (thêm jina-reader-fallback, runtime-search-settings, 4 case
  API cấu hình search)
- [x] UI theo đúng mẫu Extractor Chain của GoClaw: nút Settings trên DÒNG TOOL mở
  modal liệt kê các bậc (#1, #2) kèm toggle từng bậc; bậc cuối khoá cứng hiện
  nhãn "Luôn bật". Bản đầu để cấu hình thành khối rời cuối trang - bị phản hồi
  "2 nơi khó hiểu", đã bỏ. `WEB_FETCH_FALLBACK_ENABLED` cũng chuyển vào DB để
  bật/tắt bậc Jina ngay trên UI
- [x] Lỗi UI tự tìm ra khi kiểm bằng browser: `ToggleKnob` dùng `<span>` mặc định
  `display: inline` mà width/height KHÔNG áp dụng cho inline element - núm gạt chỉ
  có kích thước khi cha tình cờ là flex container, đặt trong nút thường thì co về
  0x0 và biến mất hẳn. Sửa ở chính primitive (`inline-block`) thay vì vá từng chỗ gọi
- [ ] Chưa test Zalo thật: hỏi giá vàng sau khi anh nhập key Brave vào trang Tools

Đã khảo sát và KHÔNG chọn (ghi lại để khỏi khảo sát lại):
- `POST /v1/search` của 9Router: mọi provider (Tavily, Exa, Brave, Serper...) đều
  cần API key; chỉ SearXNG `authType: "none"` nhưng phải tự dựng instance. Cùng
  bài toán key mà thêm một tầng
- `POST /v1/web/fetch` của 9Router: cũng cần key cho firecrawl/tavily/exa. Gọi
  thẳng r.jina.ai ngắn hơn và không phụ thuộc cấu hình router

## V2.7 - Tin dài, trạng thái đã xem, hết im lặng khi lỗi (2026-07-26)

Test thật: hỏi "tìm hiểu các drama về kim cương mấy ngày gần đây". Bot chạy đúng
20 tool call, tổng hợp xong, rồi `ZaloApiError: Nội dung quá dài` (code 118) -
người nhắn không nhận được gì, câu trả lời cũng không vào history. Lượt đó tốn
175.351 token ra số 0.

- [x] **Nguyên nhân**: Zalo chặn tin dài ở phía server, zca-js không kiểm gì
  (`sendMessage.ts` chỉ đếm attachment), code mình gửi thẳng `result.text`.
  `LLM_MAX_OUTPUT_TOKENS=2048` là trần MỖI STEP nên câu trả lời hợp lệ vẫn ra
  4000-6000 ký tự. Các câu trả lời trước trong DB dài 258-1309 ký tự nên chưa
  từng chạm ngưỡng
- [x] `split-long-message.ts`: cắt ở dòng trống -> xuống dòng -> hết câu ->
  khoảng trắng, không bao giờ giữa từ; điểm cắt phải lấp >= 50% cửa sổ để không
  sinh đoạn vụn. `ZALO_MAX_MESSAGE_CHARS` (2000) + `ZALO_MAX_MESSAGE_PARTS` (5),
  vượt trần thì đoạn cuối kèm ghi chú "phần sau còn dài"
- [x] `send-reply-in-parts.ts`: gửi tuần tự qua rate-limiter sẵn có (delay ngẫu
  nhiên mỗi tin nên chuỗi tin trông như người gõ nhiều dòng). History chỉ ghi
  phần ĐÃ gửi được
- [x] **Hết im lặng khi lỗi**: nhánh `catch` giờ gửi thông báo trục trặc kỹ thuật
  thay vì chỉ log. Dùng chung câu với nhánh router trả completion rỗng. Không ghi
  câu này vào history (thông báo hệ thống, để lại là model neo vào tiền lệ hỏng)
- [x] **Trạng thái "đã nhận" / "đã xem"**: `message-receipts.ts` gọi
  `sendDeliveredEvent` cho mọi tin về listener và `sendSeenEvent` khi bot bắt đầu
  xử lý lượt. Chữ ký hàm đối chiếu source thật của zca-js (cần đủ 9 field từ
  payload gốc, mọi tin trong một lần gọi phải cùng thread). Tin passive-listen
  không báo đã xem - báo xem rồi im lặng khiến người nhắn tưởng bot đang soạn
- [x] **Lỗi thứ 2 tìm ra từ cùng log - web_fetch nuốt gzip**: znews.vn trả
  `content-encoding: gzip` dù mình không khai `Accept-Encoding` (kiểm chứng trực
  tiếp), mà `safe-remote-download` đọc buffer rồi `.toString("utf-8")` thẳng ->
  46.066 ký tự rác nhị phân vào context (tienphong 19.680). Giờ giải nén theo
  header (gzip/deflate/deflate thô/br), chặn zip bomb bằng `maxOutputLength`,
  khai `Accept-Encoding` như trình duyệt. Đo lại sau khi vá: znews 10.853 ký tự
  bài báo thật, tienphong 5.741, không còn ký tự nhị phân
- [x] **Lỗi thứ 3 - thẻ HTML tràn 2 dòng lọt vào context**: bước cuối của
  `html-to-text` tách dòng TRƯỚC rồi mới bóc thẻ từng dòng, nên thẻ xuống dòng
  giữa chừng (tuoitre.vn viết `<input onfocus=... \n placeholder=... />`) không
  khớp `<...>` trên dòng nào và đi thẳng vào text gửi model. Gộp thẻ về 1 dòng
  trước khi xử lý; ràng buộc ký tự đầu là chữ/`/`/`!` để dấu nhỏ hơn trong văn
  xuôi ("giá < 100 triệu") không bị nhận nhầm là thẻ. Đo lại tuoitre: 10.809 ->
  8.343 ký tự, bớt 2.466 ký tự markup rác mỗi lần fetch
- [x] Test: 305 pass (thêm split-long-message 10 case, message-receipts 7 case,
  decompressBody 8 case gồm cả zip bomb, html-to-text 3 case thẻ tràn dòng)
- [ ] Chưa test Zalo thật: hỏi lại câu drama kim cương -> kỳ vọng nhận đủ nhiều
  tin liền mạch, không cụt chữ; người nhắn thấy "Đã nhận" rồi "Đã xem"; rút mạng
  giữa lượt -> kỳ vọng có tin báo lỗi thay vì im

### Chốt lại 3 con số khả nghi trong log (đo bằng request thật + đọc source router)

Bắt fetch của SDK để soi đúng body đi ra router, kèm đọc source 9Router:

- **`reasoning_effort` CÓ được gửi**: body ra router là
  `{model, max_tokens, reasoning_effort: "medium", messages}`. Cảnh báo
  deprecated key `llm-router` KHÔNG làm mất tham số - `resolveProviderOptionsKey`
  của `@ai-sdk/openai-compatible` rơi về đúng key kebab-case khi không có bản
  camelCase, chỉ đẩy một warning
- **`reasoningTokens: 0` là LỖI BÁO CÁO, không phải thinking bị tắt**. Sửa lại
  phỏng đoán ghi ở V2.5.3 ("router nuốt tham số"): `executors/codex.js:441` đọc
  `reasoning_effort` rồi đổi thành `reasoning: {effort, summary:"auto"}` cho
  backend Codex - thinking CÓ chạy. Nhưng
  `translator/response/openai-responses.js:474` gọi `buildUsage({promptTokens,
  completionTokens, totalTokens, cachedTokens})` - KHÔNG truyền `reasoningTokens`,
  mà `buildUsage` chỉ thêm `completion_tokens_details` khi giá trị > 0. Field
  `output_tokens_details.reasoning_tokens` của upstream không ai đọc. Tức là
  không thể dùng reasoningTokens để kiểm chứng thinking trên đường
  gpt-5.6-sol nữa
- **`cachedTokens: 0` là miss thật**: cùng translator đó CÓ truyền `cachedTokens`
  lấy từ `input_tokens_details.cached_tokens`, nên số 0 phản ánh đúng upstream.
  Header `x-session-id` đã gửi đúng và ổn định (kiểm chứng: 2 request liên tiếp
  cùng `zalo-agent-c749a3dd...`, prompt 1287 token > ngưỡng cache 1024) mà vẫn
  miss. Nguyên nhân nằm ngoài repo này - nghi 9Router xoay vòng nhiều tài khoản
  upstream nên prefix cache không dùng lại được. Cần soi log phía router

- [x] Dọn cảnh báo deprecated in ra mỗi request: `ROUTER_PROVIDER_OPTIONS_KEY`
  đổi `llm-router` -> `llmRouter`. Kiểm chứng bằng request thật: cảnh báo hết,
  `reasoning_effort: "medium"` vẫn nằm trong body đi ra router. Thêm test chặn
  hồi quy (key không được chứa dấu gạch ngang)

## V2.8 - Tách account-manager (2026-07-26)

Trả món nợ ghi ở cuối V2.7: 1 file 309 dòng gánh 3 việc không liên quan nhau.

- [x] `incoming-message-router.ts` (98 dòng): tin đến -> ghi contact/thread, báo
  "đã nhận", chạy filter, ghi passive hoặc đẩy vào batcher. Đây là chỗ duy nhất
  quyết định một tin có được trả lời hay không
- [x] `message-turn-processor.ts` (144 dòng): lượt agent -> trả lời -> ghi
  history, kèm "đã xem", auto-react, chỉ báo đang nhập và cả 2 nhánh lỗi
- [x] `account-manager.ts` còn 103 dòng: thuần lifecycle (map account đang chạy,
  attach/start/stop, boot, shutdown) - phần dashboard gọi vào
- [x] `describeForHistory` về `zalo-message-parser.ts`: cả 2 nhánh ghi history
  (passive và batch) đều cần, để ở một trong hai file kia là sinh import vòng
- [x] Giữ nguyên hành vi - không sửa logic, không đổi public API. 306 test pass,
  typecheck sạch

## V2.9 - Model không vision vẫn dùng được, sidecar đọc ảnh thuê (2026-07-26)

Trả lời câu hỏi của user: "dùng model không hỗ trợ đọc ảnh thì sao?". Trước đây
bot luôn đính base64 vào request: qua 9Router thì router tự lột ảnh (bot bỗng
"mù" không báo trước, base64 vẫn tốn băng thông), endpoint khác thì HTTP 400
chết cả lượt. Research trước khi làm: Hermes `image_input_mode` auto|native|text
(`agent/image_routing.py`), GoClaw `read_image` tool + vision provider chain,
9Router `translator/concerns/modality.js` + `/v1/models` trả capabilities.

- [x] Phát hiện vision `auto|on|off` (mặc định auto): tra `GET {baseUrl}/models`,
  đọc `capabilities.vision` (đúng nguồn icon con mắt trên UI 9Router), cache 10
  phút theo baseUrl. Model lạ/combo/endpoint thường không có field -> coi như có
  vision (giữ hành vi cũ). Anthropic trực tiếp luôn true. on/off ép tay cho
  endpoint ngoài 9Router
- [x] 3 chế độ ảnh mỗi lượt agent (`agent-turn-content.ts`, log `imageMode`):
  native = đính pixel như cũ; describe = sidecar mô tả ảnh thành text; blind =
  bỏ ảnh + ghi chú dặn bot nói thật "không xem được ảnh", history hạ ngân sách
  ảnh về 0 (tự rơi về text "[gửi kèm N ảnh]" sẵn có)
- [x] Vision sidecar "đọc ảnh thuê" (mô hình auxiliary.vision của Hermes): model
  vision phụ qua endpoint OpenAI-compatible - đã kiểm chứng Gemini
  `https://generativelanguage.googleapis.com/v1beta/openai/` còn sống 7/2026,
  nhận ảnh base64 qua image_url, beta nhưng không có dấu hiệu deprecated.
  Free tier flash-lite 1000 lượt/ngày - chỉ tốn khi có ảnh MỚI vì mô tả cache
  vĩnh viễn trong DB (bảng `image_descriptions`, key theo rel_path media,
  prompt ép chép nguyên văn chữ + số cho use case vé số/hóa đơn)
- [x] Mô tả cả ảnh history sắp vào context (gồm ảnh passive-listen chưa qua
  lượt agent nào - nhóm gửi vé số rồi mới @mention bot vẫn đọc được); dọn mô tả
  cùng nhịp media cleanup theo MEDIA_RETENTION_DAYS
- [x] Cấu hình: env `LLM_VISION_MODE` + `VISION_SIDECAR_*` (đủ 3 nơi theo quy
  ước) + runtime settings đè từ dashboard (key sidecar mã hóa AES-256-GCM);
  card "Đọc ảnh (Vision)" trên trang Providers: badge chế độ đang hiệu lực,
  chọn mode, nhập sidecar, nút Test gọi thật với ảnh 1x1
- [x] Test: 330 pass (runtime-vision-settings, model-vision-detection với
  fetcher tiêm, vision-sidecar với caller tiêm, describe-mode của
  history-to-model-messages, blind-mode của agent-turn-content; sửa
  media-store.test đóng DB trước khi dọn thư mục tạm - EPERM trên Windows)
- [ ] Chưa test thật: điền key Gemini + đổi model chính sang model không vision
  (vd ds/deepseek-v4-pro) -> gửi ảnh, kỳ vọng bot vẫn mô tả được nội dung;
  bấm Test sidecar trên UI

## V2.9.1 - Combo hybrid + reactive fallback khi model từ chối ảnh (2026-07-27)

Trả lời 2 câu hỏi của user sau V2.9: "combo check vision được không?" và "gọi
model kèm ảnh mà lỗi thì agent tự dùng model đọc ảnh được không?". Test sống
trước khi làm: `/v1/models` instance thật trả capabilities đủ 20/20 model
(deepseek vision=false, gpt-5.6 vision=true), combo chỉ có `owned_by: "combo"`;
`/api/combos` 401 kể cả kèm key -> không tra được thành viên combo. Đọc source
`combo.js`: auto-switch luôn bật đẩy thành viên vision lên đầu khi lượt hiện
tại có ảnh, nhưng ảnh HISTORY chủ đích không pin combo -> rơi vào thành viên
mù là ảnh bị lột êm, không lỗi, không dấu vết.

- [x] Phân loại 4 trạng thái `vision|no-vision|combo|unknown` thay boolean
  (`classifyModelVision`); combo nhận diện qua `owned_by: "combo"`
- [x] Chế độ ảnh thứ 4 `hybrid` cho combo + có sidecar: đính CẢ pixel LẪN mô
  tả - thành viên vision thấy pixel, lượt rơi vào thành viên mù (fallback hoặc
  ảnh history) bị lột pixel nhưng mô tả text sống sót. Không sidecar thì combo
  giữ native (router auto-switch vẫn đỡ lượt có ảnh mới)
- [x] Reactive fallback (`agent-loop`): lượt native/hybrid có part ảnh mà
  provider ném APICallError 4xx (loại 401/403/429/5xx) -> `markModelNoVision`
  ghi cache âm 10 phút + dựng lại input ở describe/blind (`forceMode`) thử lại
  1 lần. Đóng nốt lỗ "endpoint ngoài 9Router + model mù + mode auto" - trước
  đây chết lượt với câu trục trặc kỹ thuật
- [x] Cache âm THẮNG kết quả /models lạc quan; anthropic không bao giờ bị đánh
  dấu; `clearVisionDetectionCache` (đổi cấu hình từ dashboard) xóa cả cache âm
- [x] Test: 346 pass (16 test mới: phân loại combo/unknown, cache âm,
  isImageRejectionError từng mã HTTP, hasImageParts, describe/hybrid của cả
  history lẫn lượt hiện tại với file thật trên đĩa + cache mô tả, forceMode).
  Test sống trên 9Router thật: 5 case phân loại + cache âm + imageMode đều đúng
- [ ] Chưa test Zalo thật: cấu hình sidecar Gemini rồi gửi ảnh vào combo ->
  kỳ vọng log `imageMode: "hybrid"`; lượt sau hỏi lại về ảnh (không gửi ảnh
  mới) khi combo rơi vào deepseek -> kỳ vọng bot vẫn biết nội dung ảnh

## V2.9.2 - Tool read_image: agent tự "nhìn kỹ lại" ảnh (2026-07-27)

Chốt nốt giới hạn lossy của mô tả một lần: user hỏi "trong ảnh có mấy con cá
màu vàng" mà mô tả cache (sinh TRƯỚC khi biết câu hỏi, prompt cố định) không
ghi số đếm thì model chính bó tay, không có đường "nhìn lại". Cùng lời giải
với GoClaw (`read_image`) và Hermes (`vision_analyze` + hint "closer look").

- [x] `askAboutImage` trong vision-sidecar: prompt là CHÍNH câu hỏi của agent,
  không cache (mỗi câu mỗi khác - mô tả chung đã có cache riêng)
- [x] Tool `read_image(question, imageIndex)`: chọn ảnh theo thứ tự MỚI NHẤT
  TRƯỚC - batch lượt hiện tại (chưa vào DB nên không đọc từ history được) rồi
  tới ảnh history, trần 10 ảnh. File đã dọn/index vượt/sidecar lỗi đều trả
  thông báo trung thực cho model diễn giải, không throw ra agent loop
- [x] Registry thêm cơ chế `available()` kiểm mỗi lượt: read_image chỉ vào
  schema khi sidecar đã cấu hình - thiếu hạ tầng mà vẫn vào schema thì tốn
  token mô tả và dụ model gọi để nhận lỗi. ToolContext mang thêm `batch`
- [x] Test: 359 pass (13 test mới: thứ tự gom ảnh, chọn index, đủ nhánh lỗi
  của tool, askAboutImage không cache + prompt nguyên câu hỏi, registry
  bật/tắt theo sidecar + per account)
- [ ] Chưa test Zalo thật: model chính deepseek + sidecar Gemini, gửi ảnh bể
  cá hỏi "có mấy con cá màu vàng" -> kỳ vọng agent gọi read_image rồi trả
  lời có số đếm từ Gemini, log tool `read_image` hiện input câu hỏi

## V2.9.3 - Đính chính model sidecar: 2.5-flash-lite đã chết (2026-07-27)

User cấu hình sidecar theo hướng dẫn (`gemini-2.5-flash-lite`) rồi gửi 3 ảnh
trang Rate Limit của AI Studio nhờ soi lại. Test sống bằng chính key đã lưu
(đọc từ DB, giải mã, không in) phát hiện:

- **`gemini-2.5-flash-lite` trả 404 "Not Found"** khi gọi thật, dù vẫn nằm
  trong `/models` - Google đang rút serving thế hệ 2.5; quota trên trang Rate
  Limit cũng bị bóp còn 20 lượt/ngày. Con số "1000 lượt/ngày" ghi ở V2.9 là
  dữ liệu web thời 2.5 còn là bản chính - hết đúng
- Test 4 ứng viên thay với ảnh thật: `gemini-3.5-flash-lite` OK (15 RPM /
  500 RPD trên account user), `gemini-3.1-flash-lite` OK (500 RPD),
  `gemini-flash-lite-latest` OK (alias - tránh vì Google đổi đích âm thầm),
  `gemma-4-26b-a4b-it` OK nhưng RÒ `<thought>` thô vào output + TPM 16K thấp
  (quota 14.4K/ngày rất to nhưng không dùng làm mắt được)

- [x] Đổi khuyến nghị mặc định sang `gemini-3.5-flash-lite` ở cả 4 chỗ:
  `.env.example`, `.env.production.example`, placeholder card Đọc ảnh, fixture
  test; system-architecture ghi lại vụ 404 + lý do loại Gemma
- [x] Bài học ghi docs: quota free Gemini phải đọc từ trang Rate Limit của
  CHÍNH account (thay đổi theo thế hệ model + tier), không tin số liệu web
- [ ] User đổi model trên dashboard thành `gemini-3.5-flash-lite` + bấm Test
  sidecar (key giữ nguyên)

## V2.9.4 - Xóa được sidecar + trang Tools hết nói dối (2026-07-27)

User hỏi 2 câu khi dùng thật: "không có chỗ xóa provider đọc ảnh à?" và "cấu
hình này nên để tab Tools hay Providers?". Rà lại thì cả hai đều lộ vấn đề:

- **Không gỡ được API key sidecar**: UI gửi `sidecarApiKey: form.apiKey ||
  undefined` - ô trống nghĩa là "giữ key cũ", nên key nằm lại DB vĩnh viễn dù
  xóa base URL + model. Backend có sẵn đường xóa nhưng UI không gọi được
- **Trang Tools hiện `read_image` bật sẵn kể cả khi chưa có sidecar**:
  `/api/tools` trả cả catalog không lọc theo `available()`, trong khi
  `buildAgentTools` thì lọc - người dùng tưởng bot có khả năng đó mà không có

- [x] `clearSidecarSettings()` + `DELETE /api/vision/sidecar` (xóa cả key,
  dọn cache detect); nút "Xóa cấu hình sidecar" trên card Đọc ảnh, có confirm
  vì mất key thật - cùng nếp với xóa account/agent
- [x] Cờ `hasApiKey` trong API view: `apiKeyMasked` KHÔNG BAO GIỜ rỗng (trống
  thì ra chuỗi "chưa cấu hình") nên UI không thể suy ra có key hay không -
  bug này do chính test API bắt được trước khi kịp lộ ra ngoài
- [x] `/api/tools` trả `available` + `unavailableHint`; trang Tools hiện badge
  amber "Chưa dùng được" + dòng chỉ đường sang Providers, toggle làm mờ nhưng
  vẫn bấm được (đặt sẵn cho account là hợp lệ)
- [x] Chốt vị trí: sidecar Ở LẠI trang Providers. Nó phục vụ đường ống chính
  (chế độ describe/hybrid mọi lượt có ảnh), không chỉ tool `read_image` - tắt
  tool thì sidecar vẫn chạy. Khác key Brave (chỉ phục vụ web_search nên nằm ở
  Tools). Trang Tools chỉ trỏ đường, không ôm cấu hình
- [x] Test: 370 pass (thêm `vision-routes.test.ts` cho cả nhóm /api/vision:
  mask key, giữ key khi PATCH trống, DELETE xóa sạch, imageMode đổi theo, 401
  khi chưa login). Kiểm bằng trình duyệt thật trên instance dashboard riêng
  (port 3901, DB tạm): badge + toggle mờ + nút xóa xuất hiện/biến mất đúng
  trạng thái, xóa xong `hasApiKey` về false và `read_image` về chưa dùng được

## Backlog - Không làm vội (ghi lại để khỏi quên)

- Bóc nội dung bằng Defuddle/Readability thật (thêm dependency) nếu heuristic
  link-density bắt đầu hụt với các trang khác
- Per-thread tool allowlist dựa trên nhóm read/action đã có sẵn trong registry

## V2 còn lại - Khi cần

- [ ] `src/scheduler/` - nhắn chủ động theo lịch (nhắc hẹn, báo cáo)
- [ ] `src/knowledge/` - RAG/knowledge base trả lời theo tài liệu riêng
- [ ] Lệnh điều khiển trong chat (/bot off, /clear) - thêm file trong middleware/
- [ ] Voice message STT - thêm bước trong zalo-message-parser
- [ ] `src/mcp/` - expose MCP server cho Claude Code điều khiển bot
- [ ] Deploy VPS (Docker + Caddy theo pattern ship-to-vps) - dashboard đứng sau Caddy

## V3 - Không làm (quyết định có chủ đích)

- Gửi tin hàng loạt / campaign CRM: tỉ lệ khóa nick cao nhất
- Tool chuyển tiền/thanh toán nối vào agent: rủi ro prompt injection
- Kênh Facebook (fbchat-v2): chờ Zalo ổn định đã
