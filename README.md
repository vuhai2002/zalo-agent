# zalo-agent

Bot AI thường trú trên Zalo (tài khoản cá nhân, multi-account): nhận tin nhắn -> agent loop (LLM tự gọi tool: tra ngày giờ, tìm kiếm web, đọc trang web, thả reaction, gửi file, tag thành viên, xem info nhóm, đọc ảnh) -> trả lời. Tool bật/tắt được per account ngay trên dashboard (trang Tools).

- Zalo layer: [zca-js](https://github.com/RFS-ADRENO/zca-js) (unofficial API - CÓ RỦI RO KHÓA NICK, chỉ dùng nick phụ)
- Agent layer: Vercel AI SDK - provider cắm rời qua env (router proxy OpenAI-compatible hoặc Anthropic trực tiếp), đổi được runtime từ dashboard
- History + memory: SQLite (`node:sqlite` built-in), theo account + thread; rolling summary + fact bền (tool `save_memory`)
- Dashboard web: Hono + React (tone xanh Zalo) - xem hội thoại, contacts, memory, bật/tắt bot per thread, bật/tắt tool per account, đổi LLM provider
- Web search miễn phí qua DuckDuckGo (không cần key); điền `BRAVE_SEARCH_API_KEY` (free tier) nếu muốn kết quả tốt hơn
- Tự soạn file Word (.docx) và Excel (.xlsx) rồi gửi thẳng trong chat - bảng tính có công thức
  kèm sẵn kết quả nên xem trước trên điện thoại vẫn thấy số, không cần tải về
- Model chính không đọc được ảnh? Bot tự phát hiện (hỏi router) và có thể thuê model vision phụ
  (Gemini free tier) mô tả ảnh thành chữ - cấu hình ở nút Settings trên dòng "Nhìn kỹ ảnh"
  của trang Tools. Có sidecar thì agent còn dùng được tool `read_image` để "nhìn kỹ lại"
  ảnh với câu hỏi cụ thể (đếm số lượng, đọc chữ nhỏ) khi mô tả sẵn có không đủ

## Cài đặt

```bash
corepack enable
pnpm install
copy .env.example .env             # điền LLM_API_KEY, CREDENTIALS_ENCRYPTION_KEY
copy config\accounts.example.json config\accounts.json
```

Tạo khóa mã hóa cookie:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Chạy

```bash
pnpm dev                    # chạy bot (watch mode) + dashboard (nếu set DASHBOARD_PASSWORD)
pnpm build:web              # build UI -> web/dist, bot tự serve tại http://127.0.0.1:3900
pnpm dev:web                # dev UI dashboard (Vite, proxy vào API)
pnpm zalo-login acc-chinh   # login QR bằng CLI (cách cũ - giờ làm trên web tiện hơn)
```

Dashboard: set `DASHBOARD_PASSWORD` trong `.env` (không set = tắt), mở `http://127.0.0.1:3900`.
Thêm tài khoản Zalo + quét QR login + tạo agent (não riêng cho từng account) đều làm
trên dashboard (trang Accounts / Agents) - account/agent lưu trong DB, không cần sửa file.

## Cấu trúc

```
src/
├── config/        env (Zod) + accounts.json (multi-account) + runtime LLM settings
├── zalo/          login, credential mã hóa, listener + reconnect, parse tin nhắn,
│                  lifecycle account, router tin đến, xử lý 1 lượt trả lời
├── agent/         agent loop (AI SDK), provider, persona, tools/ (react, file, tag, memory...)
├── conversation/  SQLite: history, threads, contacts, usage, memory, summarizer
├── middleware/    allowlist + @mention filter (passive listening), batcher, rate limit
└── server/        dashboard API (Hono): auth, threads, contacts, memory, provider
web/               dashboard UI (React + Vite + Tailwind, tone xanh Zalo)
```

## Lưu ý an toàn

- `data/` chứa cookie Zalo (đã mã hóa AES-256-GCM) + db - KHÔNG commit, không share.
- Không nối tool chuyển tiền/thanh toán vào agent (rủi ro prompt injection).
- Mở Zalo Web trên trình duyệt sẽ đá listener của bot (bot tự reconnect lại).
- File cho phép bot gửi đặt trong `data/shared-files/`.
- Bot chỉ tải được URL trỏ tới IP public: chặn loopback/mạng nội bộ/metadata cloud
  (phòng prompt injection lừa bot đọc dịch vụ nội bộ rồi gửi ra chat).
- Deploy sau Caddy/Nginx thì phải đặt `DASHBOARD_BEHIND_PROXY=true` (rate-limit
  login đúng IP + cookie `Secure`).
