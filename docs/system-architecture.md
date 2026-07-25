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
| `payload-anomaly-watch.ts` cảnh báo payload lạ | Rủi ro thật không phải zca-js đổi API (TS bắt được) mà là **Zalo đổi tên field** - parser moi payload bằng `any` nên bot chỉ âm thầm ngừng thấy ảnh / ngừng nhận @mention. Tin thiếu `threadId` còn bị bỏ qua không dấu vết. Watcher log warn (throttle 10 phút/loại/account) để lỗi hiện ra thay vì im lặng |
| Mọi lần tải từ URL đi qua `shared/safe-remote-download.ts` | URL của tool `send_file` do LLM quyết, mà LLM đọc tin của người lạ -> prompt injection có thể bảo bot tải `http://127.0.0.1:3900/api/...` hay metadata cloud (`169.254.169.254`) rồi gửi ra chat. Guard chặn IP nội bộ (kiểm cả literal IP trong URL, cả từng hop redirect) và truyền `lookup` đã kiểm vào `http.request` nên socket dùng đúng địa chỉ đã duyệt - chặn luôn DNS rebinding. Đọc theo stream và cắt khi vượt hạn mức, thay vì `res.arrayBuffer()` nạp cả response vào RAM rồi mới kiểm cỡ |
| Rate-limit login tính theo IP socket, chỉ tin `X-Forwarded-For` khi `DASHBOARD_BEHIND_PROXY=true` | Header XFF do client gửi được: đổi giá trị mỗi request là mỗi lần có bucket rate-limit mới -> brute-force password không giới hạn. Khi có proxy thì lấy entry **phải nhất** vì Caddy/Nginx *append* IP client vào cuối chuỗi có sẵn; lấy entry trái nhất (cách hay gặp) chính là lỗ hổng |
| Phiên dashboard lưu bảng `dashboard_sessions` (đổi so với bản HMAC stateless trước đó) | Token tự chứng thực thì logout chỉ xóa cookie phía client - cookie bị lộ vẫn dùng được tới khi hết hạn, và đổi `DASHBOARD_PASSWORD` không đá được phiên nào. Đánh đổi: thêm 1 truy vấn SQLite mỗi request (bảng vài dòng, node:sqlite sync) để logout thu hồi được thật. DB chỉ lưu `sha256(secret)`; cột `password_fingerprint` khiến đổi password là kick sạch phiên cũ |
| File tạm của `send_file` xóa ngay trong `finally`, sweep định kỳ chỉ để bắt file mồ côi | `data/tmp` là nơi trung chuyển, không phải nơi lưu trữ. Sweep 24h một lần chỉ dọn phần sót lại khi process bị kill giữa lượt gửi |
| `LLM_API_KEY` để trống được | Key nhập được ở dashboard (lưu DB, mã hóa) nên bắt buộc lúc boot là vô lý - không cấu hình được từ UI thuần. Thiếu key thì log warn lúc khởi động và lượt agent ném lỗi có hướng dẫn, thay vì `process.exit(1)` |
| Tin của người dùng vào history cả khi lượt agent lỗi | Trước đây `appendMessage` nằm sau `runAgentTurn`: provider chết là tin nhắn biến mất khỏi history, lượt sau bot không biết người ta đã nói gì. Vẫn phải ghi SAU khi agent chạy (agent tự ghép batch vào input, ghi trước thì tin lặp 2 lần) nên dùng cờ ghi-một-lần gọi ở cả 2 nhánh |
| Ảnh nhận được lưu file `data/media/`, không nhét base64 vào SQLite | URL ảnh Zalo có hạn dùng, còn history chỉ lưu text -> trước đây bot không xem lại được ảnh cũ. Giờ `media-store` lưu file + cột `messages.images` trỏ tới; agent nạp lại tối đa `HISTORY_IMAGE_CONTEXT_LIMIT` ảnh gần nhất (mặc định 3 - mỗi ảnh tốn token mỗi lượt). File quá `MEDIA_RETENTION_DAYS` (7 ngày) bị dọn, history tự rơi về text `[gửi kèm N ảnh]`. Lưu ý: ảnh nằm plaintext trên đĩa (khác cookie có mã hóa) - `data/` đã gitignore |

## Repo tham khảo

Clone shallow (chỉ đọc, không build, không sửa) tại `D:\source-code\zalo-agent-references\` - đặt ngoài project để không dính vào git/pnpm/tsc:

| Repo | Dùng để tra |
|---|---|
| [zca-js](https://github.com/RFS-ADRENO/zca-js) | Source lib chính: `src/apis/` (chữ ký hàm thật), `examples/login.ts`, `examples/echobot.ts` |
| [zalo-agent-cli](https://github.com/PhucMPham/zalo-agent-cli) | Pattern QR login, lưu credential mã hóa. **Không harvest phần bank transfer/VietQR** |
| [zalo-personal](https://github.com/caochitam/zalo-personal) | Catalog 141 action - cách gọi zca-js cho từng tính năng |
| [deplao-builder](https://github.com/babyvibe/deplao-builder) | Pattern quản lý nhiều instance zca-js cùng lúc |

Bản `zca-js` trong `references/` chỉ là sách tra cứu - runtime dùng bản cài trong `node_modules` qua pnpm.

## Ràng buộc từ Zalo (qua zca-js)

- 1 listener/account: mở Zalo Web trên trình duyệt sẽ đá listener bot (bot tự reconnect với backoff).
- Rủi ro khóa nick vì dùng unofficial API - chỉ dùng nick phụ, giữ rate limit gửi tin.
- zca-js v2 bỏ sharp: gửi ảnh cần `imageMetadataGetter` - đã wire bằng package `image-size` trong `zalo-client.ts`.
