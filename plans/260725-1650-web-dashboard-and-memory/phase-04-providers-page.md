# Phase 4 - Providers page (full edit, user đã chốt)

## Overview

Đổi provider/model/base URL/API key từ UI, áp dụng ngay không restart. User chọn full edit dù đã được cảnh báo trade-off; giảm rủi ro bằng mã hóa + masked response.

## Thiết kế

- Bảng `runtime_settings (key TEXT PRIMARY KEY, value TEXT, updated_at)` - value của `llm_api_key` mã hóa AES-256-GCM bằng `CREDENTIALS_ENCRYPTION_KEY` (tái dùng pattern `zalo-credential-store.ts`).
- `src/config/runtime-llm-settings.ts` - đọc/ghi override, cache in-memory, invalidate khi PATCH.
- `resolveLanguageModel()` đọc: runtime_settings -> env (fallback). Provider được tạo lại khi settings đổi.
- API: GET /api/provider (key trả `sk-...abc` masked, không bao giờ plaintext), PATCH /api/provider (validate qua Zod: provider enum, URL, model non-empty; key optional - bỏ trống = giữ key cũ).
- UI `pages/providers-page.tsx`: form + nút Test connection (gọi 1 completion ngắn, báo ok/lỗi).

## An toàn

- Key nhập qua form chỉ đi 1 chiều lên server (HTTPS/localhost), lưu mã hóa, không log.
- PATCH ghi audit log (pino info: ai đổi gì, không ghi giá trị key).
- Rollback: xóa row runtime_settings -> quay về env.

## Success Criteria

- Đổi model từ UI -> lượt agent kế tiếp dùng model mới (thấy trong agent_turns/log)
- GET không bao giờ trả key đầy đủ; restart vẫn giữ override; xóa override quay về env
