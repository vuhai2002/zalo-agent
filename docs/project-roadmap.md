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
- [x] **Đã test thật (2026-07-27)**: cấu hình sidecar Gemini trên dashboard,
  Test sidecar chạy, gửi ảnh qua Zalo -> bot đọc được nội dung ảnh

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
- [x] **Đã test thật (2026-07-27)**: gửi ảnh vào combo, chế độ hybrid chạy
  đúng - bot đọc được ảnh cả khi lượt rơi vào thành viên không vision

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
- [x] **Đã test thật (2026-07-27)**: hỏi câu cần soi kỹ ảnh, agent gọi
  `read_image` và trả lời được từ kết quả sidecar

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
- [x] **Đã test thật (2026-07-27)**: đổi model trên dashboard sang
  `gemini-3.5-flash-lite`, Test sidecar trả kết quả ok

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
- [x] Vị trí cấu hình sidecar: bản này để ở Providers, V2.9.5 chuyển sang Tools
  theo quyết định của user (xem mục dưới)
- [x] Test: 370 pass (thêm `vision-routes.test.ts` cho cả nhóm /api/vision:
  mask key, giữ key khi PATCH trống, DELETE xóa sạch, imageMode đổi theo, 401
  khi chưa login). Kiểm bằng trình duyệt thật trên instance dashboard riêng
  (port 3901, DB tạm): badge + toggle mờ + nút xóa xuất hiện/biến mất đúng
  trạng thái, xóa xong `hasApiKey` về false và `read_image` về chưa dùng được

## V2.9.5 - Gom cấu hình đọc ảnh về trang Tools + xóa được key Brave (2026-07-27)

User dùng thật rồi chốt 2 việc: cấu hình đọc ảnh đưa hết về tab Tools cho gọn
("tránh 2 nơi"), và phát hiện modal search cũng không xóa được key Brave -
đúng loại bug vừa vá cho sidecar, nằm ở chỗ khác.

- [x] **Xóa key Brave**: nút riêng trong modal chuỗi search (có confirm), gọi
  `braveApiKey: ""` - backend vốn đã hỗ trợ, chỉ thiếu đường gọi từ UI vì nút
  Lưu quy ước "ô trống = giữ key cũ". Xóa xong provider tự hạ về DuckDuckGo
- [x] **Đọc ảnh về trang Tools**: card ở Providers bỏ hẳn, thay bằng modal
  Settings trên dòng `read_image` (`hasSettings: true`). Trình bày lại thành
  chuỗi 2 bậc đúng mẫu Extractor Chain như search/fetch: #1 model chính tự đọc
  pixel (dropdown auto/on/off), #2 sidecar mô tả ảnh. Nút Test + Xóa nằm luôn
  trong modal
- [x] Badge chế độ ảnh hiệu lực (native/describe/hybrid/blind) hiện trên dòng
  tool; lưu/xóa xong tự nạp lại catalog nên trạng thái "Chưa dùng được" đổi
  ngay không cần F5
- [x] Tách `tool-settings-modal-shell.tsx` (ChainStep + khung modal + class
  nút dùng chung) để 2 modal không chép lại bố cục; trang Providers quay về
  đúng một việc là cấu hình LLM chính
- [x] Test: 370 pass. Kiểm bằng trình duyệt thật trên dashboard riêng (port
  3901, DB tạm): mở modal từ dòng tool, lưu -> badge "Chưa dùng được" biến mất
  ngay, xóa sidecar -> quay lại trạng thái chưa dùng được + key gỡ khỏi DB,
  xóa key Brave -> badge dòng tool đổi sang "DuckDuckGo (miễn phí)" tức thì,
  trang Providers không còn card vision

## V2.9.6 - Hộp thoại xác nhận theo design system (2026-07-27)

User chỉ ra hộp thoại `window.confirm` mặc định của trình duyệt xấu: hiện cả
"localhost:3900 says", nút kiểu OS, không style được, lạc hẳn khỏi dashboard.

- [x] `shared/confirm-dialog.tsx`: hook `useConfirmDialog()` trả `confirm()`
  (Promise<boolean>) + element render - call site chỉ đổi 1 dòng
  `if (!window.confirm(...))` thành `if (!(await confirm({...})))`
- [x] Thay ở CẢ 4 chỗ: xóa account, xóa agent, xóa key Brave, xóa cấu hình
  sidecar. Grep xác nhận không còn `window.confirm/alert/prompt` nào
- [x] Chi tiết: icon cảnh báo đỏ, nút xác nhận đỏ (tone danger), autofocus nút
  xác nhận, Esc + bấm nền để hủy, `z-[60]` để nằm trên modal thường (z-50) vì
  thường mở TỪ trong một modal
- [x] Kiểm bằng trình duyệt thật: Esc hủy (key còn nguyên, modal cha vẫn mở),
  bấm nền hủy (account còn nguyên), bấm Xóa thì xóa thật + cả 2 modal đóng,
  autofocus đúng nút xác nhận

## V3.0 - Bot tự tạo file .docx và .xlsx (2026-07-27, plan: plans/260727-1135-tao-file-docx-xlsx/)

User hỏi bot có tạo được file Word không. Đo thật: **LLM API chỉ trả text** - cả
DeepSeek trực tiếp lẫn qua 9Router đều không có kênh file (message chỉ có `role`
+ `content`, không field nào chứa attachment). IDE code tạo được file là vì IDE
**chạy code** model viết ra - đường đó không dùng được cho bot Zalo (đọc tin
người lạ, không ai duyệt lệnh = RCE qua prompt injection).

Lời giải: bot tự dựng file, model chỉ cung cấp nội dung có cấu trúc. Know-how
định dạng lấy từ skill `docx`/`xlsx` của Anthropic nhưng nhét vào **renderer**
thay vì prompt - nhờ vậy file luôn đẹp như nhau kể cả chạy model rẻ.

- [x] Schema trung gian (`document-content-schema.ts`): model chỉ cần hiểu
  heading/paragraph/bullets/table, không cần biết DXA hay WidthType. Đổi thư viện
  sau này không phải sửa prompt
- [x] Renderer .docx (`docx` 9.7.1) áp đủ gotcha của skill: dual width DXA (dùng
  PERCENTAGE là vỡ ở Google Docs), `ShadingType.CLEAR` (SOLID render nền đen),
  bullet qua numbering config (chèn `•` thô thì Word không nhận là danh sách),
  tách `\n` thành nhiều Paragraph, header bảng lặp lại khi tràn trang
- [x] Renderer .xlsx (`exceljs` 4.4.0) + `spreadsheet-formula-values.ts` tự tính
  kết quả công thức
- [x] 2 tool `create_word_document` / `create_excel_file`: tự dựng, **tự gửi**,
  tự xóa file tạm. Học pattern `deliver` của GoClaw - câu trả về dặn thẳng
  "KHÔNG gọi send_file gửi lại" (không dặn thì model gửi 2 lần)
- [x] Chống lạm dụng: 5 env giới hạn (block/dòng/ký tự/sheet) + trần số file mỗi
  giờ per thread (Map tự dọn - hồi quy rò rỉ ở V2.4) + sanitize tên file (chặn
  path traversal, ép đúng đuôi)
- [x] `withNamedTempFile`: file gửi đi giữ nguyên tên model đặt (phần random nằm
  ở thư mục con). `withTempFile` cũ chèn prefix vào tên nên người nhận thấy
  "a1b2c3-bao-gia.docx"; sweep định kỳ được mở rộng để dọn cả thư mục con
- [x] `read-zip-entry.ts`: đọc file OOXML qua **central directory** (bắt buộc -
  có thư viện ghi zip streaming để `compSize = 0` ở local header, đọc theo đó ra
  dữ liệu rỗng và test sẽ xanh một cách vô nghĩa)
- [x] Test: 416 pass (46 test mới). Bắt được 2 bug thật của chính đợt này:
  `safeFileName` để lọt `..` trong tên file, và giả định sai rằng `#,##0` phải
  xuất hiện dạng chuỗi trong styles.xml (thực ra là định dạng có sẵn `numFmtId=3`)

### Hai câu hỏi lớn trả lời bằng đo đạc, không suy đoán

- **Không cần LibreOffice recalc.** Skill Anthropic phải chạy nó vì `openpyxl`
  ghi công thức không kèm kết quả -> mọi công cụ **xem trước** (Zalo, Drive) đọc
  `<v>` nên thấy ô trống. Đo 2 thư viện Node: `write-excel-file` 0/3 ô có `<v>`,
  `exceljs` 3/3. `exceljs` cho truyền thẳng `{ formula, result }` mà bot tự biết
  result - tiết kiệm ~1GB dependency và 1-3 giây mỗi lần gọi tiến trình con.
  Đổi lại: chỉ hỗ trợ 2 phép bot tính được (nhân 2 cột, SUM một dải)
- **Zalo KHÔNG chặn .docx/.xlsx.** Cơ chế chặn là `restricted_ext_file` - danh
  sách cấm do server Zalo trả về lúc login, kiểm ở client trước khi chạm mạng.
  Thử thật: `.exe` bị chặn (`'File extension "exe" is not allowed'`),
  `.docx`/`.xlsx` qua được

Bỏ `write-excel-file` dù nhẹ hơn 12 lần: ngoài chuyện thiếu `<v>`, nó còn ghi
`<f>=A2*B2</f>` thừa dấu `=` (chuẩn ECMA-376 là không có).

### Vòng 2 - sửa "file xấu" theo phản hồi thật (2026-07-27)

User so file bot tạo với file Claude web tạo (skill docx + chạy code): bot thua
rõ - heading XANH theme Calibri, title lệch trái, bảng chữ dính viền, dòng
"Số: ... / ngày ..." vỡ bố cục. Nguyên nhân gốc: renderer mới phủ know-how CẤU
TRÚC (DXA, shading, numbering) mà bỏ trống TYPOGRAPHY + các bố cục đặc thù văn
bản Việt Nam, nên Word rơi về theme mặc định.

- [x] `render-docx-styles.ts`: Times New Roman 13pt đen toàn văn bản (override
  cả heading 4-6 không dùng tới - style mặc định của chúng vẫn nằm trong file
  với màu xanh), title canh giữa, lề chuẩn NĐ 30/2020 (trên/dưới 2cm, trái 3cm,
  phải 1.5cm), giãn dòng 1.3 + giãn đoạn
- [x] Bảng: đệm trong ô (tblCellMar) - hết cảnh chữ dính sát viền
- [x] `**đậm**` inline (`docx-text-runs.ts`): model bôi đậm giữa dòng được
  ("**Thời gian:** từ 7h00...") - schema block cả khối cùng kiểu chữ nên trước
  đó không có cách nào
- [x] Block `two_columns` (bảng 2 cột không viền): phần đầu văn bản hành chính
  (cơ quan | quốc hiệu) và khối ký tên (nơi nhận | chức vụ) - trước đó model
  phải fake bằng khoảng trắng và bố cục vỡ
- [x] `paragraph.align` (justify mặc định + thụt đầu dòng 1cm; center/right cho
  lạc khoản thì không thụt)
- [x] Test: 422 pass (14 test docx, thêm 6: typography đen, lề trang, marker
  đậm, align, two_columns không viền, cell margin). Test typography bắt được
  heading 4-6 còn xanh trước khi kịp ship
- [x] Rà chéo Excel sau khi thêm marker: xlsx vốn không dính lỗi theme (font/màu
  set từ đầu) nhưng chưa parse `**đậm**` - model được dạy marker đó ở tool Word
  nên ô Excel viết `**Tổng cộng**` là dấu sao lọt nguyên vào file. Đã sửa: rich
  text bold cho ô chữ, header lọc marker (vốn đã đậm sẵn). 423 test pass
- [x] Ranh giới cứng/mềm ghi rõ: renderer khóa NỀN trình bày (font, màu, lề,
  giãn dòng - model không đổi được, kể cả người dùng yêu cầu); model quyết
  NỘI DUNG + BỐ CỤC (chữ nghĩa, thứ tự, đậm, canh dòng, bảng, quốc hiệu/ký
  tên). Muốn mở style sau này thì thêm nút vặn enum vào schema, không cho tự do

### Vòng 3 - vụ chết trên Zalo thật: create_excel_file hỏng 100% (2026-07-27)

