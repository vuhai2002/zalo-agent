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
