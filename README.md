# zalo-agent

Bot AI thường trú trên Zalo (tài khoản cá nhân, multi-account): nhận tin nhắn -> agent loop (LLM tự gọi tool: thả reaction, gửi file, tag thành viên, xem info nhóm, đọc ảnh) -> trả lời.

- Zalo layer: [zca-js](https://github.com/RFS-ADRENO/zca-js) (unofficial API - CÓ RỦI RO KHÓA NICK, chỉ dùng nick phụ)
- Agent layer: Vercel AI SDK - provider cắm rời qua env (router proxy OpenAI-compatible hoặc Anthropic trực tiếp)
- History: SQLite (better-sqlite3), theo account + thread

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
pnpm zalo-login acc-chinh   # tạo mã QR, ảnh tự mở - quét bằng app Zalo
pnpm dev                    # chạy bot (watch mode)
```

## Cấu trúc

```
src/
├── config/        env (Zod) + accounts.json (multi-account)
├── zalo/          login, credential mã hóa, listener + reconnect, parse tin nhắn, account manager
├── agent/         agent loop (AI SDK), provider theo env, persona, tools/
├── conversation/  SQLite history
└── middleware/    allowlist + @mention filter, rate limit gửi tin
```

## Lưu ý an toàn

- `data/` chứa cookie Zalo (đã mã hóa AES-256-GCM) + db - KHÔNG commit, không share.
- Không nối tool chuyển tiền/thanh toán vào agent (rủi ro prompt injection).
- Mở Zalo Web trên trình duyệt sẽ đá listener của bot (bot tự reconnect lại).
- File cho phép bot gửi đặt trong `data/shared-files/`.
