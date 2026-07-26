# System Architecture - zalo-agent

## Tổng quan

```
Zalo servers <--ws/https--> zca-js (npm lib, unofficial)
                                |
                    src/zalo/account-manager.ts   (N account, mỗi account 1 api + 1 listener)
                                |
              middleware: allowlist-filter -> (lọc xong mới tốn token)
                                |
                    src/agent/agent-loop.ts       (Vercel AI SDK generateText + tools)
                                |                  provider theo env: 9Router / Anthropic
              tools: add_reaction | send_file | tag_member | get_group_info
                                |
              middleware: rate-limiter (queue per thread + delay ngẫu nhiên) -> sendMessage
                                |
              conversation/history-store.ts        (node:sqlite, key account_id + thread_id)
```

## Quyết định kỹ thuật chính

| Quyết định | Lý do |
|---|---|
| Dùng zca-js qua npm, không fork | Update lib bằng `pnpm update`; phần reverse-engineer giao thức để lib gánh |
| Vercel AI SDK thay vì SDK provider trực tiếp | Đổi LLM provider = đổi env, không sửa code (mặc định trỏ router proxy 9Router) |
| `node:sqlite` built-in thay better-sqlite3 | better-sqlite3 cần Visual Studio Build Tools trên Windows (Node 24 chưa có prebuilt); node:sqlite đủ cho history, zero native dep. Trạng thái experimental - nếu Node đổi API thì chỉ sửa 1 file `history-store.ts` |
| tsconfig `moduleResolution: Bundler` | `index.d.ts` của zca-js dùng directory import (`export * from "./dist"`) - NodeNext không resolve được types; Bundler khớp cách tsx/esbuild chạy runtime |
| Cookie mã hóa AES-256-GCM, key từ env | Cookie = full quyền tài khoản Zalo; file layout `[iv][authTag][ciphertext]`, mode 0600 |
| Filter trước agent | Tin bị lọc (không @mention, ngoài allowlist, tin của bot) không bao giờ chạm LLM -> không tốn token |
| Tool send_file giới hạn `data/shared-files/` | Chặn agent đọc file tùy ý trên máy (vd credentials) qua prompt injection |
| Ghim `zca-js` đúng version (không dùng `^`) | Lib reverse-engineer, minor bump có thể đổi hành vi. Nâng cấp phải là hành động có chủ đích + chạy lại test, không để `pnpm update` nhảy âm thầm |
| Không bọc facade quanh zca-js | Chỉ dùng 8/150+ hàm, phần lớn import là `type API`. Đổi chữ ký hàm thì TypeScript bắt ngay lúc typecheck - thêm tầng trung gian là over-engineering (chỉ đáng khi thêm kênh khác, mà V3 đã chốt không làm) |
| `web_fetch` đi theo chuỗi 2 tầng: tự fetch trước, Jina Reader đỡ sau | Đúng pattern của cả hai repo tham khảo (GoClaw `ExtractorChain`: Defuddle hosted -> bóc in-process; Hermes: Firecrawl gateway -> provider khác). Tầng 1 nhanh, riêng tư, miễn phí và thừa hưởng guard SSRF; tầng 2 render được trang JavaScript và qua được một phần chặn bot. Đo thực tế: `giavang.doji.vn` tầng 1 chỉ ra 11 ký tự (trang render JS) - Jina cứu được 938 ký tự; `vnexpress.net` từ HTTP 406 thành chạy ở tầng 1 sau khi thêm header trình duyệt. Đánh đổi của tầng 2: chậm (1-16s) và URL đi qua bên thứ ba, tắt bằng `WEB_FETCH_FALLBACK_ENABLED`. Jina trả HTTP 200 KỂ CẢ khi trang đích chặn nó nên phải tự soi dòng `Warning: Target URL returned error` |
| Request tự fetch phải mang header trình duyệt | Request trần không header bị nhiều site trả 403/406 (đo được: vnexpress 406, sjc.com.vn 403). Bộ User-Agent + Accept + Accept-Language tối thiểu là qua được phần lớn; site sau Cloudflare vẫn chặn nhưng đó là việc của tầng 2 |
| Cấu hình chuỗi nguồn nằm trong modal mở từ nút Settings TRÊN DÒNG TOOL, không phải khối rời | Bản đầu đặt cấu hình search thành một khối riêng cuối trang Tools - người dùng phản hồi "2 nơi khó hiểu". Theo đúng mẫu "Extractor Chain" của GoClaw: nút Settings nằm trên dòng tool, modal liệt kê các bậc theo thứ tự thử (#1, #2) kèm mô tả và toggle từng bậc. Bậc CUỐI khoá cứng (hiện nhãn "Luôn bật" thay cho toggle) - đó là thứ bảo đảm tool không rơi vào trạng thái "chưa cấu hình" |
| Cấu hình nguồn search nằm trong DB, sửa từ dashboard; DuckDuckGo là lưới đỡ KHÔNG tắt được | Key Brave nhập ở trang Tools (mã hóa AES-256-GCM như key LLM, `env.BRAVE_SEARCH_API_KEY` chỉ là dự phòng khi DB trống) để đổi key không phải sửa file env rồi restart. Chọn Brave mà chưa có key bị chặn ngay ở tầng store nên API và mọi caller khác đều dính cùng luật; mất key thì tự hạ về DuckDuckGo thay vì kẹt ở trạng thái gọi Brave với key rỗng. DDG luôn đứng cuối chuỗi nên web search không bao giờ ở trạng thái "chưa cấu hình" |
| Prompt caching bật bằng MỘT header `x-session-id` ổn định theo thread, không phân nhánh theo provider | Đọc source 9Router (`open-sse/utils/sessionManager.js`): router suy khóa cache theo thứ tự header `x-session-id` -> `body.prompt_cache_key` -> FALLBACK băm text assistant trong request. Client câm thì rơi vào fallback, mà text assistant dài thêm mỗi lượt nên khóa đổi liên tục, cache không bao giờ trúng (đo được `CACHED TOKENS: 0` trên 181k token). Chọn header vì nó là đường CHUNG: `codex.js`/`grok-cli.js` đổ vào `prompt_cache_key`, `claude.js` dùng giữ fingerprint khi cloaking, kiro/antigravity dùng định danh phiên, provider thường bỏ qua vô hại - đổi provider trên router không phải sửa code bot. Khóa băm sha256 chứ không ghép id thô: thread id là định danh người dùng thật, không nên rò vào log của router |
| KHÔNG tự gắn `cache_control` cho đường Anthropic | `open-sse/translator/formats/claude.js` XÓA sạch `cache_control` client gửi lên rồi tự đặt lại (system block cuối ttl 1h, assistant cuối, tools). Client gắn thêm chỉ tốn công - router lo phần đó |
| Lấy ảnh cỡ `normal` từ payload Zalo thay vì `hd`, `HISTORY_IMAGE_CONTEXT_LIMIT` mặc định 1 | Ảnh là khoản token đắt nhất: đo thực tế lượt có ảnh ~12.600 token input, lượt text thuần ~2.600 - chênh lệch ~10.000 chính là 4 tấm ảnh (1 mới + 3 nạp lại từ history), lại nhân với số step vì mỗi step gửi lại cả hội thoại. Zalo đã resize sẵn nhiều cỡ trong payload (`thumb`/`normalUrl`/`href`/`oriUrl`/`hd`) nên chỉ cần đổi thứ tự ưu tiên, KHÔNG cần thư viện resize (sharp cần build native trên Windows). Hermes cũng resize ảnh nhưng ngưỡng 7900px/4MB - họ chống lỗi 400 của API chứ không tối ưu token |
| Thinking bật qua `LLM_REASONING_EFFORT`, chokepoint duy nhất `reasoning-options.ts` | Không bật thinking, model lướt 50k token nội dung trang một lượt - đối chiếu số vé, đọc bảng đều ẩu (vụ dò vé: dữ liệu đã vào context mà vẫn "chưa lấy được bảng"). Học Hermes: một nơi resolve tham số reasoning cho mọi đường gọi, map theo provider (openai-compatible: `reasoning_effort` chuẩn; anthropic: adaptive thinking + effort). Kiểm chứng bằng reasoningTokens trong log; = 0 khi đã bật tức router nuốt tham số |
| Retry + fallback khi router trả completion rỗng | 9Router có lúc trả HTTP 200 với message trống (0 token) - SDK coi là thành công nên `maxRetries` không retry, bot im lặng bỏ treo người nhắn. `agent-loop` nhận diện chữ ký rỗng (text trống + 0 tool call + 0 token - phân biệt được với lượt "chỉ thả reaction" hợp lệ vốn có tool call + token), tự retry 1 lần, vẫn rỗng thì trả lời fallback. Gốc bệnh ở router, bot chỉ chống chịu |
| `payload-anomaly-watch.ts` cảnh báo payload lạ | Rủi ro thật không phải zca-js đổi API (TS bắt được) mà là **Zalo đổi tên field** - parser moi payload bằng `any` nên bot chỉ âm thầm ngừng thấy ảnh / ngừng nhận @mention. Tin thiếu `threadId` còn bị bỏ qua không dấu vết. Watcher log warn (throttle 10 phút/loại/account) để lỗi hiện ra thay vì im lặng |
| Mọi lần tải từ URL đi qua `shared/safe-remote-download.ts` | URL của tool `send_file` do LLM quyết, mà LLM đọc tin của người lạ -> prompt injection có thể bảo bot tải `http://127.0.0.1:3900/api/...` hay metadata cloud (`169.254.169.254`) rồi gửi ra chat. Guard chặn IP nội bộ (kiểm cả literal IP trong URL, cả từng hop redirect) và truyền `lookup` đã kiểm vào `http.request` nên socket dùng đúng địa chỉ đã duyệt - chặn luôn DNS rebinding. Đọc theo stream và cắt khi vượt hạn mức, thay vì `res.arrayBuffer()` nạp cả response vào RAM rồi mới kiểm cỡ |
| Rate-limit login tính theo IP socket, chỉ tin `X-Forwarded-For` khi `DASHBOARD_BEHIND_PROXY=true` | Header XFF do client gửi được: đổi giá trị mỗi request là mỗi lần có bucket rate-limit mới -> brute-force password không giới hạn. Khi có proxy thì lấy entry **phải nhất** vì Caddy/Nginx *append* IP client vào cuối chuỗi có sẵn; lấy entry trái nhất (cách hay gặp) chính là lỗ hổng |
| Phiên dashboard lưu bảng `dashboard_sessions` (đổi so với bản HMAC stateless trước đó) | Token tự chứng thực thì logout chỉ xóa cookie phía client - cookie bị lộ vẫn dùng được tới khi hết hạn, và đổi `DASHBOARD_PASSWORD` không đá được phiên nào. Đánh đổi: thêm 1 truy vấn SQLite mỗi request (bảng vài dòng, node:sqlite sync) để logout thu hồi được thật. DB chỉ lưu `sha256(secret)`; cột `password_fingerprint` khiến đổi password là kick sạch phiên cũ |
| File tạm của `send_file` xóa ngay trong `finally`, sweep định kỳ chỉ để bắt file mồ côi | `data/tmp` là nơi trung chuyển, không phải nơi lưu trữ. Sweep 24h một lần chỉ dọn phần sót lại khi process bị kill giữa lượt gửi |
| `LLM_API_KEY` để trống được | Key nhập được ở dashboard (lưu DB, mã hóa) nên bắt buộc lúc boot là vô lý - không cấu hình được từ UI thuần. Thiếu key thì log warn lúc khởi động và lượt agent ném lỗi có hướng dẫn, thay vì `process.exit(1)` |
| Tin của người dùng vào history cả khi lượt agent lỗi | Trước đây `appendMessage` nằm sau `runAgentTurn`: provider chết là tin nhắn biến mất khỏi history, lượt sau bot không biết người ta đã nói gì. Vẫn phải ghi SAU khi agent chạy (agent tự ghép batch vào input, ghi trước thì tin lặp 2 lần) nên dùng cờ ghi-một-lần gọi ở cả 2 nhánh |
| System prompt chỉ bơm NGÀY (không giờ), giờ chính xác qua tool `get_datetime` | Giờ đổi mỗi phút là prompt cache của provider vỡ mỗi phút; chỉ ngày thì cache sống nguyên ngày (pattern GoClaw). Thứ trong tuần do server tính - LLM tự suy thứ từ ngày rất hay sai. Không có dòng ngày model đoán từ training data và trả lời sai ngày hôm nay |
| Web search: chuỗi Brave (khi có key) -> DuckDuckGo (luôn cuối, không key) | Pattern chung của cả GoClaw lẫn Hermes: DDG scraping `html.duckduckgo.com` miễn phí làm fallback bắt buộc nên web search không bao giờ "chưa cấu hình"; Brave free tier 2000 query/tháng cho kết quả tốt hơn, lỗi/hết quota tự rơi về DDG. Provider lỗi trả mảng rỗng cho tool diễn giải, không throw ra agent loop |
| Tool bật/tắt per account, lưu danh sách TẮT (`accounts.disabled_tools`) | Lưu danh sách tắt thay vì bật để tool mới thêm vào registry tự bật cho account cũ, không cần migration. Tool tắt không đưa vào schema gửi LLM: không tốn token mô tả, model không biết nó tồn tại, prompt injection không dụ gọi được. Catalog một nguồn ở `tool-registry.ts`, UI đọc qua `/api/tools` (không chép sang frontend - cùng lý do reaction-icons) |
| `html-to-text` lọc list theo mật độ link, cap fetch nâng lên `WEB_FETCH_MAX_CHARS` (15000) | Lỗi thật vụ dò vé số: trang minhngoc 9438 ký tự text thì 8300 ký tự đầu là menu, cap 8000 cắt đúng trước bảng kết quả -> model thấy toàn menu, tưởng trang không có dữ liệu rồi bỏ cuộc. Tín hiệu Readability tối giản (list nào >= 70% chữ nằm trong link là menu điều hướng, vứt; match list trong cùng trước để gỡ được menu lồng) + decode entity tên (&Ecirc; -> Ê) + ô bảng ngăn bằng " \| ". GoClaw giải cùng bài bằng Defuddle + cap 60000; mình không thêm dependency và để cap 15000 vì mỗi ký tự là token trả tiền |
| Persona có khối "quy tắc tra cứu" chưng cất từ Hermes | Bot có tool nhưng bỏ cuộc ở step 3/8 rồi đẩy việc ngược cho người dùng - đúng failure mode Hermes trị bằng `<tool_persistence>`/`<missing_context>`: thông tin thời sự PHẢI search trước khi nói không biết; trang đầu không có thì thử trang khác/đổi từ khóa; chỉ hỏi ngược người dùng khi tool không lấy được; tool lỗi thì nói thật, cấm bịa. Việc dính tiền (dò vé số, giá) phải nêu nguồn + ngày |
| Tool nhóm theo mức rủi ro read/action | Học từ webhook-safe toolset của Hermes (nguồn không tin cậy chỉ được cấp tool đọc): `read` = tra cứu không tác động, `action` = gửi/sửa trên Zalo. Hiện chỉ để nhóm UI; là nền cho allowlist tool theo thread sau này |
| Ảnh nhận được lưu file `data/media/`, không nhét base64 vào SQLite | URL ảnh Zalo có hạn dùng, còn history chỉ lưu text -> trước đây bot không xem lại được ảnh cũ. Giờ `media-store` lưu file + cột `messages.images` trỏ tới; agent nạp lại tối đa `HISTORY_IMAGE_CONTEXT_LIMIT` ảnh gần nhất (mặc định 3 - mỗi ảnh tốn token mỗi lượt). File quá `MEDIA_RETENTION_DAYS` (7 ngày) bị dọn, history tự rơi về text `[gửi kèm N ảnh]`. Lưu ý: ảnh nằm plaintext trên đĩa (khác cookie có mã hóa) - `data/` đã gitignore |

## Repo tham khảo

Clone shallow (chỉ đọc, không build, không sửa) tại `D:\source-code\zalo-agent-references\` - đặt ngoài project để không dính vào git/pnpm/tsc:

| Repo | Dùng để tra |
|---|---|
| [zca-js](https://github.com/RFS-ADRENO/zca-js) | Source lib chính: `src/apis/` (chữ ký hàm thật), `examples/login.ts`, `examples/echobot.ts` |
| [zalo-agent-cli](https://github.com/PhucMPham/zalo-agent-cli) | Pattern QR login, lưu credential mã hóa. **Không harvest phần bank transfer/VietQR** |
| [zalo-personal](https://github.com/caochitam/zalo-personal) | Catalog 141 action - cách gọi zca-js cho từng tính năng |
| [deplao-builder](https://github.com/babyvibe/deplao-builder) | Pattern quản lý nhiều instance zca-js cùng lúc |
| [goclaw](https://github.com/nextlevelbuilder/goclaw) | Pattern tool hệ thống: datetime tool (weekday server tính), chuỗi web search Brave -> DDG, UI Built-in Tools. **License CC BY-NC 4.0 - chỉ soi pattern, KHÔNG copy code** |
| [hermes-agent](https://github.com/NousResearch/hermes-agent) | Agent hot nhất 2026 (Nous Research, MIT): toolset theo kênh, webhook-safe toolset (chống prompt injection), cascade provider web search trả phí -> free |

Bản `zca-js` trong `references/` chỉ là sách tra cứu - runtime dùng bản cài trong `node_modules` qua pnpm.

## Ràng buộc từ Zalo (qua zca-js)

- 1 listener/account: mở Zalo Web trên trình duyệt sẽ đá listener bot (bot tự reconnect với backoff).
- Rủi ro khóa nick vì dùng unofficial API - chỉ dùng nick phụ, giữ rate limit gửi tin.
- zca-js v2 bỏ sharp: gửi ảnh cần `imageMetadataGetter` - đã wire bằng package `image-size` trong `zalo-client.ts`.