Test Zalo thật đầu tiên: Word chạy ngon, Excel chết cả 2 lần thử ("công cụ xuất
file đang báo lỗi định dạng nội bộ"). Chẩn đoán bằng cách parse schema với các
payload giả định:

- **Root cause**: `z.discriminatedUnion("kind", [text, number, multiplyFormula,
  sumFormula])` - HAI schema công thức cùng `kind: "formula"` (chỉ khác `op`),
  mà discriminatedUnion đòi giá trị discriminator DUY NHẤT. Zod build map lười
  nên lúc đăng ký tool không nổ, nhưng MỌI lần parse ô object đều throw
  "Duplicate discriminator value" -> tool chết bất kể model gửi gì
- **Vì sao 423 test không bắt được**: test tool gọi thẳng `execute` (bỏ qua
  tầng validate của AI SDK), test renderer dùng object TS thuần - KHÔNG test
  nào từng chạy `sheetSchema.parse`. Bài học: tool có inputSchema thì phải có
  test parse chính schema đó với payload kiểu model hay gửi

- [x] Đổi sang `z.union` thường + test hồi quy `assert.doesNotThrow(safeParse)`
- [x] Nhân vụ này nới schema nhận dạng model gửi TỰ NHIÊN: chuỗi/số thuần
  (giống bảng Word) và công thức dạng chuỗi "=B2*C2" / "=SUM(D2:D9)" (DeepSeek
  từng viết đúng vậy khi test API) - transform chuẩn hóa về object, chữ thường
  tự uppercase. Công thức ngoài 2 dạng bị từ chối kèm hướng dẫn tiếng Việt,
  KHÔNG âm thầm rơi thành chữ
- [x] Chốt chặn trùng tên sheet (exceljs throw khi 2 sheet cùng tên - đánh số
  phía sau thay vì chết cả file)
- [x] Test: 431 pass (schema test mới cho cả spreadsheet cell + document block;
  test tool end-to-end đi qua ĐÚNG inputSchema như SDK trước khi execute)

### Vòng 4 - Excel "xấu quá xấu": bóc design từ file Claude thật (2026-07-27)

User đặt file bot cạnh file Claude web tạo (skill xlsx + chạy code): bot thua
thảm - lưới trắng trơn, chữ tràn ô, không title, không màu; sheet tab còn mất
dấu tiếng Việt. Cách sửa: user đưa chính file Claude tạo -> ĐỌC NGƯỢC file đó
bằng exceljs để bóc design tokens thật thay vì đoán.

- [x] Bộ tokens bóc được: navy `FF1F3864` (banner + header bảng), banner chữ
  trắng 16pt merge hết bề ngang, subtitle xám `D9D9D9` nghiêng, header bảng
  chữ TRẮNG trên navy + wrap + border, số liệu XANH `FF0000FF` (quy ước skill:
  số nhập tay xanh - công thức đen), ghi chú đỏ `C00000` nghiêng, cột STT hẹp
  5 - cột nội dung 34-42, freeze ngay dưới header
- [x] `render-xlsx-styles.ts` + renderer mới: title/subtitle/note per sheet
  (schema thêm 3 field optional), wrap ô chữ + vAlign top, border đủ cạnh,
  bề rộng cột kẹp [6, 45]
- [x] **Công thức TỰ DỊCH DÒNG khi có banner**: model đánh số coi header là
  dòng 1, banner đẩy bảng xuống thì SUM(D2:D3) phải thành SUM(D5:D6) - không
  dịch là công thức trỏ vào banner. Có test khóa riêng
- [x] Vụ sheet tab mất dấu: KHÔNG phải renderer strip (safeSheetName giữ
  unicode) mà model tự viết ASCII - dặn thẳng trong tool description: "MỌI chữ
  giữ nguyên dấu tiếng Việt". Đây là phần 'agent thinking' chỉnh được bằng lời
- [x] Test: 434 pass (3 test mới: banner merge + navy + 16pt, dịch dòng công
  thức + freeze theo header, note đỏ nghiêng + wrap + số xanh)

### Vòng 5 - nội dung ít + 1 màu duy nhất (2026-07-27)

User hỏi 2 câu bắt trúng chỗ hổng: (1) sao file ít nội dung hơn Claude, (2) màu
fix cứng thì 10 file ra 10 bản giống hệt nhau à. Câu 2 đúng - thiết kế cũ sai.

**Nội dung ít - đo bằng số, không đoán:**

File Claude: 6 sheet, 89 dòng, 317 ô, 15.037 ký tự -> model phải viết payload
JSON ~19.200 ký tự = **~7.100 token**. Trong khi `LLM_MAX_OUTPUT_TOKENS` đang là
**2.048** - thiếu 3,5 lần. Tra `9router/open-sse/providers/capabilities.js` thì
`cx/gpt-5.6-sol` maxOutput **128.000**, `ds/deepseek-v4-pro` **50.000** - tức là
2048 hoàn toàn do mình tự bó, không phải giới hạn model.

- [x] `LLM_MAX_OUTPUT_TOKENS` 2048 -> **16.384**, con số tính ngược từ
  `DOCUMENT_MAX_CHARS`: 20.000 ký tự nội dung -> payload ~25.000 ký tự ->
  ~9.300 token, cộng reasoning + câu trả lời. Ghi RÀNG BUỘC vào env: hạ trần
  này xuống dưới ~12.000 thì phải hạ DOCUMENT_MAX_CHARS theo, không thì model
  bị cắt giữa tool call (finishReason "length") và mất cả lượt
- [x] `DOCUMENT_MAX_SHEETS` 5 -> 10 (Claude làm 6 sheet, trần 5 chặn oan)
- [x] Mô tả tool dạy model VIẾT ĐẦY ĐỦ: báo cáo tách nhiều sheet (tổng quan,
  chi tiết, số liệu, rủi ro, nguồn), mỗi sheet có title + subtitle + note, mỗi
  ô mô tả trọn ý - "đã bỏ công tạo file thì nội dung phải đáng để mở ra đọc"

**Một màu duy nhất - sửa bằng palette có kiểm định:**

Research: skill xlsx của Anthropic KHÔNG có theme - navy trong file Claude là
model tự chọn lúc viết code, nên mỗi lần một khác. Cách đúng (design system):
model chọn từ bộ palette đã kiểm định, không cho tự do hex (sẽ ra cặp màu chữ
trắng trên nền sáng không đọc nổi).

- [x] `xlsx-themes.ts`: 6 tông kèm ngữ cảnh dùng - navy (trang trọng, mặc
  định) · blue (tài chính, báo giá) · green (tăng trưởng, môi trường) ·
  burgundy (rủi ro, pháp lý) · slate (kỹ thuật) · teal (y tế, giáo dục).
  Mỗi tông có 4 màu: header, số liệu, viền, sọc xen kẽ
- [x] Contrast tính bằng công thức WCAG 2.1: cả 6 đạt AA cho chữ trắng
  (navy 11.62:1 · tím 9.60:1 · blue 8.66:1 · burgundy 8.65:1 · slate 7.71:1 ·
  teal 6.84:1 · green 6.52:1). Cam sáng ED7D31 (2.77:1) và vàng FFC000
  (1.64:1) bị LOẠI vì trượt. Có test khóa ngưỡng này
- [x] Thêm sọc xen kẽ dòng chẵn (nền rất nhạt cùng tông) - mắt dò bảng dài
  không lạc dòng. Số nhập tay tô màu theme, ô công thức để đen (quy ước skill:
  phân biệt dữ liệu gốc với kết quả tính)
- [x] Test: 437 pass (3 test mới: theme khác nhau ra file khác nhau, mọi theme
  đạt WCAG AA, sọc xen kẽ)

### Vòng 6 - quét lại mọi hằng số "tự đặt" (2026-07-27)

Sau vụ `LLM_MAX_OUTPUT_TOKENS = 2048` là số đoán, user yêu cầu quét toàn bộ xem
còn chỗ nào tương tự. Rà hết hằng số trong code viết đợt này, phân 3 loại:

**Bug thật tìm được: mô tả ảnh bị cắt vẫn được cache vĩnh viễn**

`DESCRIBE_MAX_TOKENS = 1024` là số đoán, và tệ hơn: `vision-sidecar` KHÔNG kiểm
`finishReason`. Ảnh nhiều chữ (menu, bảng giá, ảnh chụp màn hình) làm mô tả
chạm trần -> bản CỤT được `saveImageDescription` cache vĩnh viễn -> mọi lượt sau
đều đọc phải nó, không ai biết vì sao bot trả lời thiếu.

- [x] Nâng lên 2048 (tiếng Việt ~2.7 ký tự/token -> ~5.500 ký tự, đủ ảnh dày chữ)
- [x] `SidecarCaller` trả `{ text, truncated }`; mô tả cụt VẪN dùng cho lượt
  hiện tại (có còn hơn không) nhưng TUYỆT ĐỐI không cache -> lượt sau có cơ hội
  lấy bản đầy đủ. Kèm log cảnh báo
- [x] `askAboutImage` cụt thì nói thật với model ("phần mô tả bị cắt") để nó
  đừng kết luận chắc nịch từ dữ liệu dở dang
- [x] 2 test hồi quy khóa hành vi này

**Số lệch nhẹ so với nguồn tham chiếu - đã khớp lại:**

- [x] Chiều cao dòng xlsx: 26/16/28 (áng chừng) -> **25.5/15.75/30** đúng số đo
  từ file mẫu
- [x] Bề rộng cột: 6-45 -> **5-42** (file mẫu: cột STT 5, cột nội dung 34-42)

**Số CÓ CƠ SỞ, không phải đoán (kiểm lại vẫn đúng):**

- docx: cỡ chữ 13pt (26 half-point), lề 2cm/3cm/1.5cm (1134/1701/850 twips),
  thụt đầu dòng 1cm (567), bề rộng nội dung = A4 11906 - lề. Tất cả theo
  NĐ 30/2020 (lề trên/dưới 20-25mm, trái 30-35mm, phải 15-20mm, cỡ 13-14)
- xlsx: Arial 10pt + màu theme (đo từ file mẫu), tên sheet 31 ký tự (giới hạn
  Excel), contrast mọi theme >= 4.5:1 (tính bằng công thức WCAG 2.1)

**Số là CHÍNH SÁCH tự đặt (không có "đúng/sai") - đã ghi rõ trong comment:**

- [x] `MAX_DOWNLOAD_BYTES` 25MB: ghi rõ đây KHÔNG phải giới hạn Zalo - giới hạn
  thật là `max_size_share_file_v3` do server trả, zca-js tự kiểm và ném lỗi kèm
  số MB cụ thể; con số này chỉ để khỏi tải hàng trăm MB rồi mới biết vô ích
- [x] `RECENT_IMAGE_LIMIT` 10, `WINDOW_MS` 1 giờ, `DOCUMENT_MAX_PER_HOUR` 10,
  `DOCUMENT_MAX_BLOCKS/ROWS`: chống spam và giới hạn dung lượng - chỉnh được
  bằng env, đã chú thích lý do chọn

- [ ] Chưa test Zalo thật lại: restart bot rồi nhắn "tạo file excel báo cáo"
  -> kỳ vọng nội dung đầy đủ nhiều sheet, màu hợp ngữ cảnh, sheet tab CÓ dấu

## V3.1 - Tool vẽ ảnh AI, vẽ mới và sửa ảnh người dùng gửi (2026-07-27)

Tool `create_image` gọi endpoint OpenAI-compatible `/v1/images/generations`. Làm
theo TDD: viết test đỏ trước, xem nó fail đúng lý do, rồi mới viết code - 57 test
mới, tổng 496 pass.

### Khảo sát trước khi viết dòng code nào (4 lần gọi API thật + đọc source 9Router)

- **`?response_format=binary` + JPEG nhẹ hơn 15 lần.** Cùng một ảnh: JSON base64
  PNG 2.4 MB so với binary JPEG 157 KB, mắt không phân biệt được. Đường JSON còn
  bắt parse chuỗi 3.3 MB rồi decode trong khi ta chỉ cần bytes để ghi file
- **`size` bị model BỎ QUA.** Xin `1024x1024` hai lần, nhận `1024x1536` rồi
  `1536x1024`. Không gửi tham số này và không hứa chỉnh được kích thước
- **Ảnh gốc ở trường `image` (không phải `ref_image`), dạng data URI.** Sai tên
  thì provider bỏ qua âm thầm: vẫn ra ảnh nhưng là ảnh VẼ MỚI. Sửa ảnh là sửa
  thật - gửi ảnh mèo + "đổi mũ thành beret đỏ" thì mũ đổi, mèo/sách/đèn giữ
  nguyên từng pixel
- **Lỗi có HAI hình dạng:** `400` trả `error` là OBJECT có `.message`, `401` trả
  `error` là CHUỖI. Parser chỉ đọc `.message` sẽ hiện `undefined` đúng lúc người
  dùng cần biết nhất là sai key
- **63-69 giây mỗi ảnh**, cả 4 lần đo
- **Model vẽ ảnh KHÔNG có trong `/v1/models`** (22 model chat, không cái nào có
  `imageOutput`) - nằm ở registry Media Providers riêng, nên không copy được mẹo
  auto-detect capability của sidecar đọc ảnh

### Đã làm

- [x] `runtime-image-settings.ts`: base URL + model + key, DB đè env, key mã hóa
  AES-256-GCM, có đường xóa riêng (PATCH quy ước "trống = giữ key cũ")
- [x] `image-generation-client.ts`: binary + JPEG mặc định, `transparent` ép sang
  PNG (JPEG không có kênh alpha), timeout tường minh qua `AbortSignal` vì `fetch`
  không có timeout mặc định - provider treo là treo cả lượt agent
- [x] `shared/hourly-rate-limit.ts`: tách phần đếm + DỌN bộ nhớ dùng chung, rồi
  chuyển `document-rate-limit.ts` sang dùng (6 test cũ của nó xanh nguyên vẹn làm
  lưới an toàn). Chép logic sang chỗ thứ hai là chép cả bẫy rò rỉ Map của V2.4
- [x] `create-image-tool.ts`: thứ tự bắt buộc là kiểm cấu hình -> nạp ảnh gốc ->
  kiểm trần -> NHẮN "đang vẽ" -> vẽ. Nhắn trước khi biết có vẽ được không là hứa
  lèo; nhắn sau khi vẽ xong thì nhắn để làm gì. Có test khẳng định đúng thứ tự
- [x] Ảnh gốc lấy từ hội thoại qua `collectRecentImagePaths` sẵn có của
  `read_image` - `imageIndex=1` là ảnh mới nhất, bỏ trống là vẽ mới
- [x] Lỗi provider VẪN tính vào trần: không thì spam retry đốt quota thoải mái
- [x] Dashboard: `/api/image-gen` (GET/PATCH/DELETE/test) + modal riêng ở trang
  Tools, badge hiện tên model đang dùng
- [x] Nút "Vẽ thử 1 ảnh" vẽ THẬT (~1 phút, tính phí) - cách duy nhất chứng minh
  tên model đúng vì không có danh sách nào để đối chiếu
- [x] Test đầu-cuối gọi API thật qua chính module client: vẽ mới 282 KB/58s, sửa
  ảnh 190 KB/57s, model sai bị từ chối kèm câu lỗi có nội dung thật. Prompt tiếng
  Việt có dấu ra cảnh Việt Nam đúng, chữ trên biển hiệu cũng đúng chính tả

### Quyết định của user

- Nhắn báo trước rồi vẽ (thay vì im lặng 70 giây)
- Trần 10 ảnh/giờ/thread
- Cho bot tự lấy ảnh gần nhất làm ảnh gốc

### Sửa sau lượt test Zalo thật đầu tiên (2026-07-28)

Test thật lộ 2 lỗi, cả hai đều là lỗi thiết kế chứ không phải lỗi code:

**Model điền thừa `imageIndex` cho yêu cầu vẽ MỚI.** Gọi tool 5 lần, lần nào cũng
nhận "Hội thoại chưa có ảnh nào để sửa", tốn 68k token, người dùng không nhận
được ảnh nào. Loại trừ schema Zod trước (thử 6 dạng đầu vào, bỏ trống ra đúng
`undefined` chứ không phải `NaN`) nên thủ phạm là model. Đọc log thấy nó CÓ cố
sửa - đổi prompt thành "Tạo mới hoàn toàn..." - tức là nó tưởng phải sửa NỘI
DUNG chứ không nhận ra cần BỎ một tham số đi.

- [x] Hội thoại CHƯA TỪNG có ảnh -> vẽ mới luôn thay vì từ chối. Không ai bảo
  "sửa ảnh" khi chưa gửi ảnh bao giờ, nên đó chắc chắn là tham số thừa và vẽ mới
  là việc duy nhất hợp lý. Hai nhánh còn lại (index vượt quá khi CÓ ảnh; ảnh đã
  bị dọn khỏi đĩa) vẫn báo lỗi thật vì lúc đó người dùng có nhắc tới ảnh thật
- [x] Mô tả tham số + dòng persona viết lại: dòng cũ "điền imageIndex=1 để lấy
  ảnh mới nhất" đọc lên như đang XÚI model điền
- [x] Test đi qua `inputSchema` thật, không gọi thẳng `execute` - đúng điểm mù
  đã để lọt bug discriminatedUnion của Excel
- [x] Log: tách các field ngắn quyết định hành vi ra `args` riêng. `prompt` dài
  hơn trần 200 ký tự nên `imageIndex` đứng sau bị nuốt sạch, phải suy luận ngược
  từ câu lỗi mới biết model gửi gì

**Persona tĩnh kể tên tool cứng, không biết tool nào đang tắt.** `BASE_PERSONA`
là hằng số giống hệt nhau cho mọi account, trong khi `buildAgentTools` lọc theo
`disabledTools` + `available()`. Tắt một tool đi thì prompt vẫn dạy cách dùng nó,
bot vẫn hứa làm được dù model không hề nhận được tool đó.

- [x] `listAvailableTools(account)` trong tool-registry - `buildAgentTools` gọi
  chính hàm này nên hai bên KHÔNG THỂ lệch. Có test khẳng định danh sách khớp
  chính xác bộ tool dựng ra
- [x] System prompt có mục "Khả năng của bạn lúc này" dùng NHÃN tiếng Việt (bot
  phải nói "tạo file Excel" chứ không phải "create_excel_file"), kèm dặn trả lời
  câu "làm được gì" theo đúng danh sách và không hứa thứ ngoài danh sách

### Lượt test Zalo thật thứ hai: 524 của Cloudflare + prompt mất nội dung (2026-07-28)

**HTTP 524 - đây mới là thứ chặn hẳn tính năng.** 524 là mã Cloudflare "origin
không trả lời kịp". Đường binary chỉ trả byte đầu tiên LÚC VẼ XONG, nên vẽ lâu
là Cloudflare cắt. Đo cùng một prompt chạy song song, tái hiện sạch:

```
SSE     -> byte đầu sau   1.76s | xong 62.7s  | HTTP 200 | JPEG 184 KB
BINARY  -> byte đầu sau 125.38s | xong 125.4s | HTTP 524
```

- [x] Chuyển sang xin SSE bằng `Accept: text/event-stream`. Router bắn event
  `progress` liên tục nên Cloudflare luôn thấy dữ liệu chảy. Tốn ~2.5 lần băng
  thông (504 KB so với 199 KB) - đáng, vì đường kia có lúc không ra ảnh nào
- [x] `read-image-sse-stream.ts` tách riêng: có bẫy riêng là một block SSE có
  thể bị chẻ làm đôi giữa 2 chunk mạng, xử lý từng chunk rời là mất event `done`
  của ảnh lớn. Bỏ qua `partial_image` (ảnh dở dang - gửi nhầm là gửi ảnh chưa
  vẽ xong)
- [x] Vẫn đọc được JSON thường và bytes thô: chỉ codex mới stream
- [x] `IMAGE_GEN_TIMEOUT_MS` giữ nguyên nhưng ghi rõ nó KHÔNG cứu được 524 -
  Cloudflare cắt ở ~100-125s, trước cả trần 180s

**Prompt mất sạch nội dung người dùng đưa.** User dán nguyên một bài viết rồi
nhờ làm e-magazine, model rút gọn thành "Chủ đề thiền Phật giáo tại TP. Hồ Chí
Minh" - ảnh ra sẽ toàn chữ bịa. Nguyên nhân: mô tả tool chỉ dạy tả PHONG CÁCH
(chủ thể, ánh sáng, tông màu), không có chữ nào về việc chép lại NỘI DUNG.

- [x] Mô tả tool + persona bắt chép nguyên văn, đặt trong ngoặc kép kèm vai trò
  (TIÊU ĐỀ / ĐOẠN MỞ / TRÍCH DẪN), giữ dấu tiếng Việt
- [x] Log thêm `promptChars`: nhìn 200 ký tự đầu không phân biệt được "chép
  nguyên văn" với "tóm tắt", mà hai thứ cho ra ảnh khác hẳn nhau
- [x] Kiểm chứng đầu-cuối: prompt 700 ký tự chép nguyên văn -> trang e-magazine
  dọc đúng từng câu, đủ dấu, 201 KB, 64 giây

**`imageIndex` tùy chọn đổi thành `mode` bắt buộc.** Log mới chụp được bằng
chứng: model VẪN gửi `args: {imageIndex: 1}` cho yêu cầu vẽ e-magazine mới, dù
mô tả tham số đã ghi "MẶC ĐỊNH BỎ TRỐNG" và "TUYỆT ĐỐI không điền". Bằng chứng
này lật lại quyết định trước đó (giữ imageIndex, chỉ thêm fallback): fallback
chỉ che được khi hội thoại KHÔNG có ảnh nào. Có ảnh cũ trong hội thoại là bot
đi sửa nhầm tấm đó, người dùng nhận về ảnh lạ mà không có gì báo sai.

- [x] `mode: "ve_moi" | "sua_anh_da_gui"` BẮT BUỘC. Tham số tùy chọn thì model
  điền theo quán tính; bắt buộc thì nó phải chọn có ý thức
- [x] CHỈ `mode` quyết định nhánh, `imageIndex` chỉ còn tác dụng bên trong nhánh
  sửa ảnh. Có test cho đúng ca "mode ve_moi kèm imageIndex thừa" - lá chắn chính
- [x] Giữ nguyên fallback: chọn nhầm "sua_anh_da_gui" mà hội thoại chưa từng có
  ảnh thì vẫn vẽ mới

- [x] **Đã nghiệm thu trên Zalo thật (2026-07-28).** Cùng yêu cầu e-magazine đã
  làm hỏng 2 lần trước: ra ảnh ngay lần đầu, nội dung đúng nguyên văn bài viết
  (kể cả địa chỉ 90/153 Trường Chinh và nguồn trích dẫn), đủ dấu tiếng Việt,
  hiện inline trong chat dạng ảnh HD chứ không phải file phải bấm tải.
- [x] Lượt chỉnh sửa tiếp theo cũng chạy đúng: "chỉnh lại tỉ lệ 2:3, thay hình
  minh họa bằng kiểu thiên nhiên" -> ra đúng khung dọc 2:3 và nền thiên nhiên.
  Xác nhận luôn quyết định KHÔNG gửi tham số `size`: tỉ lệ nói trong prompt thì
  model làm đúng, còn gửi qua `size` thì nó bỏ qua.

### Rà lại sau khi nghiệm thu (2026-07-28)

Hai lỗi trong chính code vừa ship, tìm ra khi soi lại chứ chưa gặp ngoài thực tế:

- [x] **Quá hạn giữa chừng lọt ra ngoài dạng lỗi thô.** Với SSE thì `fetch` trả
  về sau ~2 giây rồi còn đọc stream cả phút, mà `try/catch` bắt timeout chỉ bọc
  quanh `fetch`. Abort lúc đang đọc sẽ hiện "This operation was aborted" thay vì
  câu tiếng Việt. Đây lại đúng là ca dễ xảy ra nhất với đường stream. Bọc cả hai
  chặng, tách `readImageResponse` cho gọn
- [x] **Không đóng stream khi thoát sớm.** Gặp `event: error` hay quá hạn thì
  reader bị bỏ mặc - bot chạy thường trú nên rò rỉ kết nối dần theo từng lượt
  hỏng. Thêm `reader.cancel()` trong `finally`
- [x] Test chập chờn `pruneExpiredImageDescriptions` (đổ ~1/10 lần chạy): viết
  lại lùi ngày tường minh bằng SQL thay vì dựa vào thời gian trôi, và kiểm CẢ vế
  "giữ mô tả mới" mà tên test hứa nhưng bản cũ không hề kiểm. Đã kiểm định bằng
  cách phá code production (đổi `<` thành `>`) để chắc chắn test bắt được lỗi.
  Nay đã khớp nếp các test dọn dẹp khác trong repo (đều lùi ngày bằng `utimesSync`)
- [x] Sửa chú thích `MAX_PROMPT_CHARS` nói "provider không nhận nổi" - đó là
  suy đoán chưa đo. Ghi lại đúng bản chất: chính sách tự đặt, mốc tham chiếu là
  prompt 700 ký tự chạy tốt
- [x] Quét 12 lượt chạy toàn bộ test liên tiếp: không còn test chập chờn nào

### Trần thời gian: đo sai bản chất (2026-07-28)

User hỏi "prompt phức tạp mà ChatGPT tạo 3-4 phút thì sao". Đo lại bằng prompt
nặng (nhiều chữ phải render) và phát hiện mình đã chọn SAI PHÉP ĐO:

```
  1.1s  HEADER          1.8s  output_item.added
 14.7s  generating      (cách 12.9s)
 44.8s  keepalive       (cách 30.1s)
 74.7s  keepalive       (cách 29.9s)
104.7s  keepalive       (cách 30.0s)
132.7s  partial_image   (cách 28.0s)
135.0s  done
TỔNG 135.1s   -   KHOẢNG IM LẶNG DÀI NHẤT 30.1s
```

Prompt này mất 135 giây: đã vượt chỉ báo "đang nhập" (120s) và chỉ còn cách trần
180s có 45 giây. Nhưng quan trọng hơn là provider bắn `keepalive` ĐỀU MỖI 30
GIÂY, nên với stream thì im lặng mới là dấu hiệu chết, còn tổng thời gian dài
không nói lên điều gì. Trần tổng giết cả lượt vẽ khỏe lẫn kết nối chết như nhau.

- [x] `IMAGE_GEN_STALL_MS` = 90s (gấp 3 nhịp keepalive đo được): đây mới là thứ
  cắt kết nối chết. Vẽ 5 phút mà stream còn chảy thì cứ chạy
- [x] `IMAGE_GEN_TIMEOUT_MS` 180s -> 600s, đổi vai thành chốt chặn cuối cho ca
  bệnh lý (keepalive mãi không vẽ xong), không còn là thứ cắt lượt vẽ chậm
- [x] Chỉ báo "đang nhập" 2 phút -> 10 phút: phải phủ được lượt agent dài nhất
  hợp lệ, mà giờ đó là lượt vẽ ảnh
- [x] Câu báo "đợi khoảng 1 phút" -> "đợi 1-3 phút": đo thật 60s cho ảnh thường,
  135s cho trang nhiều chữ. Trần 180s cũ được đặt từ mẫu 4 lần đo toàn prompt
  đơn giản (63-69s) - mẫu quá hẹp
- [x] Dọn timer sau MỖI chunk: không dọn thì stream dài để lại hàng trăm timer
  sống, tiến trình không thoát được

### Ảnh bot vẽ xấu hơn ảnh tạo trên web (2026-07-28)

User so ảnh bot vẽ với ảnh tự tạo trên ChatGPT web, và hỏi có tham số kiểu
Instant/Medium/High như dropdown trên web không. Tìm ra HAI thứ khác nhau:

**Dropdown trên web KHÔNG phải chất lượng ảnh.** Đó là mức suy nghĩ của model
CHAT (tương đương `LLM_REASONING_EFFORT`, bot đang `medium`). Trên web có hai
model: model chat đọc yêu cầu rồi VIẾT RA prompt vẽ, model vẽ mới nhận prompt đó.

**Nhưng có tham số riêng cho ảnh mà bot chưa gửi: `quality`.**

- [x] `IMAGE_GEN_QUALITY` mặc định `high`. Đo A/B cùng prompt: giàu chi tiết hơn
  hẳn mà KHÔNG chậm hơn (50s so với 60s). Để chỉnh được bằng env vì nhà cung cấp
  thường tính phí cao hơn ở mức này

**Thử dạy model viết "brief thiết kế 5 mục" - SAI, đã gỡ bỏ.** Bản thử nghiệm
bắt model nêu khung hình + vị trí từng khối, dải màu chuyển sắc, phong cách,
mật độ, cỡ chữ, kèm ví dụ cụ thể. Prompt model viết ra dài hơn hẳn (810 ->
1818 ký tự) nên thoạt nhìn tưởng thành công.

User chấm ảnh và nói ngay ảnh cũ đẹp hơn, kèm câu hỏi đúng trọng tâm: *"gợi ý
cho model kiểu đưa nội dung bên trái bên phải thì các thiết kế sau bị ảnh hưởng
rồi sao, cái này bạn đang áp 1 cái design cho tất cả mà"*. Và hỏi có chắc model
vẽ không tự nghĩ thêm, hay chỉ là đoán.

Đo lại thì cả hai đều đúng:

- **Có thinking, và mình đã đoán sai.** `cx/gpt-5.5-image` KHÔNG phải model vẽ.
  Router bóc đuôi `-image` rồi gọi GPT-5.5 với `instructions: ""` + tool
  `image_generation` + `tool_choice: "auto"`. Có HAI model trong đường ống, cái
  thứ hai tự thiết kế
- **Prompt trần trụi cho kết quả TỐT HƠN.** Vẽ 3 lần chỉ với đúng câu người
  dùng gõ: ra 3 thiết kế khác hẳn nhau, đều dày dặn, GPT-5.5 còn tự nghĩ thêm
  cụm icon kèm chữ tiếng Việt không ai bảo. Brief chỉ trói tay nó và giết mất
  sự đa dạng
- **Mỗi ví dụ cụ thể trong mô tả tool = một khuôn mẫu áp lên mọi ảnh về sau.**
  Model chép gần nguyên văn cụm "tối giản, nhiều khoảng trống, không rối mắt"
  mình viết làm ví dụ

- [x] Gỡ sạch phần dạy thiết kế. `create-image-tool-description.ts` giờ chỉ giữ
  điều có LÝ DO CHỨC NĂNG: chữ chép nguyên văn (không thì ảnh ra chữ bịa), tỉ lệ
  nói trong prompt (API không có tham số kích thước), và TRUNG THÀNH với ý người
  dùng - họ không nói phong cách thì đừng tự bịa ràng buộc
- [x] Kiểm lại sau khi gỡ: prompt model viết còn 562 ký tự, không còn tự bịa
  màu/bố cục/mật độ nào; vẽ 3 lần ra 3 thiết kế khác nhau
- [ ] CHƯA nâng `LLM_REASONING_EFFORT` lên high: nó ảnh hưởng MỌI lượt chat chứ
  không riêng lúc vẽ, tốn token cho cả câu hỏi thường

**Bài học ghi vào đầu file mô tả tool:** gu thẩm mỹ của người viết code lọt vào
mô tả tool là mọi ảnh của mọi người dùng đều dính. Mô tả tool chỉ được nói điều
có lý do chức năng.

## V3.2 - Trace từng step agent (2026-07-28)

User phản ánh log sơ sài, bật `LOG_LEVEL=debug` cũng không thấy thêm gì, không
lần được model quyết định thế nào.

**Nguyên nhân trực tiếp:** `agent-loop.ts` không có MỘT dòng `log.debug` nào -
chỉ `info`/`warn`/`error`. Hạ log level không lộ thêm gì ở đúng chỗ cần.

**Nguyên nhân sâu hơn:** `onStepFinish` chỉ đọc `toolResults`. AI SDK v7 đưa ra
mỗi step cả `text`, `reasoningText`, `toolCalls` (model GỬI gì), `finishReason`,
`usage` riêng, `warnings` - bỏ hết. `warnings` đáng tiếc nhất: đó là chỗ nhà
cung cấp báo tham số bị âm thầm bỏ qua, đúng loại lỗi đã dính 2 lần (`size` bị
phớt lờ, `quality` không được gửi).

**Đo trước khi hứa:** phần "model suy nghĩ" phụ thuộc MODEL chứ không phải code.

| Model | Không stream | Có stream |
|---|---|---|
| `cx/gpt-5.6-sol` (đang dùng) | không có gì | 1 dòng nhãn tóm tắt |
| `ds/deepseek-v4-pro` | đầy đủ + `reasoning_tokens` | đầy đủ |

OpenAI cố tình không phơi chain-of-thought. Muốn soi model nghĩ gì thì đổi sang
DeepSeek, không phải sửa code.

- [x] `agent-step-trace.ts` (thuần, không env/DB): gói một step thành bản ghi,
  cắt ngắn KÈM ĐỘ DÀI THẬT (cắt lén thì không biết đang mất 50 hay 50.000 ký tự)
- [x] `agent-trace-store.ts` + bảng `agent_steps` nối qua `agent_turns.id`
- [x] `log.debug` từng step trong agent-loop
- [x] `/api/traces` (chỉ ĐỌC - trace là bằng chứng, sửa được thì hết giá trị)
- [x] Tab "Trace agent" trong drawer Sessions: cảnh báo hiện lên trước, rồi
  reasoning, model nói, tool gọi kèm tham số, tool trả về
- [x] Dọn theo `AGENT_TRACE_RETENTION_DAYS` cùng nhịp dọn media
- [x] Trace gom NGOÀI `runOnce` để lượt retry (glitch router, fallback bỏ ảnh)
  nối vào cùng một trace - hỏng mới là lúc cần nhìn đủ cả hai lần chạy

**Vì sao SQLite chứ không Langfuse/OpenTelemetry:** trace chứa nguyên văn tin
nhắn của người thật. Đẩy lên SaaS là đẩy hội thoại của họ ra khỏi máy - quyết
định về quyền riêng tư, không phải kỹ thuật. Tự nuôi Langfuse cần cả Postgres
lẫn ClickHouse, nặng hơn cả con bot.

**Đặt trong drawer Sessions là SAI - user đi tìm không thấy.** Bản đầu chỉ có
tab Trace bên trong drawer, tức chôn sâu 3 lớp (Sessions -> bấm hội thoại -> đổi
tab) mà không có gợi ý nào ở ngoài. Người dùng duy nhất của tính năng chẩn đoán
này là chủ bot, mà chủ bot không tìm ra thì coi như không có.

- [x] Thêm trang `/trace` riêng ở sidebar (nhóm Hệ thống), gộp lượt của MỌI hội
  thoại - bấm một cái là thấy, không phải nhớ lỗi xảy ra ở hội thoại nào
- [x] `getRecentTurnsAllThreads` dùng INNER JOIN sang agent_steps: chỉ liệt kê
  lượt CÓ trace, lượt không trace mà lên danh sách thì bấm vào rỗng
- [x] Tách `trace-step-card.tsx` dùng chung cho cả trang và drawer, không chép đôi

### Log toàn hệ thống ghi ra file + trang Logs (2026-07-28)

User hỏi tiếp "còn log thì sao, log toàn hệ thống á, hiện tôi chưa thấy". Kiểm
tra thì đúng là **không có log nào tồn tại ngoài terminal**: pino chỉ ghi ra
stdout, không có file nào, không có trang nào xem. Đóng terminal là mất sạch;
trên VPS thì không còn gì để lần lại khi có sự cố lúc 3 giờ sáng.

Trace ở trên chỉ bao phủ lượt agent - không có gì về kết nối Zalo, login QR,
định tuyến tin, hay lỗi của 30 scope khác.

- [x] `pino-roll`: ghi `data/logs/bot.<ngày>.log`, xoay vòng mỗi ngày, giữ
  `LOG_FILE_KEEP_DAYS` file
- [x] HAI target với HAI mức khác nhau: terminal theo `LOG_LEVEL` (cần gọn để
  đọc lướt), file ở mức `trace` nhận hết kể cả debug (cần đủ, vì lúc cần tới nó
  là sự cố đã xảy ra rồi, không quay ngược lại bật debug được). Mức GỐC của
  logger phải hạ xuống `trace`, không thì dòng debug bị chặn ngay từ đầu và
  target file không bao giờ nhận được
- [x] `read-log-file.ts` (thuần, nhận thư mục qua tham số): lọc theo mức/scope/
  chữ, chỉ đọc 4MB cuối mỗi file, dòng JSON hỏng thì bỏ qua chứ không chết trang
- [x] `/api/logs` + trang Logs ở sidebar, có ô lọc mức, lọc scope (danh sách
  scope lấy từ chính log, không hardcode), tìm chữ, bung xem trường phụ
- [x] Test tắt ghi file (`LOG_FILE_ENABLED: false` trong `test-env-setup`): mỗi
  file test sẽ đẻ một worker pino-roll và một file, tốn công mà chẳng ai đọc

**Vì sao file chứ không SQLite:** ban đầu suýt lập luận "log volume cao nên
SQLite chậm" - sai, bot cá nhân vài tài khoản thì volume rất thấp. Lý do thật là
ĐỘ BỀN của chính đường ghi log: log là thứ tuyệt đối không được hỏng, vì lúc cần
nó nhất là lúc mọi thứ khác đang hỏng. Ghi file không phụ thuộc DB.

### Nghiệm thu trên dashboard thật + 5 lỗi tự tìm ra (2026-07-28)

User đăng nhập giúp nên xem được giao diện chạy thật. Kiểm chứng đủ: trang Logs
lọc mức/scope/tìm chữ đều chạy, ô scope tự lấy 11 scope từ file; trang Trace bung
ra thấy 5 step, 6 lệnh `web_search` song song kèm đúng tham số, step cuối `stop`
kèm MODEL NÓI. Xác nhận `reasoning: ""` đúng như đã đo về `gpt-5.6-sol`.

Quét file log thật: **không lộ secret nào** (0 khớp `sk-*`, `AIza*`, cookie Zalo,
`Bearer`, password), `data/` đã gitignore, phình ~950 KB/ngày tức 6.5 MB cho 7 ngày.

Năm lỗi tìm được và đã sửa:

- [x] **`heartbeat` chiếm 32% log** - hệ quả trực tiếp của việc cho file ghi
  debug. Comment cũ ghi "debug level để prod không noise", giả định đó vỡ. Giãn
  từ 1 phút lên 15 phút (96 dòng/ngày thay vì 1440) và cho scope riêng để lọc ra
- [x] **7 dòng log trong `index.ts` không có scope** (khởi động, tắt,
  `uncaughtException`) - badge trống và KHÔNG LỌC ĐƯỢC, đúng lúc cần nhất. Đặt
  scope `bootstrap`
- [x] **Đọc log nuốt cả tuần mỗi lần vào trang**: parse toàn bộ 6.5 MB chỉ để
  trả 200 dòng. Giờ đi từ file mới nhất về cũ và DỪNG khi đủ; trả thêm
  `filesRead` để biết kết quả trải bao nhiêu ngày
- [x] **Cuộn trang Trace bị khung con nuốt**: mỗi khối kết quả có `overflow-auto`
  riêng nên con lăn bị khối dưới con trỏ bắt, phải rê ra lề mới cuộn được trang
  (tự vấp lúc kiểm tra). Đổi sang cắt chiều cao + nút "Xem đầy đủ", bỏ hẳn khung
  cuộn lồng nhau. Kiểm chứng trên trang thật: 0 khung cuộn con, 23 nút bung
- [x] **Đánh số step từ 0** (theo AI SDK) đọc lạ. Đổi ngay tại `summarizeStep`
  để log, DB và giao diện cùng một con số - đổi ở riêng giao diện thì đọc log lại
  lệch một đơn vị

- [ ] Các dòng trace ĐÃ LƯU trước lúc sửa vẫn đánh số từ 0, hiện lệch 1 so với
  dòng mới. Tự hết sau `AGENT_TRACE_RETENTION_DAYS` ngày

### Dạy model kể tiến trình - lấp chỗ trống "thinking" (2026-07-28)

User xem trang Trace xong vẫn thấy thiếu: muốn thấy kiểu "dùng tool search xong
thì model bảo có đủ thông tin để phân tích chưa, lấy bao nhiêu nguồn, các bước
làm như nào" - tức là LỜI DẪN giữa các bước, không phải chain-of-thought ẩn.

Chẩn đoán: bot đang gọi tool CÂM LẶNG - trace các lượt cũ cho thấy step chỉ có
tool call, `text` rỗng. Claude Code có lời dẫn vì được dạy nói trước khi làm;
đây là thứ dạy được qua prompt, không phụ thuộc model có phơi reasoning hay không.

Đo trước khi sửa (gọi thật gpt-5.6-sol với quy tắc kể tiến trình trong system):
- Step 1: "Cần giá vàng SJC hôm nay theo thời gian thực - mình tra nguồn cập
  nhật mới nhất trước." + 2 tool call
- Step 2 (sau khi tool trả về): "Kết quả tìm kiếm chưa xác nhận đúng ngày hôm
  nay - mình kiểm tra lại bảng giá chính thức và thời điểm cập nhật." + 3 tool call
- Câu hỏi không cần tool ("chào bạn"): trả lời thẳng, KHÔNG kể lể

- [x] Thêm "Quy tắc kể tiến trình" vào BASE_PERSONA: một câu trước mỗi lần gọi
  tool, một câu nhận xét sau khi tool trả về; câu trả lời chốt không được kèm
- [x] An toàn sẵn có: chỉ text của step CUỐI được gửi cho người dùng
  (result.text của generateText), text các step giữa chỉ vào trace + log
- [x] Không sửa gì ở trace UI - khối "Model nói" đã hiển thị step.text sẵn,
  trước giờ nó rỗng vì model không nói gì

- [ ] Chưa test Zalo thật: restart bot, nhắn câu cần tra cứu rồi mở trang Trace
  xem các khối "Model nói" giữa các step

### Bốn lỗ hổng harness tìm ra khi đối chiếu với hermes-agent (2026-07-29)

Sau khi dạy model kể tiến trình, đi rà lại toàn bộ harness và đọc chéo
`zalo-agent-references/hermes-agent`. Bốn thứ đã sửa, tất cả đều đo trước khi sửa.

**1. Lỗi tool vô hình hoàn toàn (nghiêm trọng nhất)**

AI SDK v7 để tool chạy lỗi ở `content` dạng `tool-error`; getter `toolResults`
chỉ lọc `type === "tool-result"` nên luôn rỗng khi tool hỏng. Cả dòng log "Tool
đã chạy" lẫn `summarizeStep` đều duyệt `toolResults` - tức là **mù cả lớp sự
kiện tool thất bại**. Đo thật với ai@7.0.37: tool ném exception cho ra
`toolResults.length === 0`, `content` có `tool-call, tool-error`.

Ca hỏng: người dùng dán bài 4500 ký tự nhờ làm e-magazine, schema chặn ở 4000.
Log trống, trace hiện "Gọi tool: create_image" rồi cụt (nhìn y hệt lượt đang
chạy dở), model vẫn nhận lỗi nên thử lại 2-3 vòng. Nhìn từ ngoài: bot hứa vẽ,
không có ảnh, token tăng. **Đây chính là gốc của phàn nàn "log ghi ít và sơ sài".**

- [x] `RawStep` nhận thêm `content`; `summarizeStep` nhặt `tool-error` ra `toolErrors`
- [x] `loiThanhChuoi` riêng: `message` của Error là non-enumerable nên
  `JSON.stringify(err)` ra `{}` - đúng thứ cần đọc lại là thứ bị mất
- [x] Cột `tool_errors` (ALTER, mặc định `'[]'`) + khối đỏ đặt TRƯỚC mọi khối
  khác trong `trace-step-card.tsx` - tool hỏng là kết cục của step, đọc trước
- [x] Log riêng mức ERROR "Tool chạy lỗi" (việc đã hỏng, không phải chẩn đoán)
- [x] Vá `forLog`: `JSON.stringify(undefined)` trả undefined, đọc `.length` là
  TypeError, mà hàm chạy trong `onStepFinish` nên nó giết cả lượt

**2. Log rò system prompt và ảnh base64**

Bộ serialize mặc định của pino chép MỌI thuộc tính enumerable của error;
`APICallError` gắn thẳng `requestBodyValues` = nguyên body đã gửi. Đo thật: lỗi
429 giả với ảnh 200 KB -> dòng log lẽ ra ~270.000 ký tự, có đủ system prompt và
chuỗi base64. Sidecar chạy Gemini free tier nên 429 là chuyện thường ngày.
Chưa nổ thật (log hôm 28/07 chưa có `requestBodyValues`) - sẽ nổ ở lần 4xx đầu tiên.

Kèm hai tác hại: `readRecentLogs` chỉ lấy 4 MB cuối file nên một dòng khổng lồ
làm cả ngày log biến mất khỏi dashboard; log xoay vòng chỉ giới hạn theo SỐ NGÀY.

- [x] `safe-error-serializer.ts` dùng DANH SÁCH CHO PHÉP, không phải danh sách
  cấm - bản SDK sau thêm trường mới chứa body thì cách cấm sẽ âm thầm để lọt
- [x] Đo lại qua transport thật: dòng log 385 ký tự, không lọt ảnh, không lọt
  prompt, vẫn giữ `statusCode` + `message` + `stack`

**3. Chạm trần step gửi câu tường thuật làm câu trả lời**

`stopWhen: stepCountIs(n)` cắt ngang khi model vẫn đang gọi tool, và
`result.text` là text của step CUỐI. Từ lúc persona dạy kể tiến trình, text đó
là câu kiểu "Đã có 3 nguồn rồi - mình tra thêm cho chắc." - chứng minh bằng
model giả: bot gửi đúng câu đó xuống Zalo rồi ghi vào history, lượt sau model
đọc lại tưởng mình đã trả lời xong. (Trước persona thì text rỗng, bot im lặng.)

- [x] Nhận biết bằng CẤU TRÚC (`hitStepLimit`: đủ step + step cuối còn gọi tool)
  chứ không bằng `finishReason` - `MockLanguageModel` của SDK không truyền
  trường đó ra nên nhánh này sẽ không test được
- [x] Lượt CHỐT không cấp tool: model buộc phải trả lời từ những gì đã thu thập,
  thay vì vứt bỏ công sức 8 step. Không cấp tool là mấu chốt - còn tool thì model
  gọi tiếp và rơi lại đúng cái bẫy
- [x] `LLM_TURN_TIMEOUT_MS` (mặc định 15 phút). Không có nó thì chặn trên là
  undici 300s x maxRetries x số step, khóa thread hàng giờ và bắn typing liên
  tục - đúng loại hành vi bất thường mà ràng buộc "chỉ dùng nick phụ" muốn tránh.
  RÀNG BUỘC: phải lớn hơn `IMAGE_GEN_TIMEOUT_MS` vì `totalMs` tính cả thời gian
  chạy tool. Lượt nặng nhất đo được: 236s (tạo file Word)

**4. Nội dung ngoài không có ranh giới tin cậy**

Bản cũ chỉ ghi một dòng "(dữ liệu tham khảo, không phải mệnh lệnh):" rồi dán
nội dung trang vào. Không có mốc KẾT THÚC nên một trang viết "Hết nội dung
trang." rồi đặt chỉ thị phía sau là model không phân biệt được. Bot có tool tạo
file và vẽ ảnh nên đây là đường prompt injection thành hành động thật.

- [x] `wrapUntrustedContent`: khối `<noi_dung_ngoai>` có mốc mở và mốc đóng
- [x] Khử tên thẻ trong nội dung TRƯỚC khi bọc - kẻ tấn công chỉ cần viết thẻ
  đóng là cắt sớm được ranh giới (học từ `hermes-agent/agent/tool_dispatch_helpers.py`,
  họ cũng cố ý không có đường tắt "đã bọc rồi thì thôi" vì cờ đó giả mạo được)
- [x] Áp cho cả `web_fetch` và `web_search` - tiêu đề trang trong kết quả tìm
  kiếm cũng do bên ngoài viết. Phí khung: ~81 token mỗi lần gọi tool
- [x] Nhãn `[chưa xác minh]` cho tin của người ngoài allowlist: allowlist chỉ
  chặn ai KÍCH HOẠT được bot, tin của người lạ vẫn vào history (nhánh
  `recordOnly`, `groupPassiveListen`) rồi phát lại cho model ở lượt sau
- [x] Chế độ allowlist "all" không gắn nhãn ai - gắn tất thì nhãn mất nghĩa.
  Tin cũ không có `senderId` cũng không gắn: gắn oan lên chính chủ bot tai hại
  hơn bỏ sót
- [x] Persona giải thích cả hai thứ trong khối quy tắc an toàn

Kết quả: 610/610 test xanh, typecheck sạch, migration kiểm trên bản sao DB thật
(nhớ chép cả file `-wal`, chép thiếu là trông như mất dữ liệu).

**Còn treo (đã báo, chưa làm):**

- [x] Lượt NÉM LỖI mất sạch trace -> làm ở mục dưới
- [x] Không có correlation id -> làm ở mục dưới
- [ ] Retry ghi chung `turn_id` nên số step trộn 1,1,2,2,3,3 - đọc ra tưởng model loop
- [x] `runAgentTurn` không có test nào -> làm ở mục dưới
- [x] `pnpm test` ghi rác vào log production -> làm ở mục dưới
- [x] Persona nền vẫn dạy luật của tool ĐÃ TẮT -> làm ở mục dưới
- [x] `cachedTokens` -> đã đọc lại source, chính ghi chép này SAI (xem mục dưới)

### Đưa cấu hình từ .env lên dashboard (2026-07-29)

User hỏi số bước sửa ở đâu trên web. Kiểm ra: API `PATCH /api/agents` CÓ nhận
`maxSteps` và kiểu bên web cũng có, nhưng **ô nhập chưa bao giờ được làm** - giao
diện không bao giờ gửi trường đó. Yêu cầu tiếp theo: "cái nào đưa lên được thì
đưa lên hết, giờ ít ai mở env để cấu hình lắm".

Rà 29 tham số: tất cả đều đọc LẠI mỗi lần dùng (trong hàm hoặc làm tham số mặc
định), không cái nào là hằng số lúc nạp module - nên đổi nóng ăn ngay.

- [x] `tuning-definitions.ts`: registry mô tả từng tham số (nhãn, gợi ý, nhóm,
  khoảng cho phép). MỘT nguồn sự thật cho giá trị lúc chạy, ràng buộc khi lưu, và
  giao diện - thêm tham số mới chỉ sửa một file, không đụng route lẫn web
- [x] `runtime-tuning-settings.ts`: DB đè env, đọc lại mỗi lần gọi. Cache ở đây
  là quay về đúng vấn đề cũ. Giá trị hỏng trong DB rơi về env thay vì giết bot
- [x] Thay 47 chỗ đọc `env.X` trong 19 file sang `getTuning(...)`
- [x] `/api/tuning` GET trả cả định nghĩa lẫn giá trị; PUT chặn key bịa (rác vĩnh
  viễn trong `runtime_settings`), chặn ngoài khoảng, và không ghi gì khi một ô sai
- [x] Trang Cấu hình dựng từ registry; ô nào đang lấy từ `.env` có nhãn riêng và
  nút trả về mặc định
- [x] Ô sửa agent: thêm **Số bước tối đa** và **Mức suy nghĩ** (cột
  `agents.reasoning_effort`, để trống = theo mức chung). `resolveReasoningEffort`
  là chỗ duy nhất quyết định mức hiệu lực

**Hai lỗi tự tìm ra trong lúc làm, đều nhờ test:**

1. Ràng buộc chéo áp cho MỌI lần lưu khiến một cấu hình sẵn có đã lệch sẽ chặn
   hết, **khóa cứng cả trang Cấu hình** và không còn đường sửa lại. Dính ngay ở
   môi trường test (hạ `LLM_MAX_OUTPUT_TOKENS` xuống 2048 nên luật trần tài liệu
   luôn nổ). Sửa: mỗi luật khai rõ nó liên quan ô nào, chỉ áp khi ô đó đang đổi.
2. Bảy file test vỡ với `EPERM` khi xóa thư mục tạm: các module này giờ mở SQLite
   (vì đọc cấu hình chỉnh-nóng) mà test không đóng kết nối. Sửa bằng
   `closeDatabase()` trước `cleanupTestEnv`, theo đúng nếp các test khác.

- [ ] Chưa xem được giao diện trang Cấu hình: dashboard cần mật khẩu

## Backlog - Không làm vội (ghi lại để khỏi quên)

- Bóc nội dung bằng Defuddle/Readability thật (thêm dependency) nếu heuristic
  link-density bắt đầu hụt với các trang khác
- Per-thread tool allowlist dựa trên nhóm read/action đã có sẵn trong registry

## V2 còn lại - Khi cần

- [x] ~~`src/scheduler/` - nhắn chủ động theo lịch (nhắc hẹn, báo cáo)~~ - xem
  mục V3.3: code + test xong, CHƯA nghiệm thu trên Zalo thật
- [ ] `src/knowledge/` - RAG/knowledge base trả lời theo tài liệu riêng
- [ ] Lệnh điều khiển trong chat (/bot off, /clear) - thêm file trong middleware/
- [ ] Voice message STT - thêm bước trong zalo-message-parser
- [ ] `src/mcp/` - expose MCP server cho Claude Code điều khiển bot
- [ ] Deploy VPS (Docker + Caddy theo pattern ship-to-vps) - dashboard đứng sau Caddy

## V3 - Không làm (quyết định có chủ đích)

- Gửi tin hàng loạt / campaign CRM: tỉ lệ khóa nick cao nhất
- Tool chuyển tiền/thanh toán nối vào agent: rủi ro prompt injection
- Kênh Facebook (fbchat-v2): chờ Zalo ổn định đã

### Dọn 5 mục treo về quan sát và test (2026-07-29)

User yêu cầu kiểm chứng lại 5 mục treo bằng CODE thay vì tin ghi chép. Kiểm xong
thì cả 5 đều đúng là chưa làm, nhưng **hai mục có số liệu sai** trong chính tài
liệu này - đủ để thấy ghi chép không thay được lần đọc code:

- Mục log rác ghi "17/64 file". Số thật: 19/68 file thiếu `setupTestEnv`, nhưng
  chạy riêng từng file thì chỉ **2 file** thật sự chạm tới `data/logs/`. Bộ dò
  tĩnh đếm nhầm vì không phân biệt `import type` (bị xóa lúc chạy) - chính tôi
  cũng dính bẫy đó ở vòng đầu và phải đo lại bằng cách chạy thật.
- Mục trace lượt lỗi thiếu một nửa hậu quả: `recordAgentTurn` cũng nằm trên
  đường thành công, nên lượt hỏng mất CẢ dòng `agent_turns` lẫn số token.

**1. Lượt agent mở trước, chốt sau (`openAgentTurn`/`finishAgentTurn`)**

Đổi từ "ghi row sau khi lượt xong" sang "mở row trước khi lượt chạy". Một thay
đổi gỡ luôn hai mục treo: có id từ trước thì nhánh lỗi có chỗ gắn trace, và mọi
dòng log mang được `turnId`.

Đo trên bản sao DB thật trước khi làm (chép cả `-wal`):
- Schema nhận `INSERT` chỉ 2 cột - mọi cột số có `DEFAULT 0`
- Lượt lỗi giờ hiện trên trang Trace: `turn 66 | 0 token | 2 step`
- Row mồ côi (process bị kill giữa lượt) KHÔNG lên trang Trace - `recentAllStmt`
  vốn đã `JOIN agent_steps` chứ không `LEFT JOIN`, hàng phòng thủ có sẵn từ trước
- Giá: 2.1ms INSERT + 1.9ms UPDATE cho một lượt dài hàng chục giây
- Chỗ lệch duy nhất: Overview đếm row mồ côi thành 1 lượt 0 token. Chấp nhận -
  DB thật đang có sẵn 4 row 0-token không trace (lượt glitch cũ) và không ai vướng

- [x] `trace` do CALLER sở hữu, truyền vào `runAgentTurn` thay vì trả về. Trước
  đây nó là biến cục bộ nên throw là rơi theo stack; giờ nhánh `catch` còn đủ
  những step đã chạy
- [x] `log.child({ accountId, threadId, turnId })` ở cả `agent-loop` lẫn
  `message-turn-processor` - gắn một lần thay vì chép tay vào từng lời gọi
  (chép tay là sớm muộn cũng có dòng thiếu, mà dòng thiếu hay rơi đúng nhánh lỗi)

**2. Test cho `runAgentTurn` (10 test mới)**

Thêm seam `resolveModel` để tiêm model giả - đúng nếp đã có với
`persistBatchImages` (tiêm downloader) và `web-search-providers` (tiêm fetch).

Phủ: lượt thường, retry khi router trả rỗng, rỗng 2 lần, trace nối qua cả 2 lần
chạy, chạm trần step (khẳng định lượt chốt KHÔNG được cấp tool), lượt chốt cũng
lỗi, 4xx với lượt đính pixel thì dựng lại input không pixel, 401 KHÔNG kích hoạt
bỏ pixel, và lượt ném lỗi vẫn giữ trace.

Hai thứ chỉ lộ ra khi viết test:
- `usage` của `LanguageModelV4` là cấu trúc LỒNG (`inputTokens.total`), không
  phải ba số phẳng như `result.totalUsage`. Dựng sai tầng thì mọi số về 0 và lượt
  hợp lệ bị chấm nhầm là glitch router
- Không import được `@ai-sdk/provider` để lấy kiểu (pnpm layout chặt, nó không
  phải dependency trực tiếp) - suy kiểu từ chính mock bằng `Parameters<...>`

**3. Test không còn ghi vào `data/logs/` production**

Bằng chứng trước khi sửa: chuỗi fixture `"mạng rớt"` của `message-receipts.test.ts`
nằm 30 dòng trong log thật (19 dòng hôm 28/07, 11 dòng hôm 29/07).

- [x] `message-receipts.test.ts`: import động sau `setupTestEnv`
- [x] `html-to-text.test.ts`: sửa GỐC thay vì thêm `setupTestEnv`. Nó tạo file
  log vì đi mượn `stripHtmlTags` từ `web-search-providers.ts` (module gọi mạng,
  có logger) - cạnh phụ thuộc ngược chiều. Chuyển hàm về `html-to-text.ts` (đúng
  nhà: đây LÀ module "HTML -> chữ"), giờ nó thuần và import tĩnh được
- [x] Kiểm lại bằng cách chạy RIÊNG từng file trong 19 file thiếu `setupTestEnv`:
  không file nào còn tạo file log

**4. Luật tool chỉ vào prompt khi tool đang bật**

Theo `hermes-agent/agent/system_prompt.py` ("Tool-aware behavioral guidance: only
inject when the tools are loaded"): chữ luật để ở module prompt riêng
(`persona-tool-rules.ts`), gate bằng tên tool lúc ghép. KHÔNG gắn vào
`tool-registry.ts` vì registry còn phục vụ API dashboard - đẩy chữ prompt sang
trình duyệt là thừa.

Đo bằng chính `buildSystemPrompt`, trên BẢN SAO cấu hình thật (không phải env
test - khác biệt quan trọng vì env test chưa cấu hình endpoint vẽ ảnh nên
`create_image` bị `available()` loại, cho ra số đẹp hơn thực tế):

**3186 ký tự** trong `BASE_PERSONA` chuyển từ luôn-có-mặt sang có-điều-kiện
(4951 -> 1765). Phần đó vào prompt hay không giờ tùy tool nào đang bật:

| Trạng thái tool | Prompt |
|---|---|
| Bật đủ 12/12 (trạng thái hiện tại của `acc-chinh`) | 6600 - KHÔNG đổi |
| Tắt Vẽ ảnh AI | 5566 (bớt 1034 mỗi lượt) |
| Tắt 2 tool tạo file | 6149 (bớt 451) |
| Tắt hết tool | 2204 (bớt 3186 + phần "Khả năng") |

Nói thẳng: máy đang bật đủ 12 tool nên hôm nay KHÔNG tiết kiệm được token nào -
đây là sửa tính đúng đắn (prompt không còn dạy thứ model không nhận được) chứ
chưa phải khoản lời. Lợi ích hiện ra ngay khi tắt bất kỳ tool nào, hoặc chạy
account chưa cấu hình endpoint vẽ ảnh / sidecar đọc ảnh.

- [x] Một lần lọc `listAvailableTools` dùng cho CẢ mục "Khả năng" lẫn khối luật -
  hai nơi tự lọc riêng là sớm muộn cũng lệch
- [x] Test đối chiếu mọi key trong luật với registry: đổi tên tool mà quên sửa
  thì đỏ ngay, không âm thầm mất luật
- [x] Đường gọi không có account giờ fail-closed (không dạy luật tool nào) -
  không biết tool nào bật thì đừng đoán. Production luôn truyền account
- [x] Luật KHÔNG phụ thuộc tool (cấm chuyển tiền, ranh giới `<noi_dung_ngoai>`,
  nhãn `[chưa xác minh]`, không markdown) còn nguyên kể cả khi tắt sạch tool

Kết quả: 656/656 test xanh (thêm 20), typecheck sạch.

**Nghiệm thu trên Zalo thật (2026-07-29 22:38, lượt 65)**

User nhắn một câu cần tra cứu. Lượt chạy 3 step, 61.123 token, 28 giây:

- [x] `turnId=65` bám suốt từ dòng "Xử lý lượt tin nhắn" (scope `message-turn`)
  qua cả 10 dòng của `agent-loop` tới "Hoàn thành lượt agent" - đúng thứ mục
  correlation id cần
- [x] `agent_turns` id=65 chốt đúng 61.123 token / 3 step, và 3 dòng `agent_steps`
  khớp từng step (get_datetime+web_search x2 -> web_fetch x3 -> stop)
- [x] Trang Trace hiện "29/07 22:38 - 3 step - 61.123 token" ngay đầu danh sách

Hai thứ phát hiện khi nghiệm thu, chưa xử lý:

- [ ] **Log của TOOL chưa mang `turnId`**: đo trong lượt 65 thì 11 dòng có
  (`message-turn` 1, `agent-loop` 10) và 3 dòng KHÔNG (`web-fetch`). Các module
  tool tự tạo logger riêng (`web-fetch-tool`, `create-image-tool`,
  `create-document-tools`, `web-search-providers`, `jina-reader-fallback`) nên
  không nhận child logger của lượt. Muốn phủ nốt phải luồn `turnId` qua
  `ToolContext` xuống từng tool
- [ ] **`created_at` đổi nghĩa**: giờ là lúc lượt BẮT ĐẦU (mở row) chứ không còn
  là lúc lượt xong. Lượt 65 ghi 22:38:01 trong khi kết thúc 22:38:29. Không ảnh
  hưởng trang Trace (vẫn cùng phút) nhưng lượt vắt qua nửa đêm sẽ được
  `getDailyUsage` xếp vào ngày BẮT ĐẦU thay vì ngày kết thúc

- [ ] Chưa nghiệm thu nhánh LƯỢT LỖI trên Zalo thật (cần provider chết giữa lượt
  mới dựng được) - hiện chỉ có test bằng model giả

### Dọn nốt ba mục treo còn lại (2026-07-29)

**1. `turnId` bám cả log của TOOL, không chỉ agent-loop**

Nghiệm thu lượt 65 lộ ra lỗ: 11 dòng có `turnId`, 3 dòng không - chúng đến từ
`web-fetch-tool` vốn tự tạo logger riêng. Child logger chỉ phủ được module nào
cầm đúng cái logger đó, mà còn 5 module như vậy và mỗi tool mới thêm sau lại là
một chỗ nữa dễ quên.

Cách còn lại là luồn `turnId` qua chữ ký hàm xuống từng module, nhưng
`searchWeb(query, opts)` và `fetchViaJina(url)` không có việc gì với "lượt" -
thêm tham số vào đó là bôi bẩn API để phục vụ chuyện log.

- [x] `shared/turn-log-context.ts`: AsyncLocalStorage giữ
  `{accountId, threadId, turnId}`, sống sót qua await
- [x] `logger.ts` đọc nó trong `mixin` -> MỌI dòng log trong lượt tự có, không
  module nào phải biết gì
- [x] Bỏ luôn child logger vừa thêm ở `agent-loop` và `message-turn-processor` -
  mixin làm rồi, giữ cả hai là hai cơ chế cho cùng một việc
- [x] Bỏ `turnId` khỏi `AgentTurnParams`: agent-loop không còn cần nó
- [x] Test: ngữ cảnh sống qua nhiều tầng await, hai lượt chạy xen kẽ KHÔNG lẫn
  id của nhau (ca mà biến module sẽ sai), lỗi ném ra không để sót ngữ cảnh

**Lỗi tự gây ra trong lúc làm mục này, lọt ra tận lượt thật (66)**

Bản đầu để `mixin: () => currentTurnLogContext() ?? {}` - trả THẲNG object trong
AsyncLocalStorage. Nghiệm thu lượt 66 thấy dòng `web-fetch` mang 28 trường, gồm
cả `text`, `reasoning`, `toolResults` của những dòng trước đó trong lượt.

Gốc: `defaultMixinMergeStrategy` của pino (`lib/proto.js:203`) làm
`Object.assign(mixinObject, mergeObject)` - nó ghi đè vào chính object mixin trả
về. Trả object dùng chung thì mỗi lần log lại nhét trường của nó vào đó vĩnh viễn,
tích lũy suốt lượt.

Hai tác hại, cái sau nặng hơn: log phình rác, và nội dung tin nhắn của người thật
rò sang những dòng chẳng liên quan - trong khi `readRecentLogs` chỉ đọc 4MB cuối
nên dòng phình ăn mất cửa sổ đọc của cả ngày (đúng lỗi đã trị ở mục
`safe-error-serializer`, tái diễn theo đường khác).

- [x] Vá bằng `mixin: () => ({ ...currentTurnLogContext() })`
- [x] `logger-turn-fields.test.ts` - file test DUY NHẤT bật ghi log ra file, vì
  chính dòng ghi ra file mới là thứ cần kiểm. Đã xác nhận test bắt được lỗi:
  2/2 ĐỎ khi gỡ bản vá, 2/2 XANH khi có

**2. Cột `attempt` - số step không còn trộn khi chạy lại**

Lượt retry (router trả rỗng) hay lượt dựng lại không kèm pixel đều đánh số step
lại từ 1, nên trace một lượt ra 1,2,3 rồi 1,2,3 - xếp theo `step_number` đọc
thành 1,1,2,2,3,3, trông y hệt model đang lặp vô hạn.

- [x] `agent_steps.attempt` (ALTER, mặc định 1 nên dòng cũ vẫn hợp lệ),
  `summarizeStep(step, maxChars, attempt)`, sắp xếp theo `attempt` trước
- [x] Lượt CHỐT (khi chạm trần step) tính là một lần chạy riêng
- [x] Badge "chạy lại lần N" trên `trace-step-card`, chỉ hiện khi attempt > 1 -
  dán "lần 1" lên mọi step chỉ làm nhiễu

**3. Nhận định về `cachedTokens` trong ghi chép này SAI**

Mục treo cũ viết: "executor `cx/` của 9Router không trích usage. Comment trong
`agent-loop.ts` đang suy luận sai". Đọc lại source thì **ngược lại**:
`translator/response/openai-responses.js:472` CÓ đọc
`input_tokens_details.cached_tokens` rồi truyền vào `buildUsage`.

Chỗ nhầm là lấy kết luận đúng về `reasoningTokens` (dòng 474 gọi `buildUsage`
mà KHÔNG truyền `reasoningTokens` - vẫn đúng) rồi suy rộng sang cache.

Sự thật nằm ở `translator/concerns/usage.js:5`: `buildUsage` chỉ thêm
`prompt_tokens_details` khi giá trị **> 0**. Nên "upstream báo 0 lần trúng" và
"upstream không báo trường này" về tới client giống hệt nhau.

- [x] Comment trong `agent-loop.ts` viết lại cho đúng: `> 0` là bằng chứng chắc
  chắn cache trúng; `= 0` KHÔNG kết luận được gì, phải soi dashboard 9Router

Bài học: một kết luận đã kiểm chứng cho trường A không tự động đúng cho trường B
ở cùng dòng code. Lượt 65 thật đo được `cachedTokens: 0` trên 60.340 token input -
theo nhận định cũ thì "router không trích nên bỏ qua", theo sự thật thì đây là
tín hiệu đáng đi kiểm tra prompt cache có trúng không.

## V3.3 - Lịch hẹn: bot tự nhắn theo lịch, once/every/cron (2026-07-31, plan: plans/260731-0042-lich-hen-nhan-chu-dong/)

Tính năng rủi ro khóa nick cao nhất dự án từng làm: bot tự nhắn tin mà không có ai
chủ động hỏi trước. Research trước khi làm: đọc source `hermes-agent/cron/`
(scheduler.py, jobs.py, executions.py, lifecycle_guard.py, tools/cronjob_tools.py)
và `goclaw/internal/cron/` (service.go, service_execution.go, retry.go). Thiết kế
đầy đủ ở `plans/260731-0042-lich-hen-nhan-chu-dong/reports/thiet-ke-scheduler.md`,
triển khai qua 5 phase - phase vòng chạy/gửi tin (chạm thẳng đường gửi tin thật +
concurrency) qua 4 vòng review liên tiếp trước khi sạch.

- [x] **Nền tảng giờ** (`src/shared/zone-time.ts`, luxon): quy đổi giờ tường VN
  <-> UTC. Vá kèm 3 chỗ tính "hôm nay" theo ngày UTC phát hiện lúc rà timezone
  (`overview-stats.ts`, `usage-store.ts::getDailyUsage`, frontend
  `overview-page.tsx`) - đo trên DB thật: xem dashboard 09:00 sáng giờ VN, công
  thức cũ đếm 0 tin "hôm nay", công thức mới đếm đúng 2 tin
- [x] **Lưu trữ + ngữ nghĩa lịch**: 2 bảng `scheduled_jobs`/`scheduled_job_runs`,
  `schedule-parser.ts` chuẩn hoá `once`/`every`/`cron` (KHÔNG nhận chuỗi datetime -
  chặn tận gốc lỗi Hermes từng dính), `next-run.ts` chống trôi lịch (neo mốc
  `next = scheduled + (elapsed/interval + 1) * interval`) + grace + fast-forward
  khi bot tắt rồi bật lại. IDOR vá ở TẦNG STORE - đọc/sửa/xóa/bật-tắt 1 job đều
  bắt buộc `accountId`+`threadId` khớp
- [x] **Vòng tick + gửi tin chủ động thật**: `scheduler-loop.ts` tick KHÔNG await
  dispatch (job chạy lâu không chặn tick kế), lượt agent theo lịch chạy
  `isolated: true` (không đọc history/memory/summary - phiên cô lập, persona giữ
  nguyên), loại 9 tool khỏi lượt này: 4 tool thiếu hạ tầng cho lượt cô lập
  (`add_reaction` không có msgId thật, `read_image` không có ảnh, `save_memory` -
  đường web vào trí nhớ vĩnh viễn là injection, `schedule_task` - job không được
  đẻ job) + 5 tool phát hiện ở vòng review toàn nhánh gọi thẳng `enqueueSend`
  (rate-limiter THEO THREAD) khi gửi nên né hoàn toàn trần ngày (`send_file`,
  `create_word_document`, `create_excel_file`, `create_image`, `tag_member`),
  sentinel `[SILENT]` để job im khi không có gì mới, guard gửi (account đang
  chạy + thread còn bật bot + chưa chạm trần ngày) chạy trước MỌI lần gửi chủ
  động, hàng đợi rải đều TOÀN CỤC cách nhau `SCHEDULER_SEND_GAP_MS`
- [x] **Trần chống spam 2 lớp độc lập**: lưới đỡ ĐẦU chặn `every`/`cron` dày hơn
  `SCHEDULER_MIN_INTERVAL_MINUTES` ngay lúc TẠO job; lưới đỡ CUỐI đếm trần
  `SCHEDULER_MAX_PROACTIVE_PER_DAY` theo TIN ZALO thật (không phải lượt job - 1
  job trả lời dài có thể ra tới 5 tin) bằng bảng bền `proactive_send_counters`
  (không phải bộ nhớ - restart không làm mất trần), giành chỗ NGUYÊN TỬ qua SQL
  (`INSERT ... ON CONFLICT DO UPDATE ... WHERE count < ?`) để N job cùng thread
  cùng đến hạn không cùng vượt trần
- [x] **Job bị chặn không tiêu suất chạy**: account rớt phiên (ca bình thường của
  zca-js) đúng lúc job đến hạn không còn làm lời nhắc `once` chết vĩnh viễn - bất
  biến "chưa từng gửi được thì không tính là đã chạy". Gửi hỏng (mất mạng thoáng
  qua) thử lại tối đa 3 lần qua cột bền `delivery_attempts`, phân biệt rõ "chưa
  gửi" (retry) với "gửi được một phần rồi hỏng" (không retry - người dùng đã nhận
  chữ, gửi lại là nhắn trùng)
- [x] **Tool `schedule_task`** (create/list/cancel/update) cho LLM tự đặt lịch
  qua chat - dùng lại đúng luật allowlist + trần job/thread đã có (không viết lại
  luật ở nơi thứ ba), mô tả tool dạy hủy phải `list` trước để lấy id (cấm đoán id)
- [x] **Dashboard trang Lịch hẹn**: danh sách theo account, sửa/xóa/bật-tắt,
  "Chạy thử ngay" (giành job bằng `next_run_at = NULL` trước khi chạy - không thì
  tick thật có thể nhặt trùng job đang thử và gửi 2 lần), drawer lịch sử chạy
  link thẳng sang trang Trace cho job `agent`
- [x] 9 tham số `SCHEDULER_*` (gồm `SCHEDULER_DEFERRED_RUN_HOUR` thêm giữa chừng
  khi controller tự sửa lại 1 quyết định thiết kế sai - xem dưới) chỉnh được từ
  dashboard (nhóm `lich-hen`), đối chiếu tay: `min`/`max` khớp đúng từng cặp giữa
  Zod (`env.ts`) và `tuning-definitions.ts`, đủ mặt ở cả `.env.example` lẫn
  `.env.production.example` - không lệch chỗ nào
- [x] Test: 849 pass lúc chốt vòng chạy/gửi tin (đỉnh điểm rủi ro spam), 895 pass
  sau xong dashboard, 903 pass sau vòng review toàn nhánh (cuối cùng trước merge) -
  `pnpm test` chạy 2-3 lượt liên tiếp mỗi vòng review để loại trừ flaky trước khi
  báo xanh
- [x] **Vòng review TOÀN NHÁNH** (sau khi 6 phase đều đã qua review riêng): 1
  Critical (5 tool gửi file/ảnh/tag thẳng qua `enqueueSend` né trần ngày - xem
  bullet vòng tick ở trên), 3 Important (restart giữa lúc dispatch làm mất lời
  nhắc `once` chưa từng chạy - vá bằng phục hồi `next_run_at` từ `run_at` TRƯỚC
  tick đầu tiên lúc boot; "Chạy thử ngay" còn hở với lượt ĐÃ dispatch trước đó -
  vá bằng route từ chối 409 khi job còn `status='running'`; sửa tên job `every`
  trên dashboard vô tình dời cả giờ chạy - vá bằng chỉ gửi `schedule` trong PATCH
  khi thật sự đổi), cộng 4 mục nhỏ (xoá job mồ côi `scheduled_job_runs`, `inMinutes`
  không trần gây 500, PATCH bật lại job không kiểm trần thread, chuỗi test fixture
  mất dấu)

Ba quyết định cố ý khác cả Hermes lẫn goclaw (rủi ro chính của tính năng là SPAM,
nên mỗi lần khác đều vì lý do chống mất tin hoặc chống spam, không phải sở thích):
- `once` trễ quá grace vẫn GỬI kèm nhãn "(nhắc trễ, lịch gốc HH:MM)" - Hermes vứt
  hẳn one-shot quá hạn, goclaw tắt job im lặng; với bot cá nhân, nuốt im lặng một
  lời đã hẹn là kết cục tệ nhất
- Không retry ở tầng scheduler - `agent-loop` đã có 2 tầng (glitch router +
  `maxRetries` của SDK), thêm nữa là 3 tầng chồng nhau, 1 job hỏng có thể nhân
  lên tới 6 lần gọi provider
- Loại `save_memory` khỏi lượt theo lịch - không repo nào làm, nhưng đường web ->
  trí nhớ vĩnh viễn là injection thật mà lượt này không có phát ngôn nào của user
  để mà "học"

4 lỗi Important tự phát hiện/bị review chỉ ra đáng nhớ nhất trong 4 vòng review
của phase vòng chạy/gửi tin (chi tiết đủ ở `.superpowers/sdd/plan/progress.md`):
- job `once` bị guard chặn từng tự tắt vĩnh viễn (`markRun` cộng `run_count` cho
  cả status `skipped`, chạm `maxRuns=1` ngay lần bị chặn đầu tiên)
- persona quảng cáo tool mà schema lượt theo lịch không cấp (thiếu truyền cờ
  `isolated` xuống `listAvailableTools`)
- hàng đợi rải đều toàn cục từng bị `await` BÊN TRONG khoá thread, khiến tin
  thật của người dùng phải xếp hàng theo tin chủ động của job khác trên CHÍNH
  thread đó
- "Chạy thử ngay" gọi thẳng `runScheduledJob` làm job `once` tự tắt hẳn sau 1
  lần thử (`markRun` cộng `run_count` chạm `maxRuns=1`) - nặng hơn câu chữ brief
  gốc "không đổi `next_run_at`"; vá xong lại lộ tiếp 1 race gửi trùng tin thật
  khi job đang quá hạn lúc bấm thử và 1 tick thật xen vào giữa - sửa bằng giành
  job (`next_run_at = NULL`) trước khi chạy, đúng bài clear-before-dispatch của
  vòng tick

**Chưa nghiệm thu thật trên Zalo** - toàn bộ mục trên chỉ chạy qua `pnpm test` và
gọi thẳng hàm/route, chưa có lượt nào chạy qua tài khoản Zalo thật. Thứ tự nghiệm
thu đã định (không nhảy bước, `once` trước `every` sau cùng vì đây là bước rủi ro
khóa nick cao nhất):
- [ ] Job `message` kiểu `once` -> đúng giờ nhận tin, `agent_turns` không tăng
  (0 token)
- [ ] Hủy job bằng chat ("hủy cái nhắc đó đi") -> bot `list` rồi `cancel`
- [ ] Job `agent` kiểu `once` -> trang Trace có lượt `source='schedule'`, phiên
  cô lập (hỏi lại tin nhắn trước đó phải nhận được câu "không có ngữ cảnh"),
  sentinel `[SILENT]` không gửi gì và run ghi `silent`
- [ ] Cron `"0 7 * * *"` ra đúng 07:00 giờ VN hôm sau trên dashboard, đối chiếu
  `next_run_at` thô trong DB phải là `...T00:00:00.000Z`
- [ ] Tắt bot qua mốc 1 job `once` rồi bật lại - trong grace gửi bình thường,
  quá grace gửi kèm nhãn "(nhắc trễ...)"
- [ ] Chỉ bật job `every` đầu tiên SAU KHI 5 bước trên sạch một vòng - đây là
  bước rủi ro khóa nick cao nhất (lịch lặp lại liên tục)
- [ ] Chưa kiểm trang Cấu hình bằng trình duyệt thật: nhóm `lich-hen` hiện đủ
  9 ô, sửa được, lưu được, ô đang lấy từ `.env` có nhãn riêng + nút trả về mặc định

## Đợt "agent chuẩn production" (A-G) - XONG 02/08 tới 03/08/2026

Kế hoạch đầy đủ: `plans/260802-1348-agent-chuan-production/`. Bảy khoảng cách
A-G rút ra từ vòng đối chiếu agent của repo với định nghĩa agent của Anthropic,
OpenAI và 12-Factor Agents.

| Gap | Việc | Trạng thái |
|---|---|---|
| A | Công cụ theo agent (giao hai lớp agent x tài khoản) | Xong |
| B | Chặn vòng lặp công cụ trong một lượt | Xong |
| C | `pnpm eval` - bộ kiểm thử chạy model thật | Xong |
| D | Ngân sách token thật cho ngữ cảnh | Xong |
| E | Lớp làm sạch câu trả lời trước khi ra Zalo | Xong |
| F | Luật hỏi lại khi thiếu thông tin | Xong |
| G | Phân loại lỗi nhà cung cấp | Xong |

Kèm theo: `.env.example` rút từ 68 biến còn 13 (dashboard là nguồn cấu hình
chính), và một vòng rà soát toàn cục bắt được ReDoS 20 giây trong lớp làm sạch.

### Còn treo

- [ ] Chạy `pnpm eval` định kỳ trước mỗi lần phát hành - hiện chạy tay.
- [ ] Caption của 4 công cụ gửi file đã qua lớp làm sạch, nhưng CHƯA có test
  riêng cho từng công cụ đó.
- [ ] Ba dòng "hỏi lại" trong persona chưa chứng minh được tác dụng với model
  đang dùng (bỏ đi eval vẫn xanh) - giữ làm lưới đỡ cho lần đổi model rẻ hơn.

## V3.4 - Hết 524, và tin nhắn thêm giữa lượt không còn đẻ ra lượt thừa (2026-08-04)

Xuất phát từ một hội thoại thật: người dùng nhờ soạn bài giảng, trả lời câu hỏi
của bot làm 3 tin cách nhau 50 giây, và nhận về 3 lượt agent - mỗi lượt làm lại
từ đầu toàn bộ web_search cộng dựng lại tài liệu 18.000 ký tự - rồi 2 tin báo
lỗi giống hệt nhau. Chẩn đoán ra hai căn nguyên độc lập.

### Căn nguyên 1: Cloudflare cắt 524 vì request non-stream

`9router.vuhai.io.vn` bật proxy Cloudflare (xác minh bằng header `Server:
cloudflare` + `CF-RAY`; grep source 9Router không có chỗ nào phát mã 524).
Cloudflare cắt khi origin chưa trả BYTE ĐẦU trong 100 giây, mà `generateText`
buộc router gom trọn câu trả lời rồi mới gửi.

Đo trên router thật, cùng prompt sinh 4000 chữ:

| Đường | Kết quả | Byte đầu | Tổng |
|---|---|---|---|
| `stream=false` | HTTP 524 | không bao giờ | chết ở 125 s |
| `stream=true` | HTTP 200, 880 KB | 7,5 s | 135 s |

Lượt streaming chạy LÂU HƠN mốc bị cắt mà vẫn qua - Cloudflare đếm tới byte
đầu, không đếm tổng thời lượng.

- [x] Chuyển cả 5 điểm gọi LLM sang `streamText` (vòng lặp agent, lượt chốt,
  tóm tắt thread, sidecar mô tả ảnh, nút Test kết nối). Bất biến giờ là "không
  còn lời gọi LLM non-stream nào" - dễ giữ hơn "non-stream trừ mấy chỗ này".
  Nút Test kết nối phải đi đúng đường vận chuyển của bot, không thì nó báo xanh
  trong khi bot đang chết vì 524
- [x] `stream-text-result.ts` vá 3 hành vi của `streamText`, cả 3 đều hỏng CÂM:
  `onError` mặc định là `console.error` thô (đổ `requestBodyValues` = system
  prompt + hội thoại + ảnh base64 ra stdout, không qua pino); lỗi gốc bị thay
  bằng `NoOutputGeneratedError` lúc flush (làm `phanLoaiLoiProvider` mất sạch
  mã HTTP - 401 bị báo thành "thử lại sau ít phút"); lỗi nổ sau khi step 1 đã
  ghi thì promise VẪN resolve với kết quả cụt
- [x] Bộ bắt lỗi dựng MỚI mỗi lần gọi - dùng chung cả lượt thì lỗi lần trước
  giết luôn lần thử lại đã thành công
- [x] Bật `includeUsage` cho openai-compatible (mặc định TẮT). 9Router trả
  usage kể cả khi không hỏi nhưng LiteLLM/OpenRouter thì đòi
- [x] **Nghiệm thu bằng gọi thật**: chạy lại đúng ca đã chết bằng code mới -
  222 giây, `finishReason: stop`, 39.326 ký tự

### Căn nguyên 2: bộ gộp chốt cứng batch rồi mới xếp hàng

`flush()` cũ đo khoảng lặng giữa các tin, không đo thread có bận. Chốt danh
sách rồi xếp hàng nghĩa là tin tới sau không còn chỗ gộp vào. Bằng chứng trong
log: lượt 100 và 101 khởi động đúng 2 giây sau khi lượt trước kết thúc.

- [x] Batch chỉ chốt khi CẢ HAI đúng: im lặng đủ debounce, VÀ không còn ai giữ
  khoá thread. Gặp thread bận thì ĐỖ LẠI để tin tới tiếp còn chỗ gộp
- [x] Không cướp cò khi khoá nhả mà cụm tin còn gõ dở - bất biến "chưa im lặng
  đủ thì chưa chạy lượt" đúng cho cả đường bận lẫn đường rảnh
- [x] Trần 32 tin mỗi batch (con số Hermes). Trần này CHỈ chặn bộ nhớ: batch dù
  to vẫn là một lượt, và input gửi model đã có đường cắt theo ngân sách token
- [x] Tin bị bỏ ở trần vẫn ghi vào history (`enqueueMessage` trả boolean). Rà
  soát bắt được: không ghi thì tin biến mất khỏi cả hội thoại lẫn trí nhớ bot,
  trong khi người nhắn đã nhận dấu "đã nhận"
- [x] Tách `thread-run-chain.ts` - khoá là nguyên thủy dùng chung (scheduler giữ
  cùng cái khoá đó). Khoá bắn hook khi nhả, bộ gộp tự đăng ký

### Tiêm tin vào lượt đang chạy

Dồn tin mới chỉ hạ 3 lượt xuống 2 - lượt ĐẦU vẫn phóng đi với bối cảnh thiếu.
Không cửa sổ gộp nào phủ được khoảng 50 giây mà không bắt mọi câu hỏi thường
phải chờ ngần ấy.

- [x] Chèn ở ranh giới step qua `prepareStep` - đúng điểm goclaw dùng
  (`observe_stage.go` tiêu thụ `InjectCh`). Không cần bộ phân loại ý định bằng
  LLM như goclaw: bọc nhãn rồi để model tự xử là đủ, xử đúng cả ca "thôi khỏi"
- [x] Tin chen GIỮ Ở TẦNG agent-loop, không chỉ trong mảng nội bộ của SDK. Rà
  soát bắt được lỗi Critical: `layTinDangDo` đã xóa tin khỏi hàng chờ, mà mọi
  nhánh chữa lỗi và LƯỢT CHỐT đều dựng lại từ biến `messages` của agent-loop.
  Thiếu chỗ này thì đúng lượt dài - lượt duy nhất đủ lâu để người ta kịp nhắn
  thêm - lại là lượt đánh rơi tin chen, mà lượt chốt mới là nơi sinh ra câu gửi
  xuống Zalo
- [x] Trong lượt chốt, tin chen nằm ở đuôi ĐƯỢC BẢO VỆ cùng câu hỏi và lời
  nhắc (biến thể của đúng cái bẫy đã vá một lần - lần đó là câu hỏi bị cắt)
- [x] Trần token riêng cho tin chen (1/4 ngân sách), quá trần thì dựng lại
  không kèm ảnh - giữ chữ vì chữ mới là thứ đổi yêu cầu
- [x] Ảnh tin chen được lưu đĩa như tin mở đầu; thiếu thì history chỉ còn dòng
  "[gửi kèm N ảnh]" và ảnh mất hẳn khi URL Zalo hết hạn
- [x] Toàn bộ đường chèn trong try/catch, hỏng thì trả "không đổi gì" - đây là
  nhánh làm tốt thêm, để nó giết lượt vừa tốn mấy phút gọi tool là đổi một tiện
  ích lấy cả câu trả lời
- [x] Bật/tắt ở trang Cấu hình (`MID_TURN_INJECTION_ENABLED`, mặc định bật)

### Bớt nhiễu

- [x] Khử trùng câu báo lỗi theo (thread + LOẠI lỗi). Khử theo mỗi thread sẽ
  nuốt mất "bot chưa cài xong" khi vừa báo "mạng chập" - hai chuyện dẫn tới hai
  hành động khác nhau
- [x] Câu trấn an thu HẸP so với kế hoạch đầu: đo lại thì tài khoản thật đã bật
  cả typing indicator lẫn auto-react, và tin chen cũng nhận đủ "đã xem" +
  reaction. Ba tín hiệu rồi thì thêm tin text là nhiễu + tốn lượt gọi API không
  chính thức. Khe hở thật là typing tự tắt ở phút 10 còn lượt chạy tới phút 15
  (log 12:21:22 ghi "Typing chạy quá lâu - tự tắt") - `BUSY_ACK_AFTER_MS` mặc
  định 600s lấp đúng khoảng đó, đặt 0 để tắt

### Kiểm chứng

- 1343 test xanh (+27 test mới), typecheck sạch, build chạy
- **Phá code kiểm test 20 lần, bắt được 19**. Lần không bắt được (giữ lỗi đầu
  hay lỗi cuối trong bộ bắt lỗi stream) đã ghi thẳng vào comment là chưa có
  test nào ghim, thay vì để comment ngụ ý đó là bất biến đã chứng minh
- 2 vòng rà soát bằng subagent (đợt bộ gộp, đợt tiêm tin). Vòng hai tìm ra lỗi
  Critical ở lượt chốt kèm số đo tái hiện

### Quyết định đã chốt - đừng lật lại nếu không có bằng chứng mới

- **KHÔNG tách `agent-loop.ts`** dù nó 657 dòng (vượt ngưỡng 200 từ TRƯỚC đợt
  này, lúc đó đã 523). Ứng viên duy nhất là `runWrapUp`, nhưng nó ôm 12 biến
  closure - tách ra là một tham số object to đùng, rủi ro cao mà không thêm
  tính đúng đắn nào. User đã cân nhắc và chốt giữ nguyên (2026-08-05).

### Còn treo

- [x] `gpt-combo` trên 9Router đã thêm model thứ hai - fallback giờ có chỗ để
  fall back thật (làm trên dashboard 9Router, không đụng code).
- [x] `pnpm eval` 11/11 đạt với model thật (chạy 2 lần: trước và sau bản vá của
  vòng rà tổng). Lưu ý eval chỉ đi đường THUẬN - không ca nào chạm nhánh chữa
  lỗi, nên nó không thể bắt được lớp lỗi mà vòng rà tổng vừa tìm ra.
- [ ] Đồng hồ chờ của câu trấn an đo theo CHUỖI chạy, không theo tin đến. Từ khi
  bộ gộp cho batch đỗ lại, lượt kế mở chuỗi mới và đồng hồ về 0 - người chờ 7
  phút rồi sang lượt sau bị tính là 0. Đo đúng thì phải theo dõi từ tin cũ nhất
  chưa được trả lời.
- [ ] Lượt KHÔNG gọi tool chỉ có một step nên đường tiêm tin không bao giờ chạy
  (`prepareStep` chạy một lần ở đầu, lúc chưa ai kịp nhắn thêm). Đó lại đúng là
  ca sinh dài nhất. Không có cách sửa rẻ - không kiểm soát được ranh giới step
  bên trong một lần gọi model.

## V3.4.1 - Vá sau khi dùng thật: dashboard mất tin, và trần ngày lệch ngày (2026-08-05)

Ba việc phát sinh khi user dùng dashboard thật, cộng một bug scheduler có sẵn
lộ ra đúng lúc ngày thật qua nửa đêm.

### Dashboard: tin bot gửi bị mất, khung chat mở nhầm chỗ

User đối chiếu Zalo với dashboard: bot gửi 3 tin (câu dẫn, file .docx, câu
chốt) mà web chỉ hiện 1.

- [x] 5 tool (`send_file`, 2 tool tạo tài liệu, `create_image`, `tag_member`)
  gọi thẳng `enqueueSend`, không đi qua `deliverChatReply` - mà đó là chỗ DUY
  NHẤT gọi `appendMessage`. Hỏng nặng hơn chuyện hiển thị: history CHÍNH LÀ thứ
  model đọc lại ở lượt sau, nên gửi file xong bot không nhớ đã gửi, hỏi lại là
  dựng lại từ đầu. Nghi đây là một phần lý do lượt 100/101 hôm 04/08 làm lại
  tài liệu.
- [x] Tool KHÔNG tự `appendMessage`: tin người dùng được ghi ở CUỐI lượt (ghi
  trước thì model thấy tin lặp hai lần), nên tool ghi thẳng lúc gửi sẽ nằm
  TRƯỚC tin người dùng. Tool chỉ ghi nhận vào mảng do `message-turn-processor`
  sở hữu - cùng nếp `trace` và `tinChen`. Có test ghim riêng thứ tự này.
- [x] Khung chat mở ra ở TIN MỚI NHẤT (trước đây đứng ở `scrollTop = 0`, tức
  tin cũ nhất trong 50 tin vừa nạp). "Tải tin cũ hơn" giữ nguyên chỗ đang đọc -
  đo khoảng cách tới ĐÁY trước khi chèn, vì đó là đại lượng duy nhất không đổi
  khi danh sách dài ra.
- [x] Nút xóa bản tóm tắt hội thoại cũ. Đặt CẢ `summary_covers_to_message_id`
  về 0 chứ không chỉ xóa chữ - giữ nguyên mốc thì lần gộp sau chỉ gộp backlog
  mới và đoạn cũ mất hẳn, tức xóa một bản tóm tắt SAI lại hóa ra xóa luôn TRÍ
  NHỚ về đoạn đó.
- [x] Khối tóm tắt thu gọn 2 dòng, mở ra thì có trần chiều cao và tự cuộn (nó
  là anh em cùng cấp với danh sách tin trong flex column mà không có trần lẫn
  overflow, nên bản 300 từ nở ~460px và bóp phần hội thoại).

### Scheduler: trần ngày ghi sổ bằng hai cái đồng hồ

Hai test đỏ sau nửa đêm. Xác định trách nhiệm bằng `git checkout 0064fb7`
(trước cả loạt V3.4) - vẫn đỏ, nên lỗi CÓ SẴN, không phải hồi quy.

Tìm căn nguyên bằng cách chèn log vào từng điểm quyết định: mọi thứ phía trên
đều đúng, nhưng hai lần đọc CÙNG một khóa cho hai kết quả - hàng trong
`proactive_send_counters` biến mất giữa chừng.

- [x] `recordProactiveSend` khai `now: Date = new Date()` và `sendCapNotice`
  quên truyền `now`. Nó vừa cộng bộ đếm vào day-key của giờ THẬT, vừa dọn bảng
  bằng cutoff của giờ thật (retention 3 ngày) - xóa luôn dòng của ngày lượt
  đang xử lý. Mốc giả lập 2026-08-01 hôm 04/08 còn sát mép nên sống, qua nửa
  đêm sang 05/08 là bị xóa.
- [x] BỐN nơi gọi đều thiếu `now`, trong khi `reserveCapNotice`/`revertCapNotice`
  thì có - bản vá "Mục 3, vòng 4" trước đây chỉ làm nửa chừng.
- [x] Bug THẬT ở ranh giới nửa đêm, không riêng gì test: giành suất ngày D, gửi
  mất 20 giây (`SCHEDULER_SEND_GAP_MS`) rồi hỏng, hoàn suất trả cho ngày D+1.
  Ngày D giữ suất VĨNH VIỄN không ai đòi lại được, ngày D+1 bị `MAX(0, count-1)`
  nuốt êm. Đây là lá chắn chống khóa nick nên rò một suất là rò thật.
- [x] Sửa: chốt MỘT mốc ở đầu tick rồi luồn xuyên suốt
  (`RunScheduledJobOptions.now`). BỎ HẾT `= new Date()` trong
  `proactive-send-guard.ts` để trình biên dịch canh - chính cái mặc định đó đẻ
  ra bug, dựng lại nó ở tầng trên là lặp lại đúng sai lầm. Compiler chỉ ra đủ
  24 call site, không sót chỗ nào.
- [x] Cân nhắc hướng ngược lại (bỏ `now` khỏi reserve/revert để mọi thứ dùng
  giờ thật) và BÁC: nó có lỗ hổng thật - giành và hoàn cách nhau cả quãng gửi,
  mỗi bên tự lấy giờ thật là hoàn nhầm ngày. Bất biến đúng là "một lượt xử lý
  job = MỘT mốc thời gian".

### Kiểm chứng

- 1351 test xanh, chạy cả bộ 3 lần đều xanh (trước đó 1-2 đỏ ngẫu nhiên)
- Phá code kiểm test: dựng lại đúng bug gốc thì 2 test cũ đỏ y như trước; bản
  phá ở đường hoàn suất KHÔNG bị bắt -> lộ ra lỗ hổng test, đã viết bổ sung 3
  test cho ranh giới nửa đêm (cả tầng đơn vị lẫn qua ĐƯỜNG GỬI THẬT)
- Bản đầu của chính test mới cũng xanh giả (khẳng định "ngày thật bằng 0" trong
  khi ca chạy trước đã tiêu một suất) - sửa thành "lượt này không đụng vào ngày
  thật" mới ghim được

### Còn treo

- [ ] Ảnh và file bot đã gửi TRƯỚC bản vá này vẫn không có trong history - chỉ
  ghi từ giờ trở đi, không dựng lại quá khứ.

---

## V3.5 - Tin Zalo có định dạng thật: in đậm, tiêu đề, danh sách (2026-08-05)

Người dùng chỉ ra: Zalo có sẵn in đậm / cỡ chữ / danh sách, nhưng bot trả lời
một khối chữ phẳng nên tin dài rất khó đọc.

### Căn nguyên

`sanitize-reply-text.ts` XÓA mọi dấu markdown, với lý do ghi trong docstring là
"Zalo không render markdown". Điều đó đúng với KÝ TỰ markdown nhưng SAI với định
dạng: `sendMessage` của zca-js nhận `styles: Style[]` và Zalo render bình thường
(`zca-js/src/apis/sendMessage.ts`, enum `TextStyle`). Persona lại dặn "không
markdown", nên hai lớp cùng ép model về chữ phẳng.

### Đã làm

- `markdown-to-zalo-styles.ts` - DỊCH markdown thành `Style` thay vì xóa. Phỏng
  theo `zalo-personal/src/send.ts` (MIT), gồm cả cách token hóa bằng ký tự mốc
  mà bản đó đã trả giá để tìm ra (pass sau xóa ký tự nằm trước span pass trước
  đã ghi -> span cũ trôi mà không ai chỉnh lại).
- `split-styled-message.ts` - cắt tin dài KÈM định dạng. Bản tham chiếu KHÔNG
  giải bài này (nó cắt cụt ở 4000 ký tự, repo mình chẻ nhiều tin). Hai việc:
  dời mốc về đầu mỗi đoạn, và CHẺ ĐÔI span nằm vắt qua chỗ cắt.
- `splitLongMessageWithOffsets` - bản trả về kèm mốc; `splitLongMessage` giờ chỉ
  là lớp mỏng bọc nó. MỘT thuật toán cắt duy nhất, không nhân bản.
- Mức A (theo lựa chọn của người dùng): đậm / nghiêng / gạch ngang / tiêu đề
  to-đậm / danh sách / thụt cấp. KHÔNG dùng màu - Zalo có 4 màu nhưng tô màu
  trong hội thoại đọc như tin quảng cáo.
- Caption của 3 tool gửi file/ảnh cũng qua lớp này (`tinKemFile`).
- Lượt theo lịch dùng chung đường (`prepare-outgoing-text.ts`), không bị bỏ lại
  với chữ phẳng.
- Nút tắt `ZALO_RICH_TEXT_ENABLED` trên trang Cấu hình, mặc định BẬT.

### Quyết định đã chốt - đừng lật lại nếu không có bằng chứng mới

- Offset đếm theo đơn vị UTF-16 (`String.length` của JS), KHÔNG phải code point.
  zca-js gói thẳng `start`/`len` vào `textProperties` JSON nên phải khớp cách
  Zalo Web đếm. Emoji là cặp surrogate = 2 đơn vị: "sửa cho đúng" thành đếm ký
  tự thật sẽ lệch toàn bộ phần sau emoji đầu tiên, mà tin nhắn thật đầy emoji.
- CỐ Ý bỏ qua `__đậm__` và `_nghiêng_`: gạch dưới sống đầy trong tên file và URL
  thật (`bao_gia_2026.pdf`). Giữ nguyên quyết định cũ của lớp làm sạch.
- Nội dung trong khối code đi thẳng, không qua bước khối hay inline - nếu không
  thì `# Tính tổng` trong đoạn Python bị hiểu là tiêu đề, đúng lỗi mà
  `sanitize-code-block.ts` đã được viết ra để chữa.
- `DoanDaCat.phuGoc` tách khỏi `text.length` vì đoạn cuối bị dán thêm ghi chú
  "còn nữa" - chữ THÊM VÀO, không có trong chuỗi gốc. Lấy `text.length` làm phạm
  vi thì span thuộc phần BỊ CẮT BỎ rơi trúng ghi chú.
- Caption có khoảng trắng thừa hai đầu thì BỎ định dạng chứ không gửi mốc đã
  lệch: tô nhầm chỗ nhìn như lỗi, mất đậm thì chỉ là nhạt hơn.

### Kiểm chứng

- 1386 test xanh, chạy cả bộ 3 lần liên tiếp đều xanh
- `pnpm eval` 11/11 đạt với model thật
- Phá code kiểm test 8 lần: 5 bị bắt ngay; 3 lọt và mỗi lần lọt đều lộ ra một lỗ
  hổng test thật, đã vá rồi kiểm lại đều bắt:
  - `phuGoc` -> `text.length`: test cũ chỉ kiểm "span trong biên", mà lớp kẹp
    cuối giữ biên đúng ngay cả khi span đã trượt vào ghi chú. Bất biến thật là
    "không span nào chạm vùng ghi chú".
  - Caption mất định dạng: KHÔNG có test nào cho caption -> viết mới 6 ca.
  - Nút tắt bị bỏ qua: đường TẮT của lớp gửi chưa ai kiểm -> viết mới 1 ca.
- Gọi model THẬT một lượt để trả lời câu hỏi mà eval không trả lời được: model
  có dùng markdown sau khi đổi persona không. Có - ra 13 span (3 danh sách,
  10 đậm) cho một câu so sánh giá cà phê.

### Còn treo

- [ ] Màu chữ (Zalo có 4 màu) chưa dùng - để dành cho ca thông báo, chưa quyết.
- [ ] `kiemTraText` của eval chỉ nhận text chứ không nhận styles, nên ca
  `dinh-dang` chỉ còn chứng minh "không rò ký tự định dạng ra chữ". Phần "định
  dạng tới nơi" do test đầu-cuối ở `message-turn-sanitize.test.ts` gánh.

### Vá ngay sau khi dùng thật: Zalo trả mã 112 vì span chồng nhau (2026-08-05)

Ngay lượt đầu chạy thật có tiêu đề, Zalo từ chối cả tin. Người dùng mất trọn câu
trả lời sau 8 lượt tra web và 119k token, chỉ nhận lại câu "trục trặc kỹ thuật".

**Căn nguyên.** Dòng `## 1. Vé Tiền Giang - số **418512**` sinh HAI span `b`
chồng nhau: một từ luật tiêu đề (phủ cả dòng), một từ luật inline (phủ dãy số).
Mã 112 của Zalo nghĩa là "tham số không hợp lệ".

**Bằng chứng.** Dựng lại 20 bước của 12 lượt gần đó từ `agent_steps`: 9 tin gửi
được đều có 0 span chồng trùng loại; lượt hỏng có 3. Nó cũng là lượt duy nhất có
tiêu đề. Bản tham chiếu `zalo-personal` dùng Big+Bold cho tiêu đề và chạy thật,
nên `f_18` vô can - bản đó chỉ chưa gặp ca tiêu đề CÓ in đậm bên trong.

**Lỗi thứ hai lộ ra khi đào.** Span `Indent` phát sau các span inline nên mảng
không còn theo thứ tự vị trí (`0:lst_1 7:b 13:lst_1 25:b 13:ind_$`).

**Đã sửa.**

- `normalize-zalo-styles.ts` - gộp span chồng/chạm nhau CÙNG kiểu, sắp theo
  `start`. Khóa gộp tính cả `indentSize` (hai cấp thụt là hai định dạng khác
  nhau, gộp là làm phẳng danh sách lồng).
- Gửi lại KHÔNG kèm styles khi máy chủ từ chối, ở CẢ hai đường: câu trả lời
  (`sendReplyInParts`) và caption gửi kèm file (`guiFileKemCaption`).
- 3 tool gửi file/ảnh gom về một hàm `guiFileKemCaption` - lưới an toàn phải nằm
  ở một chỗ, rải ba nơi thì sớm muộn có nơi bị bỏ quên.

**Quyết định đã chốt - đừng lật lại nếu không có bằng chứng mới**

- CHỈ gửi lại khi lỗi có `code` dạng số (máy chủ đã trả lời và từ chối => chắc
  chắn không có tin nào lọt qua). Lỗi mạng không có `code`: tin CÓ THỂ đã tới,
  gửi lại là nhân đôi tin/file trước mặt người dùng. Đã cân nhắc hướng "cứ thử
  lại mọi lỗi" và BÁC.
- Đường lui đặt ở tầng gửi chứ không phải sửa cho hết mọi luật kiểm của Zalo:
  luật đó là hộp đen, không liệt kê đủ được. Hạ mức hậu quả thay vì đoán cho
  đúng - tổ hợp style lạ chỉ làm tin NHẠT ĐI, không làm mất nội dung.
- Chuẩn hóa đặt trong `markdownSangStyleZalo` (nguồn duy nhất sinh span), không
  đặt ở nơi gửi. Bộ cắt tin chỉ CẮT span có sẵn nên không tạo được chồng lấn mới.

**Kiểm chứng**

- 1404 test xanh, chạy cả bộ 3 lần liên tiếp; `pnpm eval` 11/11
- Chính đoạn chữ đã làm hỏng lượt 116, dựng lại từ `agent_steps`: trước 25 span
  / 3 cặp chồng, sau 22 span / 0 cặp chồng / đã sắp thứ tự
- Phá code kiểm test 5 lần (bỏ gộp, gộp bừa mọi kiểu, thử lại mọi loại lỗi, bỏ
  đường lui của câu trả lời, bỏ đường lui của caption). Lần cuối KHÔNG bị bắt ->
  lộ ra đường caption chưa ai kiểm, đã viết 4 ca rồi kiểm lại thì bắt được.

**Còn treo**

- [ ] Chưa tách bạch được bằng thực nghiệm giữa "chồng span" và "cứ có tiêu đề
  là hỏng" - dữ liệu log không có ca tiêu đề KHÔNG kèm in đậm. Muốn chắc hẳn thì
  phải gửi thử hai tin ngắn vào một luồng thật. Đường lui khiến việc này không
  còn cấp bách.

### Căn nguyên THẬT của mã 112: trần TỔNG BYTE của tin có định dạng (2026-08-05)

Bản vá "gộp span chồng" ở trên KHÔNG phải căn nguyên - lượt 117 và 118 chạy trên
code đã vá, 0 span chồng, vẫn bị Zalo chối. Chẩn đoán đúng chỉ có được sau 4
vòng gửi thử vào Zalo thật.

**Các giả thuyết đã BÁC bằng đo, không phải bằng suy luận**

| Giả thuyết | Phép bác |
|---|---|
| `f_18` (cỡ chữ to) bị chối | gửi `## Thử 2: cỡ to` -> ĐƯỢC, chữ hiện to thật |
| Trần theo SỐ SPAN | 330 ký tự + 80 span -> ĐƯỢC |
| Một nhóm style nào đó | bỏ `lst_1` / bỏ `f_18` / bỏ `b` / chỉ `lst_1` -> HỎNG hết |
| Trần theo ĐỘ DÀI CHỮ | 1600 ký tự + style -> ĐƯỢC |
| Trần theo SỐ DÒNG | 1, 30, 60 dòng -> ĐƯỢC hết |

**Căn nguyên: TỔNG byte (chữ UTF-8 + JSON textProperties).**

| byte chữ + byte style | kết quả |
|---|---|
| 1642 + 572 = 2214 | được |
| 2321 + 0 = 2321 | được |
| 320 + 2412 = 2732 | được |
| 2321 + 546 = 2867 | được |
| 2321 + 1391 = 3712 | HỎNG (112) |
| 2321 + 1580 = 3901 | HỎNG (112) |

Hai dòng cuối dùng ĐÚNG đoạn chữ của dòng 2321+0 - khác mỗi chỗ có style hay
không. Trần nằm giữa 2867 và 3712.

**Đã sửa.** `chiaTheoNganSachByte` co dần trần ký tự cho tới khi mọi tin lọt
ngân sách byte, rồi mới cắt. Nút chỉnh `ZALO_RICH_TEXT_MAX_PAYLOAD_BYTES` mặc
định 2800.

**Quyết định đã chốt - đừng lật lại nếu không có bằng chứng mới**

- Mặc định 2800 chứ không phải 3000 hay 3200: lấy ngay dưới mốc CAO NHẤT đã
  chứng minh là gửi được (2867), không đoán giữa khoảng 2867-3712. Phần dư dành
  cho sai số giữa JSON mình tính và JSON zca-js thật sự gửi (nó đổi `ind_$`
  thành `ind_10`).
- Vượt trần thì CẮT NHỎ HƠN, không bỏ định dạng: nhận thêm một tin thì vẫn đọc
  được, mất định dạng là mất đúng thứ vừa làm ra. Chỉ khi co tới trần SỐ TIN
  (cắt tiếp là vứt chữ) mới bỏ định dạng của riêng đoạn đó.
- Trần byte CHỈ áp cho tin có định dạng. Tin chữ trơn giữ nguyên luật cũ theo
  số ký tự - đã đo: 2321 byte chữ trơn gửi tốt.
- Đếm theo BYTE UTF-8, không theo số ký tự. Dấu tiếng Việt tốn 2-3 byte mỗi ký
  tự nên đếm ký tự sẽ lọt trần trên giấy mà vẫn bị Zalo chối.

**Kiểm chứng**

- 1410 test xanh; `pnpm eval` 11/11
- Dựng lại đúng tin đã hỏng (nhân 4 cho đúng quy mô): trước 1 tin 6025 byte ->
  sau 3 tin 2172 / 1490 / 2309 byte, GIỮ NGUYÊN định dạng cả 3, chữ còn 1715/1719
- Phá code kiểm test 3 lần (bỏ vòng co, bỏ lưới an toàn cuối, đếm ký tự thay vì
  byte) - cả 3 đều bị bắt
- Bản đầu của chính test mới khẳng định SAI ("mọi tin phải dưới trần") - nó đỏ
  ở ca chữ trần đã nặng hơn trần, mà ca đó đúng. Bất biến thật là "tin nào vượt
  trần thì BẮT BUỘC rỗng style"

**Còn treo**

- [ ] Trần thật nằm đâu đó trong 2867-3712, chưa thu hẹp thêm. Muốn dùng ngân
  sách rộng hơn thì dò thêm một vòng; hiện chưa đáng vì 2800 đã đủ cho tin dài.

### Vá tiếp: bộ cắt tự bỏ định dạng dù còn suất tin (2026-08-05)

Ngay lượt chạy thật đầu tiên sau bản trần byte, tin ĐẦU về phẳng lì trong khi
tin sau có định dạng. Log KHÔNG có mã 112 - Zalo nhận cả 3 tin. Tức là chính bộ
cắt tự bỏ định dạng, và bỏ trong im lặng.

**Căn nguyên: chốt chặn đo sai đại lượng.** Vòng co viết `if (thu.length >=
maxParts) break` với ý chống mất chữ, nhưng chạm ĐÚNG trần số tin không phải là
mất chữ - `splitLongMessage` chỉ vứt bớt khi cần NHIỀU HƠN maxParts. Soi vòng
lặp trên tin thật:

```
kyTu=979 -> 3 tin 3754/2297/884
kyTu=685 -> 5 tin 1616/2141/1366/1567/256 | chữ 2159  <-- BREAK vì 5 >= 5
chốt: 3 tin, tin đầu 3754 byte vượt trần -> bỏ định dạng
```

Bước 685 cho kết quả tốt về mọi mặt (mọi tin dưới trần, không hụt chữ) nhưng bị
vứt đi.

**Hướng sửa đã thử và SAI:** so tổng số ký tự giữa hai lần cắt. Cắt mịn hơn thì
`trimEnd` ở mỗi ranh giới ăn vài ký tự trắng (2167 -> 2165 -> 2163 -> 2159) nên
phép so luôn báo "mất chữ" và vòng co thoát ngay bước đầu - ra 2 tin, tệ hơn cả
lúc chưa sửa.

**Bản đúng:** dấu hiệu mất chữ THẬT là ghi chú "còn nữa" (`OVERFLOW_NOTE`), chỉ
được dán khi phải bỏ chữ vì hết chỗ. Kết quả trên tin thật của lượt 123:
maxParts=5 -> 5 tin, 0 tin mất định dạng, chữ 2159/2167.

**Thêm:** `sendReplyInParts` giờ ghi WARN khi có đoạn bị bỏ định dạng. Bản đầu
làm việc này lặng lẽ - lỗi lộ ra vì người dùng nhìn thấy, log không nhắc gì.

**Kiểm chứng:** 1412 test xanh. Phá code 2 lần (dựng lại chốt chặn cũ, dựng lại
hướng so tổng ký tự) - cả 2 đều bị bắt. Phép phá đầu tiên KHÔNG bị bắt bởi
fixture 38 dòng, phải dò tới 60 dòng mới chạm được nhánh hỏng - fixture nhẹ hơn
xanh với cả bản đúng lẫn bản sai, tức là không kiểm được gì.

### Bớt số tin và bỏ khe hở đôi (2026-08-05)

Người dùng: một câu trả lời ra 4 tin thì lười đọc, và giữa các khối có dòng
trống thừa.

**Dòng trống thừa.** Markdown cần dòng trống ngăn đoạn văn với danh sách, nhưng
Zalo TỰ chèn khoảng cách cho khối `lst_1`/`lst_2` và dòng cỡ `f_18`. Hai thứ
cộng lại thành khe hở đôi. Giờ bỏ dòng trống nằm sát khối danh sách hoặc tiêu
đề; dòng trống giữa hai đoạn văn thường vẫn giữ (ở đó Zalo không thêm gì).

**Số tin.** Đo ra nguyên nhân bất ngờ: JSON định dạng ngốn GẤP ĐÔI chữ (163 span
~5200 byte so với ~2500 byte chữ), mà trần của Zalo tính theo TỔNG byte. Ba việc:

- Gộp span danh sách LIỀN NHAU thành một span phủ cả khối. ĐÃ ĐO THẬT: một span
  `lst_1` phủ 5 dòng hiện đủ 5 dấu đầu dòng, giống hệt 5 span riêng. Danh sách
  40 dòng: 40 span còn 1.
- Bước co trần ký tự đổi từ 30% xuống 10%. Co quá tay là THÊM một tin: đo trên
  tin thật, ở mức 980 ký tự tin chỉ vượt trần 50 byte mà bước 30% nhảy thẳng
  xuống 686 và đẻ ra tin thứ ba không cần thiết.
- Nâng trần byte 2800 -> 3250 sau khi đo thêm: 3281 byte gửi được (mốc cao nhất
  chứng minh được), 3712 bị chối.

**Persona: in đậm phải tiết kiệm.** Model đang bôi đậm cả 3 con số mỗi dòng.
Siết lại còn "mỗi dòng nhiều nhất một chỗ" - đây là dòng tự viết ở đợt trước,
KHÔNG đụng tới luật "trình bày đầy đủ" của người dùng.

**Hiệu quả đo được** (cùng nội dung, chỉ khác mật độ in đậm):

| Nội dung | Span | Byte | Số tin |
|---|---|---|---|
| 20 dòng, đậm dày | 64 | 3223 | 1 |
| 20 dòng, đậm tiết kiệm | 24 | 1985 | 1 |
| 40 dòng, đậm dày | 124 | 6264 | 3 |
| 40 dòng, đậm tiết kiệm | 44 | 3746 | 2 |

Trước loạt sửa này, bản 40 dòng ra 4 tin và một tin mất định dạng.

**Kiểm chứng.** 1417 test xanh (3 lượt); `pnpm eval` 11/11. Phá code 3 lần (bỏ
mọi dòng trống / quên tính danh sách là khối / không gộp qua dòng) đều bị bắt.

Ca eval `ngay-co-san` đỏ ngẫu nhiên ở lượt chạy cả bộ (chạy riêng 3/3 đạt). ĐÃ
KIỂM bằng cách tạm hoàn persona về bản cũ rồi chạy lại: vẫn đỏ đúng ca đó, nên
đây là flake CÓ SẴN, không phải hồi quy của dòng persona mới.

**Còn treo**

- [ ] Ca eval `ngay-co-san` đỏ ngẫu nhiên trong lượt chạy cả bộ, chưa tìm căn nguyên.
- [ ] Test `run-scheduled-job-trial` cũng đỏ ngẫu nhiên một lần (chạy riêng xanh).
- [ ] Trần byte thật nằm trong 3281-3712, chưa thu hẹp thêm.

### Danh sách bỏ style Zalo, quay về ky tu gach ngang (2026-08-05)

Người dùng phát hiện tin hiện ĐÚNG trên Zalo Web nhưng HỎNG trên điện thoại:
chỉ dòng đầu mỗi khối có dấu chấm tròn, các dòng sau thụt vào không dấu.

**Căn nguyên: hai client render `lst_1` khác nhau.** Zalo Web vẽ một dấu đầu
dòng cho MỖI DÒNG nằm trong span; Zalo trên điện thoại chỉ vẽ MỘT dấu cho cả
span rồi coi các dòng sau là xuống dòng mềm. Danh sách 9 mục hiện thành 1 mục.

Đây là hồi quy từ bản gộp span danh sách vừa làm - và là lỗi của cách nghiệm
thu: phép thử A1 chỉ được xem trên bản Web rồi kết luận "gộp được". MỘT client
không đủ để chốt hành vi render.

**Đã chốt: KHÔNG dùng `lst_1`/`lst_2`/`Indent` nữa.** Giữ nguyên ký tự "- " và
"1. " làm chữ thường (đề xuất của người dùng sau khi nhìn cả hai bản). Được ba
thứ cùng lúc:

- Chữ thường hiện y hệt nhau ở mọi client - hết hẳn lớp rủi ro này.
- Tốn 0 span cho danh sách, mà JSON định dạng chính là thứ đẩy tin vượt trần byte.
- Người dùng thấy "-" dễ đọc hơn dấu chấm tròn.

Hệ quả kèm theo: dòng trống quanh danh sách giờ phải GIỮ (trước thì bỏ, vì Zalo
tự chèn khoảng cách cho khối `lst_1`). Chỉ còn dòng trống quanh TIÊU ĐỀ là bỏ,
vì `f_18` vẫn tự có khoảng cách riêng.

**Số tin đo lại** (trần byte 3250, mật độ in đậm tiết kiệm theo persona mới):

| Nội dung | Span | Byte | Số tin |
|---|---|---|---|
| 20 dòng | 23 | 1992 | 1 |
| 40 dòng | 43 | 3792 | 2 |
| 60 dòng | 63 | 5592 | 2 |

Trước cả loạt sửa hôm nay, bản 40 dòng ra 4 tin và một tin mất định dạng.

**Kiểm chứng.** 1418 test xanh (2 lượt liên tiếp); `pnpm eval` 11/11. Phá code:
dựng lại luật "coi gạch đầu dòng là khối" thì 5 test đỏ.

**Bài học ghi lại.** Hành vi render của Zalo phải nghiệm thu trên CẢ Web lẫn
điện thoại trước khi chốt. Web là thứ dễ chụp màn hình nhất nên rất dễ dừng ở đó.

### Báo động giả và luật dòng trống đặt ngược (2026-08-05)

**1. Cảnh báo "đoạn quá nặng so với trần byte" là BÁO ĐỘNG GIẢ.** Dựng lại đúng
đoạn chữ của lượt 129 rồi quét mọi mật độ span (10 tới 80): không lần nào có
đoạn bị bỏ định dạng. Lỗi nằm trong chính dòng cảnh báo - nó đếm
`styles.length === 0`, mà một đoạn VỐN KHÔNG có chữ nào cần tô thì cũng rỗng.
Đúng ca đó: tin thứ hai chỉ là văn xuôi ("Xấp vé phía trên..." + "Nguồn đối
chiếu...") nên không có span nào.

Sửa: thêm cờ `boDinhDang` do `chiaTheoNganSachByte` đánh dấu, và tách hàm
`demDoanBoDinhDang` để phép phá code chạm được vào logic đếm - bản đầu để một
dòng `filter` ở nơi gửi nên phá code không bắt được.

**2. Luật dòng trống đặt NGƯỢC với thứ người dùng cần.** Bản trước bỏ dòng trống
quanh tiêu đề và giữ dòng trống quanh danh sách. Nhìn ảnh chụp thật thì phải
ngược lại - giả định "Zalo tự chèn khoảng cách cho `f_18`" là SAI, tiêu đề chỉ
là chữ to hơn chứ không có khoảng cách riêng. Luật mới dựng theo đúng chỗ người
dùng khoanh trên ảnh:

| Vị trí dòng trống | Xử lý | Lý do |
|---|---|---|
| Ngay TRƯỚC tiêu đề | GIỮ | ranh giới hai mục; thiếu thì câu kết dính vào tiêu đề mục sau |
| Ngay SAU tiêu đề | BỎ | tiêu đề và câu dẫn của nó thuộc về nhau |
| Giữa đoạn văn và DANH SÁCH ngay dưới | BỎ | danh sách là phần khai triển của chính câu đó |
| Sau khối danh sách | GIỮ | ranh giới sang ý khác |
| Giữa hai đoạn văn | GIỮ | - |

**Kiểm chứng.** 1423 test xanh (2 lượt). Phá code 3 lần: đếm theo
`styles.length` thay vì cờ (2 test đỏ), bỏ luôn dòng trống trước tiêu đề (1 test
đỏ), coi gạch đầu dòng là khối (nhiều test đỏ).

**Bài học.** Phép phá code chỉ chạm được thứ có test. Logic một dòng nằm trong
hàm lớn thì phá không tới - tách ra hàm nhỏ mới kiểm được.

### Chân trang nguồn/ngày được in đậm phần nhãn (2026-08-05)

Sau khi siết "in đậm tiết kiệm", model bỏ luôn in đậm ở đoạn kết nên dòng ghi
nguồn đọc ra trơ trọi. ĐÃ KIỂM trước khi kết luận: bộ cắt KHÔNG đánh rơi style ở
đoạn cuối (dựng lại đúng tin đó có thêm in đậm ở dòng cuối - đoạn 2 giữ nguyên
span), và log không có cảnh báo bỏ định dạng. Tức là model tự chọn không tô.

Thêm một dòng persona: dòng ghi nguồn/ngày ở cuối thì in đậm phần NHÃN. Đo chi
phí trước khi chốt - đúng +1 span, +33 byte, SỐ TIN KHÔNG ĐỔI ở cả 20/40/60 dòng.

Ăn khớp với luật đã có ở dòng "Độ dài theo việc" (chốt bằng nguồn + ngày).

1423 test xanh; `pnpm eval` 11/11.

## V3.6 - Màu chữ và gạch chân trên Zalo (2026-08-05)

Người dùng gửi ảnh một thư mời có màu cam/đỏ/xanh và hỏi bot làm được không.
Đưa đúng nội dung đó qua bộ dịch: ra 10 span đúng cấu trúc (tiêu đề to-đậm,
nhãn đậm, thơ nghiêng, emoji, link) - thiếu ĐÚNG một thứ là màu.

**Đo trước khi viết code** (rút kinh nghiệm hai lần sai vì nghiệm thu một
client). 9 tin thử, xem trên CẢ Zalo Web LẪN điện thoại:

| | Web | Điện thoại |
|---|---|---|
| 4 màu (đỏ/cam/vàng/xanh) | đúng | đúng |
| màu + đậm, màu + nghiêng | đúng | đúng |
| gạch chân, gạch chân + đỏ | đúng | đúng |
| `f_13` / `f_18` | đúng | đúng |
| `f_20/22/24/26` (đoán "Rất lớn") | đều BẰNG NHAU, không hơn `f_18` | như Web |

Thanh công cụ Zalo có 4 cỡ chữ nhưng enum zca-js chỉ khai 2. Bốn giá trị đoán
cho "Rất lớn" đều rơi về cùng một cỡ -> BỎ, dùng `f_18` cho tiêu đề là đủ.

**Quy ước: thẻ kiểu HTML.** `<do>` `<cam>` `<vang>` `<xanh>` `<gach>`. Markdown
không có cú pháp màu nên phải tự đặt. Lớp ký tự phủ định `[^<
]` giữ biểu thức
tuyến tính và chặn luôn việc lồng thẻ trong thẻ - đó cũng là điều mình muốn.
Thẻ thuần là DỮ LIỆU, không phải code do model sinh ra, nên không mở thêm đường
prompt injection.

**Việc khó nhất: thẻ LỒNG với dấu markdown.** `<cam>**Thời gian:**</cam>` là hình
dạng thường gặp nhất của nhãn trong thư mời. Bộ token hóa một tầng chỉ phát được
span ngoài, dấu `**` bên trong lọt ra thành chữ. Hai việc phải thêm:

- `moRong` thành ĐỆ QUY để nội dung trong token được mở tiếp
- Sau khi token hóa, quét LẠI chính nội dung đã cất (`cat[k].noiDung = tokenHoa(...)`).
  Không có bước này thì chỉ một chiều lồng chạy đúng: pass đậm chạy trước sẽ cất
  nguyên `<cam>X</cam>` vào kho, pass màu chỉ còn thấy token ở ngoài.

**Đường TẮT cũng phải bóc thẻ.** Persona vẫn dạy model cú pháp kể cả khi tắt cấu
hình định dạng, nên `lamSachTraLoi` thêm bước `boTheMau` - nhận nguyên chuỗi
`<cam>Thời gian:</cam>` còn tệ hơn mất màu.

**Persona: chỉ tô khi được yêu cầu.** Trò chuyện thường mà có màu thì đọc như
quảng cáo. Luật để thành MỘT KHỐI LIỀN (`KHOI_MAU_CHU`) kèm chú thích - đây là
ứng viên đầu tiên cho hệ thống skill, dời đi chỉ việc cắt nguyên khối.

**Vì sao CHƯA làm hệ thống skill.** Đã tra goclaw (`docs/15-core-skills-system.md`)
và Hermes (`agent/prompt_builder.py:1514`): cả hai chỉ để MỤC LỤC trong prompt
(tên + mô tả, ~100-150 token/skill) và nạp thân bài theo yêu cầu; goclaw bỏ hẳn
mục lục khi quá 40 skill hoặc 5000 token rồi thay bằng `skill_search` BM25;
Hermes có chế độ nén cả nhóm xuống chỉ còn tên. Mình MỚI CÓ MỘT hướng dẫn, mà
persona chỉ tăng 861 -> 1030 token - dựng bảng DB + trang dashboard + tool cho
một hướng dẫn là ngược YAGNI. Mốc để dựng: từ 3 hướng dẫn, hoặc persona vượt
~1500 token, hoặc cần sửa hướng dẫn mà không muốn vỡ prompt cache.

**Kiểm chứng.** 1433 test xanh (2 lượt); `pnpm eval` 11/11. Phá code 4 lần: bỏ
vòng token hóa lại, bỏ đệ quy, bỏ cờ `i` của regex, bỏ bước bóc thẻ ở đường tắt.

Phép phá thứ 4 **báo "không đỏ" một cách giả**: lệnh perl không khớp vì file có
xuống dòng CRLF, nên phá thành no-op. Chỉ phát hiện ra vì có kiểm lại rằng phép
phá ĐÃ ÁP ĐƯỢC. Đúng cái bẫy đã ghi trong memory - dùng công cụ sửa file thay vì
perl/sed cho file CRLF.

### Vá ngay sau khi dùng thật: thẻ vắt dòng và hồi quy "thôi hỏi lại" (2026-08-05)

**1. Thẻ màu vắt nhiều dòng lọt ra thành chữ.** Model viết thư mời như người ta
viết thật - bọc CẢ KHỐI trong một cặp dấu:

```
<cam>**THƯ MỜI THAM GIA
KHÓA THIỀN TỪ TÂN THÁNG 8**</cam>

<xanh>*Tháng Tám chớm thu gió dịu hiền,*
*Lời hẹn khóa thiền giữ vẹn nguyên.*</xanh>
```

Bộ dịch xử lý TỪNG DÒNG và mọi biểu thức inline đều kẹp bằng lớp phủ định có
`
`, nên cặp vắt dòng không bao giờ khớp.

Sửa: `multiline-markup-per-line.ts` rải dấu vắt dòng thành dấu từng dòng, chạy
TRƯỚC khi cắt dòng. RẢI chứ không cho span vượt dòng - span phủ qua ký tự xuống
dòng chính là thứ đã trả giá ở `lst_1` (hai client render khác nhau).

Thứ tự chốt: rải `**` TRƯỚC thẻ màu. Ngược lại thì `<cam>**A
B**</cam>` ra
`<cam>**A</cam>` - dấu sao mất vế đóng trên dòng đó rồi lọt ra chữ.

Quét bằng `indexOf` chứ không dùng biểu thức lười vượt dòng: `([\s\S]*?)` với
nhiều thẻ mở mà thiếu thẻ đóng cho ra bậc hai, mà bot đọc tin của người lạ.

**2. HỒI QUY: thêm luật màu xong thì bot thôi hỏi lại.** Cùng một nội dung dán
vào: 06:10 (trước) bot hỏi "muốn xử lý theo hướng nào", 06:51 (sau) tự trình bày
lại luôn. Người dùng phát hiện, không phải test.

Căn nguyên là CÂU CHỮ của luật: "CHỈ khi người dùng nhờ soạn thư mời, thông báo"
bị model đọc thành LOẠI NỘI DUNG chứ không phải LỜI YÊU CẦU - thấy nội dung là
thư mời thì tự cho là được phép.

Đo A/B thay vì suy đoán từ trùng hợp thời điểm - cùng tin, hai persona, 3 lần
mỗi nhánh:

| | Kết quả |
|---|---|
| CÓ khối màu (bản cũ) | 3/3 tự làm luôn |
| BỎ khối màu | 3/3 hỏi lại |
| CÓ khối màu (bản đã sửa câu chữ) | 3/3 hỏi lại |

Sửa: nói rõ "người dùng NÓI RÕ là muốn soạn/trình bày lại", kèm câu chốt "đoạn
dán vào trông giống thư mời KHÔNG có nghĩa là họ nhờ soạn thư mời".

**3. Emoji dẫn đầu dòng** cho thư mời/thông báo, chọn đúng nghĩa (🕐 giờ giấc,
📍 địa điểm, 📝 đăng ký, 🔗 đường dẫn, 🎁 ưu đãi, ⚠️ lưu ý). Một dòng một cái.

**Không phải lỗi.** "Bot gửi 2 tin" hóa ra là hai lượt trả lời cho HAI tin người
dùng nhắn (dán nội dung lúc 06:51:19, nhắn "format lại" lúc 06:51:32). Log không
có dòng cắt tin nào ở cả hai lượt.

**Kiểm chứng.** 1439 test xanh; `pnpm eval` 12/12. Phá code 2 lần cho phần rải
(bỏ hẳn bước rải, đảo thứ tự `**` với thẻ) đều bị bắt.

Thêm ca eval `dan-vao-thi-hoi-lai` ghim đúng hồi quy này, và ĐÃ PHÁ để kiểm: trả
câu chữ về bản mơ hồ cũ thì ca đó đỏ.

### Eval nhìn thấy ĐỊNH DẠNG, và luật viết theo nguyên tắc (2026-08-05)

Người dùng hỏi "bạn làm được gì" và nhận về mười mấy gạch đầu dòng phẳng lì.
Kèm câu hỏi đáng giá hơn nhiều: "sao cứ có case nào tôi phát hiện ra thì mới
chỉnh lại vậy?"

**Nguyên nhân trực tiếp: luật của chính mình cấm đúng thứ đang cần.** Luật viết
sáng nay là "chỉ tô CON SỐ hoặc KẾT LUẬN". Danh sách khả năng không có con số
cũng không có kết luận, nên theo đúng luật thì không gì được in đậm - model làm
đúng y lời dặn, đầu ra xấu là lỗi luật.

**Nguyên nhân gốc: eval MÙ HOÀN TOÀN với định dạng.** `kiemTraText` nhận chữ
TRẦN sau khi đã dịch markdown, lúc đó dấu `**` biến mất rồi. Mọi ca eval chỉ
khẳng định được "không rò ký tự markdown ra chữ", không đo được có in đậm hay
không. Giới hạn này đã ghi vào roadmap lúc sáng rồi bỏ qua - nên máy không có
cách nào bắt lỗi trình bày, chỉ mắt người dùng bắt được.

Hệ quả: luật persona đắp thêm theo từng ca lẻ. Nhìn lại một ngày - "chỉ tô con
số" (khi tin bị cắt vụn), "riêng dòng nguồn thì tô nhãn" (khi đoạn cuối trơ),
"chỉ tô khi nói rõ" (khi bot thôi hỏi lại). Luật rồi ngoại lệ rồi ngoại lệ.

**Đã làm - ba việc, thứ tự có lý do:**

1. `eval-formatting-view.ts` + bắt `payload.styles` ở `fake-zalo-api.ts` +
   khẳng định `kiemTraDinhDang`. Mảnh hạ tầng thiếu; không có nó thì hai việc
   sau vô nghĩa. Góc nhìn kèm ĐOẠN CHỮ mà mỗi span phủ, không chỉ mã style -
   "có 5 span đậm" gần như vô nghĩa, "span đậm phủ đúng mấy chữ đầu mỗi mục" mới
   là thứ người đọc cảm nhận được.
2. Thay 2 luật hẹp bằng 1 NGUYÊN TẮC: "in đậm đúng cái người đọc lướt mắt tìm".
   Cộng luật gom nhóm khi danh sách quá 6-7 mục.
3. Ba ca eval cho BA DẠNG TIN khác nhau: `danh-sach-de-luot-mat` (danh sách dài
   phải scan được), `tro-chuyen-thi-dung-trang-tri` (chuyện phiếm phải KHÔNG có
   định dạng), `thu-moi-khi-duoc-nho` (chiều khẳng định của luật màu).

**Quyết định đã chốt - đừng lật lại nếu không có bằng chứng mới**

- Ca khẳng định định dạng mà người chạy KHÔNG cung cấp `dinhDang` thì chấm HỎNG,
  tuyệt đối không bỏ qua lặng lẽ. Bỏ qua là đúng kiểu xanh giả mà cả `eval-assert.ts`
  sinh ra để chặn: case tuyên bố đo định dạng nhưng thực tế không đo gì.
- Ca `dan-vao-thi-hoi-lai` (phủ định) đi CẶP với `thu-moi-khi-duoc-nho` (khẳng
  định). Thiếu một trong hai thì sửa luật lệch hướng nào cũng còn nửa số ca xanh.

**Kiểm chứng.** 1447 test xanh; `pnpm eval` 15/15. Phá code 3 lần:

- Bỏ nhánh "thiếu dinhDang thì hỏng" -> test bộ chấm đỏ
- Cắt sai lát chữ (`slice(start, len)`) -> test góc nhìn đỏ. Lần đầu CHỈ 1/2 test
  bắt được vì fixture dùng `start = 0`, lúc đó hai công thức ra kết quả y hệt -
  đã sửa fixture dùng `indexOf` thay vì đếm tay
- QUAN TRỌNG NHẤT: trả luật persona về bản "chỉ tô con số hoặc kết luận" rồi chạy
  eval -> `danh-sach-de-luot-mat` ĐỎ với đúng lý do người dùng đã nêu bằng mắt.
  Đây là bằng chứng việc "người dùng phát hiện" đã chuyển thành "eval phát hiện".

### Danh sách khả năng: đánh số, có icon, và bớt khoe việc vặt (2026-08-05)

Người dùng đối chiếu với một bot khác: "sao con của mình nó xấu vậy, học kiểu con
màu vàng được không, có số thứ tự rõ ràng kìa" - kèm một câu sắc hơn: "xem giờ
cụ thể thì tôi cũng xem được, đưa vào năng lực của AI làm gì".

**Việc 1 - bỏ khoe tool là hạ tầng.** Mục "Khả năng" liệt kê THẲNG từ danh bạ
tool, nên `get_datetime` ("Ngày giờ hiện tại") và `add_reaction` ("Thả cảm xúc")
cũng lọt vào danh sách giới thiệu. Thêm cờ `keTrongKhaNang` vào `ToolDefinition`,
mặc định CÓ - phải khai tường minh `false` mới bị loại, để tool mới thêm không
âm thầm biến mất.

Lọc ở `toolCapabilitySection` chứ KHÔNG ở `listAvailableTools`: model vẫn nhận
schema và gọi bình thường, chỉ là không đem ra quảng cáo. Khác hẳn việc tắt tool.

**Việc 2 - đánh số và icon.** Viết theo NGUYÊN TẮC chứ không phải "hễ ai hỏi làm
được gì thì...": danh sách các mục ĐỘC LẬP VÀ ĐÁNG ĐẾM (khả năng, các bước, các
phương án) thì đánh số + emoji + in đậm tên mục; danh sách các ý BỔ TRỢ cho câu
ngay trên nó thì gạch đầu dòng. Cách phát biểu này tự phân loại được ca chưa gặp
- ví dụ các dòng đối chiếu số vé là ý bổ trợ nên vẫn gạch đầu dòng.

**Kiểm chứng.** 1449 test xanh; `pnpm eval` 14/15 (ca đỏ là `ngay-co-san`, flake
CÓ SẴN - chạy riêng 3/3 đạt, và đã kiểm từ trước bằng cách hoàn persona về bản cũ
thì vẫn đỏ).

Mở rộng ca `danh-sach-de-luot-mat`: ngoài khẳng định in đậm, giờ đòi thêm CÓ ĐÁNH
SỐ, CÓ EMOJI, và KHÔNG nhắc tới việc xem ngày giờ.

Phá code 2 lần: bỏ bộ lọc `keTrongKhaNang` -> test persona đỏ; test đối chứng
chiều ngược (tool đáng khoe vẫn phải có mặt) chặn ca đánh dấu nhầm hàng loạt.

Sửa kèm 2 test cũ bị ảnh hưởng hợp lý:
- `run-agent-turn.test.ts` dùng `add_reaction` làm đối chứng cho lượt cô lập, mà
  giờ nó bị loại ở CẢ HAI lượt nên không phân biệt được nữa - đổi sang
  `save_memory`.
- Fixture của ca "tool đáng khoe" ban đầu lấy `create_image`, mà tool đó có
  `available()` kiểm cấu hình nên môi trường test không cấp - đỏ oan, đã đổi.

### Model bắt chước chính nó: luật mới bị lịch sử cũ đè (2026-08-05)

Người dùng hỏi lại "bạn làm được gì" sau khi sửa luật và báo "vẫn như cũ, chả
khác gì". Ba lớp kiểm tra, hai lớp đầu loại trừ được nghi vấn:

**Không phải code cũ.** Lượt 16:18 chạy trên tiến trình khởi động 16:17:39, sau
lần sửa cuối lúc 15:34. Xác định bằng cách dò `pid` trong log chứ không tin dòng
"đăng nhập" (dòng đó là listener kết nối lại, không phải tiến trình mới).

**Không phải persona riêng của agent nuốt luật.** A/B trên đúng bộ dựng prompt
production, persona rỗng và persona thật đều ra: đánh số CÓ, emoji CÓ, không
khoe xem giờ - 2/2 mỗi nhánh.

**Là LỊCH SỬ HỘI THOẠI.** Bằng chứng không thể chối: cụm "Xem ngày giờ chính xác"
KHÔNG CÒN trong prompt (đã lọc bằng `keTrongKhaNang`), vậy mà câu trả lời 16:18
vẫn viết gần như nguyên văn câu 14:57:

```
14:57  - Xem ngày giờ chính xác: theo múi giờ Việt Nam.
16:18  - Xem ngày giờ chính xác theo giờ Việt Nam.
```

Model không lấy cụm đó từ đâu ngoài chính câu trả lời cũ của nó. Bình thường
việc bắt chước này là TÍNH NĂNG (giữ giọng nhất quán trong một cuộc trò chuyện),
nhưng nó làm luật vừa sửa bị đè.

**Đã làm:** thêm một dòng persona nói thẳng "luật trình bày thắng mọi ví dụ cũ
trong lịch sử". Đo trên đường `generateText` với persona thật + lịch sử thật:
không có dòng đó 2/2 lần chép kiểu cũ, có dòng đó 4/4 lần theo luật mới.

**Hạ tầng eval:** thêm `lichSuTruoc` cho `EvalCase` (gieo lịch sử trước khi gửi
tin) và `PERSONA_KIEU_THAT` (persona riêng kiểu thật, vì `run-eval.ts` mặc định
dựng agent persona RỖNG còn bot thật luôn có persona cả nghìn ký tự).

**GIỚI HẠN PHẢI GHI RÕ:** ca eval `luat-thang-lich-su-cu` KHÔNG tái hiện được
lỗi. Bỏ dòng persona ra rồi chạy lại: 3/3 vẫn ĐẠT, kể cả khi đã gieo persona
kiểu thật và chép đúng hình dạng câu trả lời cũ (10 mục, phẳng). Nghĩa là ca đó
hiện chỉ ghim hành vi đúng chứ CHƯA chứng minh được nó bắt lỗi - khác hẳn ca
`danh-sach-de-luot-mat` (đã phá và thấy đỏ). Chênh lệch còn lại giữa eval và
production chưa xác định được; nghi ở tầng dựng ngữ cảnh của agent-loop (dấu
thời gian, cắt cửa sổ) nhưng chưa đo.

Ghi lại để lần sau ai đọc không tưởng ca đó là lưới chắc.

**Hệ quả thực dụng:** sửa luật trình bày CHỈ thấy ngay trong cuộc trò chuyện
MỚI. Thread đang có nhiều câu trả lời kiểu cũ thì model còn bị kéo về kiểu đó
một thời gian.

**Kiểm chứng.** 1449 test xanh; `pnpm eval` 16/16.

### Luật bỏ dòng trống quá rộng: mục đánh số dính vào tin trước (2026-08-05)

Bản tin công nghệ: mỗi tin là một mục đánh số, kết bằng dòng nguồn và URL. Mục
sau dính luôn vào URL của tin trước, trong khi các mục khác vẫn có khoảng cách -
nhìn ra là cách dòng lộn xộn.

**Căn nguyên.** Luật "BỎ dòng trống giữa đoạn văn và DANH SÁCH ngay dưới nó" nổ
cả khi đoạn trên chẳng dẫn vào danh sách. Ý định ban đầu chỉ nhắm ca "Đối chiếu
vé 645300:" rồi tới các mục - danh sách là phần khai triển của chính câu đó.

**Dấu hiệu phân biệt: câu dẫn KẾT THÚC BẰNG DẤU HAI CHẤM.** Thêm `laCauDan`, chỉ
bỏ dòng trống khi dòng trên đúng là câu dẫn. Đo lại: bản tin giữ khoảng cách
giữa các mục, còn "Đối chiếu vé 645300:" vẫn dính liền danh sách như trước.

**Kiểm chứng.** 1450 test xanh; `pnpm eval` 16/16. Phá code: bỏ điều kiện
`laCauDan` thì ca "GIỮ dòng trống trước mục danh sách khi đoạn trên KHÔNG dẫn
vào nó" đỏ ngay.

## V3.7 - Vẽ ảnh hụt thì vẽ lại một lần (2026-08-05)

Người dùng vẽ infographic trên Zalo thật, nhận về đúng một lời hứa rồi im. Log
turnId 166: `Codex did not return an image. Account may not be entitled
(Plus/Pro required).`

### Câu lỗi nói sai chuyện

Câu đó không phải của tài khoản, cũng không phải của bot - nó là **nhánh bắt
tất** trong chính router (`9router/open-sse/handlers/imageProviders/codex.js:124`
và `:194`), bắn ra mỗi khi stream Codex chạy hết mà không thấy
`image_generation_call` nào có `result`. Phần "Plus/Pro required" là router
ĐOÁN, không phải điều upstream nói.

Nguyên nhân thật nằm ở `codex.js:176`: router gửi **`tool_choice: "auto"`**, nên
model upstream tự quyết có gọi tool vẽ hay không. Nó chọn trả lời bằng chữ là
stream kết thúc sạch sẽ mà chẳng có ảnh nào.

**Ba phép đo bác bỏ giả thuyết "tài khoản thiếu quyền":**

| Phép đo | Kết quả |
|---|---|
| Lượt hỏng chạy bao lâu rồi mới lỗi | **129,9 giây** - thiếu quyền thì bị chối trong vài giây |
| Gọi lại bằng key tạm, cùng pool | **9/9 ra ảnh** (3 prompt đơn giản, 3 tên model, 3 prompt infographic tiếng Việt nặng chữ dựng lại gần giống lượt hỏng) |
| `cx/gpt-5.5-image` trong `/v1/models` | KHÔNG có, nhưng endpoint ảnh định tuyến riêng nên vẫn đúng - đừng suy ra sai cấu hình từ danh sách model |

### Vì sao fallback của router không cứu được

`imageGenerationCore.js:179` trả `{success: true, response: sseResponse}` NGAY
KHI stream mở. Đi đường SSE (bot luôn gửi `Accept: text/event-stream`) là router
đã chốt HTTP 200 và đã chọn xong connection trước khi biết có ảnh hay không;
`event: error` nằm trong thân stream nên vòng fallback ở `imageGeneration.js:131`
không nhìn thấy. Không có cách nào chữa ca này ở phía router.

**Round robin cũng không phải thuốc.** 9router có hai nút trùng tên: một xoay
vòng CONNECTION cùng provider (`auth.js:110-150`), một xoay vòng MODEL trong một
combo (`combo.js:157`). `cx/gpt-5.5-image` là model đơn nên nút thứ hai không
chạy tới; nút thứ nhất chỉ đổi *chọn tài khoản nào trước*, mà lỗi lộ ra SAU khi
đã trả 200. Nó chữa "một tài khoản chết", không chữa "model không chịu vẽ".
Thêm một giá phải trả: rải request ra nhiều tài khoản làm giảm tỉ lệ trúng prompt
cache của luồng chat.

### Bản sửa

Thử lại **đúng một lần**, chỉ cho lớp lỗi "chạy xong mà không ra ảnh"
(`src/images/image-retry-policy.ts`). Lớp lỗi được gắn NGAY tại chỗ đọc stream -
chỗ duy nhất còn nhìn thấy câu gốc của provider; lên tới tool thì nó đã lẫn vào
mọi lỗi khác.

- **Hai đường nhận diện, xếp theo độ tin cậy giảm dần**: lỗi do chính mình ném
  (`LoiVeHutAnh`, bền vững) và chữ của provider (chỉ dùng cho `event: error`, vì
  lúc đó câu lỗi là thứ duy nhất provider đưa). Router đổi hành văn thì nhánh
  sau ngừng khớp và ta rơi về KHÔNG thử lại - hỏng theo hướng an toàn.
- **KHÔNG thử lại**: quá hạn và mất tín hiệu (tiêu thêm trọn một trần thời gian
  nữa mà nguyên nhân chưa hết), HTTP 4xx (sai key, hết quota - lần sau y hệt),
  Content-Type lạ (trang lỗi hạ tầng, không phải model đổi ý).
- **Đúng một lần, không phải ba**: mỗi lần vẽ tốn 1-3 phút; thử tới lần ba là
  kéo người ta chờ 6 phút rồi mới biết hỏng.
- **Nhắn báo trước khi vẽ lại.** Lần hụt đã ngốn 130 giây trong khi đầu lượt hứa
  "1-3 phút" - thử lại âm thầm là bắt họ ngồi im gần 4 phút không lý do. Câu báo
  nói THẲNG "lần vẽ đầu chưa ra ảnh" chứ không ậm ừ "vẫn đang xử lý", và vào
  history như mọi tin thật.
- **Lần vẽ lại KHÔNG trừ thêm suất** trong trần ảnh mỗi giờ: bắt trả giá hai
  suất cho một tấm ảnh là phạt người dùng vì lỗi của provider.
- Nhắn hụt không được làm chết lượt vẽ - gửi được ảnh quý hơn gửi được lời nhắn.

**Kiểm chứng.** 1475 test xanh (+25), typecheck sạch. Phá code 5 phép, cả 5 đều
đỏ: bỏ hẳn việc vẽ lại (10 test), vẽ lại mà không nhắn (5), coi mọi lỗi là đáng
vẽ lại (7), không phân lớp lỗi ở SSE (1), lần vẽ lại trừ thêm suất (1).

### Việc còn treo

- Không tái hiện được lỗi trong 9 lần gọi thật, nên **chưa đo được tần suất**.
  Bản sửa dựa trên lập luận về cơ chế (`tool_choice: "auto"`) chứ không phải
  trên một mẫu thống kê.
- Nhánh "mất tín hiệu" cố ý không thử lại. Nếu về sau thấy nó cũng chập chờn thì
  cân nhắc lại - giá của nó chỉ là một trần im lặng (90 giây), rẻ hơn quá hạn.

## V3.7.1 - Đổi sang Gemini là bot câm: một `z.tuple()` giết cả bộ tool (2026-08-06)

Đổi nhà cung cấp LLM sang Google Gemini trên dashboard. Nút "Test kết nối" xanh,
model trả lời "Ok". Nhưng mọi tin nhắn đều chết: `AI_APICallError 400 Bad
Request`, `steps: 0` - lượt tắt trước khi model kịp nghĩ gì.

### Câu lỗi thật

Log của bot cắt mất thân lỗi, nên phải gọi lại endpoint để lấy nguyên văn:

```
schema at properties.sheets.items.properties.rows.items.items.anyOf.2
  .properties.columns.items must be a boolean or an object
```

Lần theo đường dẫn ra `document-content-schema.ts:82`:
`columns: z.tuple([columnLetter, columnLetter])`.

`z.tuple()` dịch ra JSON Schema kiểu **draft-07**, ở đó tuple viết bằng `items`
là một **MẢNG**:

```json
{"type":"array","items":[{"type":"string",...},{"type":"string",...}]}
```

Lớp OpenAI-compatible của Google chỉ nhận **2020-12**, ở đó `items` bắt buộc là
object hoặc boolean. Thấy mảng là chối CẢ REQUEST.

### Vì sao tới giờ mới lộ, và vì sao nó nặng

- **"Test kết nối" mù ca này**: nút đó gửi một câu chat trần, KHÔNG kèm tool nào.
  Schema hỏng không có mặt trong request nên xanh là đương nhiên.
- **9router / OpenAI / Anthropic đều nuốt dạng draft-07**, nên lỗi nằm im suốt
  từ ngày viết tool Excel tới lúc đổi nhà cung cấp.
- **Bộ tool đi kèm MỌI lượt**, nên hỏng một schema là hỏng mọi tin nhắn, không
  riêng lượt nào nhờ làm Excel. Đây là chỗ khiến nó thành lỗi chặn hoàn toàn
  chứ không phải lỗi một tính năng.

### Cách khoanh vùng

Bắn từng mảnh payload một, không đoán:

| Phép đo | Kết quả |
|---|---|
| Chat trần / `max_tokens` / `reasoning_effort` / `stream` / tool có tham số / tool không tham số | **7/7 ra 200** - loại hết giả thuyết "model không hỗ trợ" |
| Bắn từng tool thật một trong 13 tool | **12 qua, đúng `create_excel_file` chối** |
| A/B `z.tuple` với `z.array().length(2)` cùng một request | **400 với 200** |
| Nghiệm thu lại cả 13 tool sau khi sửa | **200**, model stream trả lời tiếng Việt bình thường |

### Bản sửa

`columns: z.array(columnLetter).length(2)`. Ràng buộc lúc chạy y hệt tuple (đúng
2 phần tử, mỗi phần tử khớp `^[A-Za-z]{1,2}$`, vẫn tự viết hoa), còn JSON Schema
ra `{"type":"array","items":{...},"minItems":2,"maxItems":2}` - dạng mọi nhà
cung cấp đều nhận. Kiểu TS đổi từ `[string, string]` sang `string[]`; repo không
bật `noUncheckedIndexedAccess` nên 4 chỗ dùng `columns[0]`/`columns[1]` không vỡ.

**Test chặn cả LỚP lỗi** (`tool-schema-provider-compat.test.ts`): quét cây JSON
Schema của cả 13 tool, đỏ nếu có `items` nào là mảng. Ai thêm `z.tuple()` vào
tool mới thì biết ngay tại chỗ, thay vì đợi đổi nhà cung cấp rồi bot câm mới lộ.
Kèm hai khẳng định về chính bộ quét: nó phải dựng đủ 13 tool, và phải đi tới
được nhánh sâu nhất - thiếu hai cái đó thì một bộ quét rỗng cũng đọc ra như đạt.

### Phá code bắt được một lỗ hổng thứ hai

Phép phá "bỏ `.length(2)`" ban đầu **không làm test nào đỏ**. Hồi còn `z.tuple()`
thì độ dài do KIỂU giữ nên chưa ai cần test; bản sửa chuyển nó thành ràng buộc
LÚC CHẠY mà không có người canh. Thiếu nó thì `columns[1]` là undefined và công
thức ghi ra file thành `B5*undefined5`. Đã thêm test "đúng 2 cột, thiếu hay thừa
đều bị chối"; sau đó cả 4 phép phá đều đỏ.

**Kiểm chứng.** 1479 test xanh (+4), typecheck sạch, nghiệm thu thật trên Gemini
với đủ 13 tool ra 200.

### Việc còn treo

- "Test kết nối" vẫn không gửi tool nên vẫn mù với lớp lỗi này. Muốn nó phát
  hiện được thì phải cho gửi kèm bộ tool thật - chưa làm, vì test hiện tại rẻ và
  nhanh, còn bộ quét schema đã chặn từ phía CI rồi.

## V3.7.2 - Google (Gemini) thành nhà cung cấp hạng nhất (2026-08-06)

Sửa xong lỗi schema Excel thì lượt Gemini đi tới được step 2 rồi chết ở đó:

```
Function call is missing a thought_signature in functionCall parts.
```

### Căn nguyên

Gemini 3.x trả kèm mỗi function call một chữ ký suy luận và BẮT BUỘC nhận lại nó
ở lượt sau. Qua lớp giả OpenAI của Google, chữ ký nằm ở
`tool_calls[].extra_content.google.thought_signature` - trường NGOÀI chuẩn
OpenAI, nên `@ai-sdk/openai-compatible` bỏ mất khi parse.

Hệ quả: **mọi lượt có gọi tool đều chết, chat chay thì sống**. Bot này gọi tool ở
gần như mọi lượt, nên gần như câm hoàn toàn - nhưng vì chat chay vẫn trả lời nên
nhìn từ ngoài rất khó đoán.

| Phép đo | Kết quả |
|---|---|
| Gửi trả `extra_content` | 200 OK |
| Bỏ `extra_content` | 400 |
| Bỏ `reasoning_effort`, hoặc để `low` | vẫn 400 |
| `reasoning_effort: "none"` | 400 khác (`invalid argument`) |
| Assistant thường (không tool) rồi user | 200 |

Không có đường vòng nào ở phía tham số.

### Vì sao chọn provider native chứ không vá ở tầng fetch

Bản đầu tôi đề xuất bọc `fetch` để tự giữ và gắn lại chữ ký - seam đó đã có sẵn
(`llm-provider.ts` truyền `fetch: sanitizingFetch`). Người dùng hỏi lại vì sao
không dùng provider chính chủ, và câu hỏi đó đúng: tra ra
[vercel/ai#10344](https://github.com/vercel/ai/issues/10344) và
[#11413](https://github.com/vercel/ai/issues/11413) - cả hai ĐÃ ĐÓNG, `@ai-sdk/google`
lo phần chữ ký. Tự vá lại thứ thư viện chính chủ đã lo là ôm nợ kỹ thuật không
có lý do.

Đo lại bằng vòng lặp tool thật trước khi dựng: 2 step, 1 lần gọi tool, trả lời
tiếng Việt, không lỗi nào.

### Bản dựng

- **Gom kiểu provider về một chỗ** (`config/llm-provider-kind.ts`). Union này
  từng chép tay ở bốn nơi (env, runtime settings, override của agent, reasoning
  options); thêm nhà cung cấp là sửa cả bốn. Giờ thêm một dòng.
- **Nhánh `google`** trong `resolveLanguageModel`, dùng `@ai-sdk/google` 4.0.33.
- **`baseUrlChoGoogle`** làm hai việc, cả hai vì base URL cũ NẰM LẠI trong DB khi
  người dùng đổi ô "Kiểu kết nối" (form chỉ ẩn ô, không xóa giá trị):
  gỡ đuôi `/openai` (lớp giả, trỏ vào là 404 - mà nút chọn nhanh cũ điền đúng
  URL đó nên người dùng cũ chắc chắn có), và BỎ HẲN base URL của hãng khác
  (OpenRouter, 9Router) thay vì gửi khóa Google sang bên thứ ba. Khớp host bằng
  neo `(^|\.)googleapis\.com$` chứ không phải "có chứa" - `googleapis.com.evil.example`
  lọt qua phép khớp lỏng.
- **Mức nghĩ**: Gemini có 4 nấc còn bot có 5. `off` -> `minimal` (Gemini 3 không
  tắt hẳn nghĩ được; bỏ tham số là để model tự chọn, đúng thứ `off` muốn tránh),
  `xhigh` -> `high`. Gửi giá trị ngoài danh sách là 400 cả lượt.
- **Bỏ preset "Google Gemini"** khỏi danh sách chọn nhanh của OpenAI-compatible -
  nó dẫn thẳng vào cái bẫy. Ai còn cấu hình cũ thì form hiện cảnh báo kèm cách
  sửa, vì bỏ preset chỉ chặn người mới.
- **Chốt chặn rò khóa** (`doiProviderAnToan`) và **phát hiện vision** đều phủ
  provider mới; `laGoiThangHang` gom hai nhà gọi thẳng lại một khái niệm.

### Lỗi phụ sửa kèm

Log lượt hỏng có dòng "Ghi nhớ model không đọc được ảnh" trong khi lượt đó
`images: 0`. Lý do: `isImageRejectionError` khớp MỌI 4xx trừ 401/403/429, còn
`hasImageParts` nhìn cả LỊCH SỬ chứ không riêng tin mới - thread đó có ảnh cũ.
Một lỗi 400 chẳng liên quan gì tới ảnh bị quy cho ảnh, và Gemini (đọc ảnh được)
bị ghi là mù trong 10 phút. Nay đường gọi thẳng hãng không bao giờ bị đánh dấu.

### Kiểm chứng

1498 test xanh (+19), typecheck sạch (cả backend lẫn dashboard). Phá code 8 phép,
cả 8 đều đỏ: bỏ lá chắn host, khớp host kiểu "có chứa", không gỡ `/openai`, sai
quy đổi `off`, sai quy đổi `xhigh`, Google lại đi tra `/models` của router, đưa
preset bẫy trở lại, chốt chặn rò khóa quên nhánh google.

Nghiệm thu cuối chạy ĐÚNG đường sản xuất (`resolveLanguageModel` +
`reasoningProviderOptions` thật, base URL cố ý để nguyên đuôi `/openai` như cấu
hình cũ): 2 step, 1 lần gọi tool, trả lời tiếng Việt, không 400.

### Việc còn treo

- Gemini qua ROUTER (9Router proxy) vẫn sẽ dính lỗi chữ ký, vì đường đó là
  `openai-compatible`. Chưa gặp nên chưa làm; nếu cần thì seam `fetch` ở
  `llm-provider.ts` là chỗ để vá.
- `isImageRejectionError` vẫn khớp mọi 4xx cho nhánh router. Suy luận chắc hơn
  là chỉ ghi "model mù" khi lượt thử lại KHÔNG kèm pixel thật sự thành công -
  chưa làm, để tránh gộp việc ngoài phạm vi đã duyệt.

## V3.7.3 - Form nhà cung cấp: ô của hãng cũ nằm lại sau khi đổi (2026-08-06)

Sau khi lưu Google, người dùng bấm thử Anthropic thì ô Model vẫn là
`gemini-3.5-flash-lite`; quay về OpenAI-compatible thì Base URL vẫn là endpoint
của Google và cảnh báo vàng nổi lên. Nhìn như dashboard hỏng.

**Cấu hình đã lưu thì đúng** - DB ghi `llm_provider = google`. Cái thấy trên màn
là BẢN NHÁP chưa lưu: ô "Kiểu kết nối" chỉ đổi mỗi `form.provider`, còn Model và
Base URL là hai ô riêng giữ nguyên giá trị nạp lúc mở trang. F5 là về đúng.

Nhưng đào ra hai lỗi thật đứng sau:

1. **Lưu được tổ hợp vô nghĩa.** Chọn Anthropic rồi bấm Lưu ngay là DB nhận
   `provider=anthropic` + `model=gemini-3.5-flash-lite`, bot chết ở lượt kế
   tiếp. Chính comment trong file viết "bốn giá trị này phải đi cùng nhau",
   nhưng đổi nhà cung cấp lại không dọn hai ô vốn thuộc về nhà cũ.
2. **Base URL của nhà cũ nằm lại VĨNH VIỄN.** `updateLlmSettings` coi
   `undefined` là "giữ nguyên", mà form gửi `form.baseUrl || undefined`. Nên
   chuyển sang Anthropic/Google không xóa được URL cũ, và nó hiện lại mỗi lần
   quay về. Đây là lý do cảnh báo vàng cứ nổi lên.

Đây là hành vi có sẵn từ trước; thêm nhà cung cấp thứ ba mới làm nó lộ ra.

### Bản sửa

- Lớp cấu hình phân biệt **"giữ nguyên" (bỏ trường) với "xóa hẳn" (`null`)**.
  `LlmSettingsUpdate.baseUrl?: string | null`; route nhận `nullish()`. Xóa
  override chứ không nuốt luôn cấu hình máy chủ - vẫn rơi về env.
- Đổi "Kiểu kết nối" thì **dọn cả Model lẫn Base URL**. Quay VỀ nhà cung cấp
  đang lưu thì khôi phục nguyên giá trị đã lưu: bấm nhầm rồi bấm lại là chuyện
  thường, bắt gõ lại tên model chỉ là ma sát.
- Lưu nhà cung cấp gọi thẳng hãng thì gửi `baseUrl: null`, tức xóa hẳn. Ô để
  trống ở nhánh `openai-compatible` VẪN là "giữ nguyên" như cũ - đổi chỗ đó
  thành xóa là ô trống sẽ thổi bay cấu hình đang chạy.
- Hai quyết định trên tách ra module thuần `provider-form-fields.ts` để test
  được: hook React không test được bằng `node:test` trần.

### Kiểm chứng

1508 test xanh (+10), typecheck sạch. Phá code 6 phép, cả 6 đều đỏ: không dọn ô,
dọn cả khi quay về nhà đang lưu, gửi `undefined` thay `null`, ô trống thành
xóa, `null` bị coi là giữ nguyên, xóa base URL xóa lây cả model.

### Bài học về chính phép phá

Một phép phá dùng mỏ neo NHIỀU DÒNG với `
` không khớp vì file là CRLF, và nó
im lặng báo "không tìm thấy" thay vì chạy. Nếu bộ chạy không khẳng định mỏ neo
tồn tại thì kết quả "không đỏ" đọc ra y hệt test rỗng. Mỏ neo phải một dòng, và
luôn khẳng định chuỗi cần thay có thật.

## V3.7.4 - Enum số: cái bẫy thứ hai cùng họ, và một bộ quét suýt vô dụng (2026-08-06)

Đổi xong sang provider native của Google thì lượt thật vẫn chết:

```
Invalid value at 'tools[0].function_declarations[7].parameters.properties[2]
  .value.items.one_of[0].properties[2].value.any_of[0].enum[0]' (TYPE_STRING), 1
```

`document-content-schema.ts`: cấp tiêu đề khai
`z.union([z.literal(1), z.literal(2), z.literal(3)])`. `Schema.enum` của Google
là `repeated string`, không nhận số.

### Quét cả bộ thay vì vá từng cái

Ba lượt liên tiếp đều là "sửa xong lại lỗi tiếp", nên lần này bắn TỪNG tool sang
API native của Google trước khi sửa: **12 qua, đúng `create_word_document` hỏng**.
Đó là chỗ cuối. Sau khi sửa quét lại: **13/13 qua, và cả bộ 13 tool cùng lúc
cũng qua**.

### Bản sửa

`level: z.number().int().min(1).max(3).default(2)` - ra
`{"type":"integer","minimum":1,"maximum":3}`, không sinh `const`/`enum` nên
không vướng, mà vẫn chặn 0, 4 và số lẻ y như union.

Kiểu TS đổi từ `1|2|3` sang `number` nên `HEADING_BY_LEVEL[block.level]` không
index được. KHÔNG ép kiểu: thay bằng `headingCuaCap()` có nhánh mặc định rõ
ràng, để nới khoảng ở schema về sau thì chỗ này vẫn ra tiêu đề hợp lệ chứ không
ra `undefined`.

### Bộ quét lần trước đóng sai lỗ

Bộ quét viết ở V3.7.1 chỉ kiểm MỘT luật (`items` không được là mảng). Nó đóng
đúng cái lỗ vừa gặp chứ không đóng cả lớp, nên lỗi kế tiếp cùng họ vẫn ra tới
người dùng. Nay kiểm hai luật.

**Và luật mới suýt vô dụng.** Bản đầu chỉ nhìn `enum`, vì câu lỗi của Google nói
`enum[0]`. Phá code mới lộ ra: trả `level` về union literal mà bộ quét KHÔNG đỏ.
Lý do - zod sinh `anyOf: [{type:"number",const:1}...]`, KHÔNG hề có `enum`;
chính provider Google trong AI SDK mới gộp `const` thành `enum` lúc dựng
`functionDeclarations`. Luật phải nhìn `const`. Đây là ca mà đọc câu lỗi của
nhà cung cấp rồi suy ngược ra hình dạng dữ liệu mình gửi đi là SAI.

### Kiểm chứng

1513 test xanh (+5), typecheck sạch. Bảy phép phá: sáu phép đỏ đúng như cần
(trả về union literal, bỏ `.int()`, bỏ khoảng, mất mặc định, hàm tra cấp trả
nhầm, bỏ khẳng định chống rỗng), một phép ĐỐI CHỨNG cố ý kỳ vọng XANH - bỏ
nhánh `const` rồi đưa lại union literal thì bộ quét không bắt được, đúng bằng
chứng cho thấy nhánh `const` mới là thứ làm việc.

Nghiệm thu thật trên Google: 13/13 tool, và cả bộ cùng lúc.

## V3.7.5 - Bot tìm mà không đọc, và trần bước quá chật (2026-08-06)

Chạy Gemini xong, câu trả lời "tóm tắt 10 tin kinh tế" ra 10 mục toàn ý chung
chung: không con số, không mốc thời gian, không nguồn. Người dùng hỏi đây là
giới hạn model hay thinking không chạy.

### Ba nghi ngờ, ba số đo

| Nghi ngờ | Số đo (log lượt 188) | Kết luận |
|---|---|---|
| Không thinking được? | `reasoningTokens: 1414` so với `textTokens: 778`, effort high | CÓ nghĩ, nghĩ nhiều hơn viết |
| Bị chặn số bước? | trần 8, lượt dùng 3 | Không chạm trần, model tự dừng |
| Trace hiện `reasoning: ""` | Gemini mã hóa phần suy nghĩ, không trả về chữ | Ô trống là bình thường |

Nguyên nhân thật: lượt đó gọi **2 lần `web_search`, 0 lần `web_fetch`**. Model
viết 10 mục từ ~4.5k ký tự đoạn trích tìm kiếm. Mô tả của `web_search` đã ghi
sẵn "muốn đọc chi tiết thì gọi web_fetch", và tool đó đang bật đủ - model chỉ
đơn giản không dùng.

### A/B model: đổi model không phải thuốc

Cùng prompt, cùng bộ tool đọc, thinkingLevel high, trần 8:

| Model | steps | tool đã gọi | ký tự | reasoning tokens |
|---|---|---|---|---|
| `gemini-3.5-flash-lite` | 7 | 6, TOÀN `web_search` | 2571 | 2472 |
| `gemini-3.5-flash` | 8 (chạm trần) | 8, TOÀN `web_search` | 0 | 1554 |
| `gemini-3.6-flash` | - | quota vượt hạn mức | - | - |

**Không model nào chịu gọi `web_fetch`.** Còn model to hơn thì đốt sạch trần bước
mà vẫn chỉ tìm kiếm. (Phép đo gọi `streamText` trần nên ra 0 ký tự; bot thật có
lượt chốt ép trả lời, nhưng câu chốt viết khi chưa đọc gì thì cũng mỏng như vậy.)

### Bản sửa

**Luật persona** đặt trong `persona-tool-rules.ts` gắn với cặp
`web_search`/`web_fetch`, KHÔNG đặt trong `BASE_PERSONA`. Bản đầu tôi viết vào
`BASE_PERSONA` và test có sẵn bắt ngay: luật nhắc tên tool phải biến mất khỏi
prompt khi tool đó tắt, không thì bot được dạy dùng thứ nó không có.

**Trần bước 8 -> 10.** Kèm một hệ quả đáng ghi: `nguongTheoTranStep` kẹp ngưỡng
xuống `tranStep - 1`, nên từ trần 10 thì `TOOL_LOOP_SAME_TOOL_BLOCK=8` lần đầu
tiên nằm DƯỚI trần và tự nổ được - trước đó nó đứng đúng bằng trần, tức là ngưỡng
chết. Phép kẹp vẫn giữ vì nó nhắm cấu hình đặt tay xuống thấp, không nhắm mặc định.

### Kiểm chứng

**A/B trên model thật, cùng case eval `tin-tuc-phai-mo-bai`:**

| | kết quả | tool đã gọi |
|---|---|---|
| CÓ luật | **3/3 đạt** | `web_search` (1-2 lần) + `web_fetch` |
| BỎ luật | **0/3 đạt** | chỉ `web_search`, 2-3 lần |

Đây là quan hệ nhân quả chứ không phải tương quan - khác hẳn case
`luat-thang-lich-su-cu` vốn không tái hiện được khi phá.

1514 test xanh, typecheck sạch. `pnpm eval` 15/17.

### Hai case eval đỏ - KHÔNG phải hồi quy

`ngay-co-san` và `luat-thang-lich-su-cu` đỏ. Đã kiểm bằng cách cất thay đổi đi
rồi chạy lại: **đỏ y hệt trên code cũ**. Cả hai đều là case đo thói quen của model
(gọi tool thừa khi ngày đã có sẵn trong prompt; chép lại kiểu trình bày cũ trong
lịch sử), và bộ eval này vốn được chỉnh trên model của router chứ không phải
`gemini-3.5-flash-lite`.

KHÔNG chứng minh được là "do model yếu": key tạm của 9router đã bị thu hồi (401)
nên không chạy đối chứng trên model router được. Để ngỏ, đừng chép lại như thể
đã kết luận.

## V3.7.6 - Bộ eval đo nhầm stack tra cứu, và một giờ đi lạc (2026-08-06)

Nâng luật persona lên "đọc 2-3 bài từ nguồn khác nhau" rồi đo lại: 0/3. Đo tiếp
câu CŨ để so: cũng 0/3, trong khi chính nó buổi sáng 3/3. Tôi đã báo với người
dùng rằng câu mới làm model tệ đi. **Sai.**

### Thứ thật sự hỏng

Bot trả lời trong chính lượt eval đó: *"Hệ thống tìm kiếm thông tin đang tạm gặp
sự cố"*. Đo thẳng hai đường:

| Đường tra cứu | Kết quả |
|---|---|
| Brave (DB thật - bot đang chạy) | 6/6 OK |
| DuckDuckGo (eval rơi về đây) | **0 kết quả, 3/3** |

`eval-env.ts` chép cấu hình LLM từ DB thật, kèm hẳn comment "đọc riêng .env là
đo một hệ thống khác với hệ thống đang chạy". Nhưng nó KHÔNG chép cấu hình tra
cứu. Bot thật đặt `search_provider = brave` trên dashboard; eval chạy DB tạm
rỗng nên rơi về DuckDuckGo. Cùng một bài học, chỉ khác chỗ đau - và lần này nó
tốn gần một giờ cùng một kết luận sai gửi tới người dùng.

Tệ nhất không phải việc eval đỏ, mà là nó đỏ với LÝ DO SAI: "không gọi
web_fetch". Người đọc bảng kết quả sẽ đi sửa persona, sửa model, sửa luật -
trong khi thứ hỏng nằm ở chỗ khác hẳn.

### Bản sửa

- `read-real-search-settings.ts`: chép nhà cung cấp + khóa Brave từ DB thật sang
  DB tạm. PHẢI đọc TRƯỚC `setupTestEnv` - hàm đó trỏ `DATA_DIR` sang thư mục
  tạm, đọc sau là đọc nhầm DB rỗng rồi tưởng dashboard không cấu hình gì (đã
  dính đúng bẫy này lúc viết, bản đầu in ra "duckduckgo - mặc định").
- `preflight-web-search.ts`: trước khi chạy case, thử 2 truy vấn. Cùng rỗng thì
  DỪNG HẲN kèm câu nói rõ đây là lỗi tra cứu chứ không phải lỗi model. Hai truy
  vấn chứ không một - một truy vấn rỗng có thể chỉ là truy vấn xấu.
- Runner in thêm dòng `Tra cứu: <nhà cung cấp> - nguồn ...`, cùng nếp với dòng
  `Model: ...` vốn có.
- `goiToolItNhat` trong mong đợi của case: `goiTool` so bằng Set nên không phân
  biệt được đọc MỘT bài với đọc BA bài - mà đó đúng là khác biệt giữa bản tin có
  nguồn riêng từng mục và bản tin gom một dòng chung ở cuối.

### Đo lại cho tử tế, sau khi eval hết nói dối

Case `tin-tuc-phai-mo-bai` đòi `web_fetch` ÍT NHẤT 2 lần:

| Câu luật | Kết quả |
|---|---|
| "2-3 bài từ nguồn KHÁC NHAU, gọi cùng lúc, ghi nguồn NGAY DƯỚI mỗi mục" | **3/3 đạt** |
| "ít nhất một bài, ghi nguồn ở cuối" | **1/3 đạt** |

Mẫu nhỏ (n=3 mỗi bên) nên đọc là dấu hiệu, không phải bằng chứng chắc. Nhưng nó
khớp với cơ chế: luật cũ đặt sàn ở MỘT bài và model dừng đúng tại sàn.

### Kiểm chứng

1526 test xanh (+12), typecheck sạch. Năm phép phá, cả năm đều đỏ: đếm
`goiToolItNhat` trên Set, bỏ nó khỏi bộ chặn case rỗng, tiền đề bỏ sót
`goiToolItNhat`, tiền đề dừng ngay khi một truy vấn rỗng, tiền đề để lỗi mạng
ném ra ngoài.

`pnpm eval` 14/17. Ba case đỏ đều KHÔNG phải hồi quy: `ngay-co-san` và
`luat-thang-lich-su-cu` đỏ y hệt trên code cũ (đã kiểm bằng cách cất thay đổi
đi), còn `danh-sach-de-luot-mat` chạy riêng thì 3/3 xanh - dao động của
`gemini-3.5-flash-lite`.

### Việc còn treo

Bộ eval được chỉnh trên model của router; chạy trên `gemini-3.5-flash-lite` thì
mấy case đo THÓI QUEN trình bày dao động mạnh. Chưa quyết: hạ kỳ vọng, hay ghim
model cho eval, hay chấp nhận đỏ dao động - mà lựa chọn cuối là tệ nhất vì bộ
eval đỏ ngẫu nhiên thì người ta ngừng đọc nó.

## V3.8 - Xóa sạch ngữ cảnh một cuộc trò chuyện (2026-08-06)

Người dùng xóa hội thoại trên Zalo nhưng bot vẫn nhớ, vì lịch sử nằm trong DB
của bot. Cần đường xóa hẳn để trả nick test về sạch, hoặc để người dùng bỏ ngữ
cảnh cũ.

### Hai bẫy tìm ra khi rà codebase

**1. DB KHÔNG có khóa ngoại nào.** Kiểm cả 14 bảng: 0 foreign key, nên không có
cascade - mỗi bảng phải xóa tay. Dữ liệu một thread nằm ở 6 nơi trong DB cộng
một thư mục trên đĩa.

**2. `image_descriptions` chỉ khóa theo `rel_path`**, không có cột
account/thread. Đường duy nhất biết mô tả nào thuộc thread nào là liệt kê file
trong thư mục media của thread đó - nên phải liệt kê TRƯỚC khi xóa thư mục.
Đảo thứ tự là mất dấu và mô tả nằm lại vĩnh viễn.

Ghi lại một lỗi có sẵn phát hiện trong lúc rà, CHƯA sửa: `deleteAccount`
(`account-store.ts`) đúng một câu `DELETE FROM accounts`. Xóa nick xong thì tin
nhắn, thread, contact, trace, trí nhớ, lịch hẹn và thư mục ảnh nằm lại mồ côi,
không giao diện nào thấy để dọn. Người dùng chốt để đợt sau.

### Hermes và goclaw làm thế nào

Cả hai đều có, cùng một mô hình: **reset** = xóa lịch sử nhưng GIỮ session,
**delete** = xóa hẳn. goclaw có `/reset` trong chat, `sessions.reset` RPC và
lệnh CLI; trong nhóm thì `/reset` chỉ writer được dùng.

Điểm học được quan trọng nhất: **reset không chỉ là xóa dòng, mà là đổi DANH
TÍNH phiên.** goclaw gọi `ResetCLISession` sau khi xóa; Hermes xoay `session_id`
rồi báo mọi provider bộ nhớ refresh cache theo phiên.

Áp vào đây rất cụ thể: `cacheSessionId()` băm `sha256(accountId:threadId)` - cố
định vĩnh viễn, nên xóa lịch sử xong vẫn gửi đúng khóa phiên cũ lên router. Thêm
cột `threads.context_epoch`, băm kèm nó, mỗi lần xóa tăng 1.

### Đã làm

Gom vào MỘT module `wipe-thread-context.ts`. Xóa: `messages`, summary +
`summary_covers_to_message_id`, `agent_steps`,
`proactive_send_counters`, thư mục media, `image_descriptions` tương ứng.

**Giữ có chủ đích:** dòng `threads` (tên hiển thị, công tắc bot), lịch hẹn -
lời đã hứa khác hẳn ngữ cảnh - và `contacts`.

**Trí nhớ chỉ xóa khi tick riêng**, lọc theo `learned_in_thread_id` nên fact học
ở thread khác về cùng người vẫn còn. Ô tick đứng TRƯỚC nút chứ không nằm trong
hộp xác nhận: đó là quyết định khác hẳn, phải chọn có ý thức.

**Hủy hàng chờ TRƯỚC khi xóa DB** (`huyBatchCuaThread`). Không có bước này thì
batch đang đỗ vẫn chạy và ghi ngược tin cũ vào lịch sử vừa dọn.

Phần DB chạy trong MỘT giao dịch - chỗ đầu tiên của repo dùng giao dịch, viết
tay vì `node:sqlite` không có `db.transaction()` như better-sqlite3. File trên
đĩa xóa SAU khi DB đã cam kết: mất file mà DB còn dòng chỉ là ảnh hỏng, ngược
lại là dòng trỏ vào hư vô.

**KHÔNG làm lệnh `/reset` trong chat.** goclaw phải giới hạn "chỉ writer trong
nhóm" đúng vì lý do này - bot đọc tin người lạ, một lệnh xóa qua chat là bề mặt
tấn công. Dashboard đã có mật khẩu.

### Lỗi bắt được khi người dùng xóa thử trên máy thật

Bản đầu xóa cả `agent_turns`. Mà đó là bảng nguồn DUY NHẤT của thống kê token
(`usage-store.ts:59` cho từng thread, `:79` cho biểu đồ Tổng quan). Sau 4 lần
xóa thử, đo trên DB thật: `agent_turns` còn lại hôm nay **0 lượt, null token**.
Trang Tổng quan báo hôm nay dùng 0 token trong khi bot chạy ~30 lượt và đốt
hàng trăm nghìn token; riêng lần xóa đầu cuốn theo 162 lượt.

Căn nguyên là gộp hai thứ khác bản chất vào một lệnh xóa. Cột của `agent_turns`
chỉ có `input_tokens/output_tokens/created_at/source` - KHÔNG một chữ nào của
hội thoại; toàn bộ nội dung nguyên văn nằm ở `agent_steps`. Lịch sử token là
SỔ CHI TIÊU: xóa một cuộc trò chuyện thì phải quên nội dung, nhưng không có lý
do gì để viết lại số tiền đã tiêu.

Nay chỉ xóa `agent_steps`. Đổi lại tab Trace của thread đã xóa liệt kê lượt cũ
mà mở ra không có step - giao diện đã có sẵn dòng "Lượt này không có step nào
được ghi" (`session-trace-view.tsx:71`), không vỡ. Như vậy còn trung thực hơn:
lượt đó có chạy thật và có tốn ngần ấy token.

Bài học: rà codebase tìm ra được hai bẫy, nhưng thứ này chỉ lộ ra khi có người
bấm nút trên dữ liệu thật rồi nhìn một trang KHÁC - không phép kiểm nào trong
chính module xóa phát hiện được.

### Kiểm chứng

1556 test xanh (+30), typecheck sạch. Mười phép phá, cả mười đều đỏ: bỏ điều
kiện `account_id` khi xóa tin, xóa trí nhớ dù không tick, bỏ lọc theo thread khi
xóa trí nhớ, quên tăng epoch, XÓA LUÔN `agent_turns`, quên trả danh sách ảnh, epoch
không vào hàm băm, header không nhận epoch, quên `clearTimeout`, route coi mọi
giá trị là bật.

### Ba phép phá đầu tiên của tôi là phép phá HỤT

Đáng ghi vì cùng một họ với bài học cũ:

- Neo nhiều dòng dùng `
` trên file CRLF - im lặng báo "không thấy", đọc ra y
  hệt test rỗng. `wipe-thread-context.ts` là LF còn `message-batcher.ts` là
  CRLF, ngay trong cùng một lượt sửa.
- Phép phá "xóa thư mục trước khi liệt kê" chèn thêm một lệnh xóa nhưng
  `readdirSync` đã chạy xong từ trước, nên nó không phá được gì. Phải phá đúng
  thứ mình muốn đo: cho hàm trả về mảng rỗng.
- Test `clearTimeout` ban đầu chỉ đo hành vi (handler có chạy không) nên xanh cả
  khi bỏ `clearTimeout` - vì xóa entry khỏi Map đã đủ chặn handler. Phải đo thứ
  khác hẳn: đếm handle `Timeout` còn sống bằng `process.getActiveResourcesInfo()`.
