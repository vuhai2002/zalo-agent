# Phase 3 - Web UI

## Overview

SPA React + Vite + Tailwind trong `web/`, layout theo mẫu GoClaw user gửi nhưng tone xanh Zalo `#0068FF`. Dev: Vite proxy -> API. Prod: `vite build` ra `web/dist`, Hono serve.

## Cấu trúc

```
web/
├── package.json          # workspace riêng hoặc devDeps root (quyết định khi làm: ưu tiên đơn giản)
├── vite.config.ts        # proxy /api -> localhost:3900
├── tsconfig.json         # JSX, DOM libs (tách khỏi tsconfig server)
├── index.html
└── src/
    ├── main.tsx, app.tsx                    # router + auth guard
    ├── api/dashboard-api-client.ts          # fetch wrapper, 401 -> về login
    ├── layout/sidebar-nav.tsx               # sections: Core/Conversations/Data/System
    ├── pages/login-page.tsx
    ├── pages/overview-page.tsx              # cards: accounts, tin hôm nay, token 7 ngày
    ├── pages/sessions-page.tsx              # bảng threads + toggle bot + mở drawer
    ├── pages/session-detail-drawer.tsx      # xem hội thoại (phân trang)
    ├── pages/contacts-page.tsx              # bảng contacts, search, filter type
    └── shared/                              # table, badge, pagination components
```

## Ghi chú

- Màu: primary #0068FF, nền sáng giống mẫu, badge Direct/Group như screenshot.
- Không thêm UI framework nặng (shadcn để sau nếu cần) - Tailwind thuần đủ cho bảng + form.
- Tiếng Việt có dấu toàn bộ label.
- `tsconfig.build.json` cho server (exclude test + web) - trả nợ ghi chú từ commit test.

## Success Criteria

- Login -> xem được Sessions/Contacts/Overview với data thật từ bot đang chạy
- Toggle bot per thread từ UI có hiệu lực ngay
- `pnpm build:web` ra static; Hono serve; `pnpm typecheck` sạch cả 2 tsconfig
