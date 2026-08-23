# Phase 04 - Ghi promptTokens per-step để hiệu chỉnh KY_TU_MOI_TOKEN (#5)

Nguồn dsh: `packages/llm/token-meter` (chỉ mượn Ý per-step usage, KHÔNG bê cỗ máy fold).

## Bối cảnh
`src/shared/ky-tu-moi-token.ts` `KY_TU_MOI_TOKEN=2.5` là hằng "đoán rồi theo dõi log".
`token-estimate.ts` tự thú: không hiệu chỉnh được vì DB chỉ lưu `agent_turns.input_tokens`
= totalUsage cộng dồn mọi step, không có cỡ context của MỘT lần gọi. Vercel AI SDK trả
`usage` cho TỪNG step -> bắt đúng ranh giới step là hiệu chỉnh được.

## Mục tiêu
Khi chạy `streamText` (`stream-text-result.ts`), ghi `promptTokens` per-step cạnh số ký
tự input per-step vào một bảng nhỏ (hoặc log có cấu trúc) để sau này đọc, đối chiếu,
chỉnh hằng số. Đây là cải thiện ĐO LƯỜNG, KHÔNG thêm tokenizer, KHÔNG đổi cách ước lúc
chạy (vẫn dùng 2.5 tới khi có dữ liệu để chỉnh).

## Files
- `src/agent/stream-text-result.ts` (bắt usage per-step qua `onStepFinish`/step stream)
- có thể thêm bảng nhỏ trong `src/conversation/` hoặc cột vào chỗ hợp lý
- `src/shared/ky-tu-moi-token.ts` / `token-estimate.ts` (đọc/ghi chú cách hiệu chỉnh)

## Tùy chọn gộp
- Thông điệp `LUAT_CHEO` (`runtime-tuning-settings.ts`) nêu tên field hỏng - micro, gộp
  nếu tiện.

## Success criteria
- Test: mỗi step ghi đúng cặp (soKyTuInput, promptTokens).
- Phá-kiểm.
- Không làm chậm/นặng đường gửi (ghi nhẹ, không chặn).

## Rủi ro
- Ranh giới step của AI SDK: phải chắc `usage.promptTokens` là của step đó, không cộng dồn.
- Không phình DB: cân nhắc chỉ ghi log thay vì bảng nếu chỉ để đo thủ công.
