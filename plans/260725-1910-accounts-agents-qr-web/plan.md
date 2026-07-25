# Accounts + Agents + QR login web

Ngày lập: 2026-07-25. User đã duyệt: DB làm source of truth, accounts.json chỉ seed lần đầu.

## Kiến trúc (học từ GoClaw, đã soi UI thật)

Tách "kênh" khỏi "não" - hiện đang trộn trong config/accounts.json:

- `agents` (não): id, icon, name, persona/instructions, model override (nullable,
  fallback Providers chung), max_steps override, is_default
- `accounts` (tài khoản Zalo): id, label (đặt tên tự do), enabled, policies
  (allowlist, requireMention, passiveListen), `agent_id` -> N account : 1 agent

## Phases

| Phase | Nội dung | Trạng thái |
|---|---|---|
| A | Bảng agents + accounts, seed migration từ accounts.json, agent-loop đọc persona/model qua agent | Done (seed verify trên preview: acc-chinh import đúng) |
| B | API CRUD accounts/agents + UI 2 trang (thêm/đổi tên account, tạo/sửa não, gắn não vào account) | Done (browser verify 2 trang; route test phủ CRUD + guard) |
| C | QR login trên web: `event.data.image` base64 từ loginQR (đã xác nhận references:433), polling status, hot start/stop listener | Done (state machine 6 test: idempotent, phiên đè, QR renew; CHƯA quét QR thật) |
| D (sau) | Budget cap, skills per agent, heartbeat | Not planned |

Tổng: 118 test pass. Chưa test với Zalo thật: quét QR end-to-end, re-login account
đang chạy, agent persona ăn vào câu trả lời thật.

## Quyết định

- DB source of truth; accounts.json đọc 1 lần khi bảng accounts trống (migration
  tự tạo agent từ persona cũ để giữ nguyên hành vi), sau đó file không dùng nữa.
- Giữ tên `AccountConfig` trong code (đổi field persona -> agentId) để giảm churn.
- Memory/history vẫn key theo account - ký ức về người thuộc kênh, không thuộc não.
- QR chỉ nằm sau dashboard auth, không log base64, session login timeout 3 phút.
- account-manager refactor thành lifecycle per account (start/stop runtime) - nền
  cho cả toggle enabled lẫn QR login xong tự chạy.
