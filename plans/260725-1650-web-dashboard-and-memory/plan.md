# Web Dashboard + Memory - zalo-agent

Ngày lập: 2026-07-25. Đã thảo luận + chốt với user trong session.

## Mục tiêu

1. Dashboard web (mẫu GoClaw, tone xanh Zalo #0068FF): Sessions, Contacts, Providers, Overview.
2. Memory 3 lớp cho agent (theo mô hình ChatGPT/OpenClaw: transcript + summary + saved facts).

## Quyết định đã chốt với user

- Provider page: **full edit gồm cả API key** (key lưu DB, mã hóa AES-256-GCM bằng `CREDENTIALS_ENCRYPTION_KEY` sẵn có).
- Memory privacy **bất đối xứng**: fact học ở DM chỉ inject ở DM người đó; fact học ở group inject ở group đó + DM người đó. Private không bao giờ chảy ra public.
- Passive listening group: tin không @mention vẫn ghi history (không gọi LLM), mặc định bật.
- Không dùng vector DB / RAG ở giai đoạn này (ChatGPT cũng không dùng cho memory).
- Server Hono chạy **cùng process** với bot, bind 127.0.0.1, sau Caddy khi lên VPS.

## Phases

| # | Phase | File | Trạng thái |
|---|---|---|---|
| 1 | Data layer: threads/contacts/agent_turns + passive listening + timestamps | [phase-01-data-layer.md](phase-01-data-layer.md) | Done (verify: backfill chạy đúng trên copy DB thật) |
| 2 | API server Hono + auth | [phase-02-api-server-auth.md](phase-02-api-server-auth.md) | Done (smoke test port thật: login/401/rate-limit ok) |
| 3 | Web UI React + Vite + Tailwind | [phase-03-web-ui.md](phase-03-web-ui.md) | Done (verify bằng browser: login -> Sessions -> drawer hội thoại thật) |
| 4 | Providers page full edit | [phase-04-providers-page.md](phase-04-providers-page.md) | Done (key mã hóa trong DB, response masked) |
| 5 | Memory 3 lớp | [phase-05-memory-layers.md](phase-05-memory-layers.md) | Done (test ma trận privacy đủ 4 ô) |

Tổng kết: 95 unit test pass, typecheck sạch (server + web), build web 78KB gzip.
Chưa test trên Zalo thật: passive listening group, save_memory tool do agent tự gọi, summary sau 30 tin.

Mỗi phase độc lập chạy được, xong phase nào typecheck + test phase đó.

## Ràng buộc xuyên suốt

- File < 200 dòng, kebab-case. Env var mới đủ 3 nơi (.env.example, .env.production.example, Zod schema).
- Tin bị lọc phải chặn trước LLM. API key không bao giờ trả về plaintext qua HTTP (chỉ masked).
- Dashboard hiển thị hội thoại riêng tư -> bắt buộc auth kể cả localhost.
