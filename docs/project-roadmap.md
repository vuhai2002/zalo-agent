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
- [ ] Cân nhắc lưu ảnh vào history (hiện chỉ ghi text `[gửi kèm N ảnh]`, nên hỏi lại ảnh cũ sau vài phút sẽ không xem được)

## V2 - Dashboard + Memory (2026-07-25, plan: plans/260725-1650-web-dashboard-and-memory/)

- [x] Data layer: bảng threads (bot_enabled per thread), contacts (auto-collect), agent_turns (token usage), backfill từ messages cũ
- [x] Passive listening group: tin không @mention vẫn ghi history (không tốn LLM), timestamp trong replay
- [x] Dashboard API (Hono, cùng process, 127.0.0.1): auth password + HMAC cookie + rate-limit login, threads/messages/contacts/overview/provider/memories
- [x] Dashboard UI (React + Vite + Tailwind, tone xanh Zalo #0068FF): Overview, Sessions (+ drawer xem hội thoại + toggle bot), Contacts, Memory, Providers
- [x] Providers: đổi provider/model/base URL/API key runtime từ UI (key mã hóa AES-256-GCM, response luôn masked), test kết nối, rollback về env
- [x] Memory 3 lớp (mô hình ChatGPT/OpenClaw): rolling summary per thread (async sau reply), tool save_memory với quy tắc privacy bất đối xứng (fact học ở DM không bao giờ inject trong group), timestamps
- [x] Fetch sanitizer chống response lỗi từ 9Router (JSON dính đuôi SSE)

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
