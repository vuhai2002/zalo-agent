# Phase 2 - API server Hono + auth

## Overview

HTTP API cùng process với bot. Bind 127.0.0.1, port `DASHBOARD_PORT` (default 3900). Prod sau Caddy.

## Related Code Files

Tạo mới (thư mục `src/server/`):
- `dashboard-server.ts` - khởi động Hono + @hono/node-server, mount routes, serve static web/dist
- `auth-middleware.ts` - login bằng `DASHBOARD_PASSWORD` (so sánh constant-time), HMAC signed cookie (key = `CREDENTIALS_ENCRYPTION_KEY`), rate-limit login 5 lần/phút/IP
- `routes/auth-routes.ts` - POST /api/auth/login, /logout, GET /api/auth/me
- `routes/thread-routes.ts` - GET /api/threads (filter account/q/page), GET /api/threads/:key/messages (paged), PATCH /api/threads/:key (bot_enabled)
- `routes/contact-routes.ts` - GET /api/contacts (q/page)
- `routes/overview-routes.ts` - GET /api/overview (accounts running, tin hôm nay, token 7 ngày từ agent_turns)
- `routes/health-routes.ts` - GET /api/health (no auth, Cache-Control: no-store, liveness only)

Sửa:
- `src/index.ts` - start/stop dashboard server cùng vòng đời bot
- `src/zalo/account-manager.ts` - export trạng thái account đang chạy cho overview
- env: `DASHBOARD_PORT`, `DASHBOARD_PASSWORD` (3 nơi)

## Dependencies

`hono`, `@hono/node-server` (theo pnpm rules sẵn có của repo).

## Success Criteria

- Không auth -> 401 mọi endpoint trừ /api/health
- Login sai 5 lần -> 429; login đúng -> cookie hoạt động qua restart (HMAC từ key cố định)
- curl được threads/messages/contacts với pagination; PATCH tắt bot có hiệu lực ngay
- Test: auth middleware (sai/đúng/rate-limit), route threads/contacts với DB test
