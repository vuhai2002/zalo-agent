# Áp dụng pattern hay từ DeepSeek Harness (dsh) vào zalo-agent

Nguồn: `D:\source-code\zalo-agent-references\deepseek-harness` (MIT, DeepSeek AI).
Đã research 4 cụm bằng 4 subagent; kết luận: ~85% không áp được (dsh là coding-agent
harness event-sourced/plugin-DI, zalo-agent là reactive chat bot nhỏ). Chỉ nhặt vài
pattern rẻ và một nghi vấn bug. Hoãn #7 (config LLM đa-route) vì YAGNI - chưa có nhu
cầu key riêng per-agent.

## Nguyên tắc áp dụng
- dsh chuẩn doanh nghiệp: chỉ mượn META-RULE / HÌNH DẠNG, KHÔNG bê machinery nặng
  (Cordis, capability seam, event-sourcing, lock phân tán). Giữ YAGNI/KISS của zalo-agent.
- Mỗi phase: TDD (test trước) -> code -> phá-kiểm -> spawn subagent Opus review ->
  sửa -> review lại tới khi sạch -> commit -> phase sau. Full suite MỘT lần ở cuối.
- Trong lúc làm, phát hiện thêm gì hợp/không-hợp thì ghi vào `reports/` và báo user.

## Các phase

| Phase | Nội dung | Trạng thái |
|---|---|---|
| [00](phase-00-dieu-tra-abort-signal.md) | Điều tra bug abortSignal | XONG (đính chính: chẩn đoán ban đầu sai - `totalMs` ĐÃ cấp signal cho tool; bug thật là tool không tiêu signal) |
| [01](phase-01-forward-abort-signal-tool-mang.md) | Tool mạng honor abortSignal (Layer 2); gỡ `toolMs` no-op | XONG (2 vòng review Opus, sạch) |
| [02](phase-02-chat-luong-tom-tat-thread.md) | Prompt tóm tắt cấu trúc + framing checkpoint (bọc chống injection) + guard truncation (thay guard cỡ) | XONG (2 vòng review Opus, sạch) |
| [03](phase-03-chong-injection-prompt-job-lich.md) | Bọc payload job theo lịch (wrapUntrustedContent) chống injection có độ trễ | XONG code (review Opus sạch); LƯU Ý: rủi ro hành vi model chưa đo bằng eval |
| [04](phase-04-hieu-chinh-char-token.md) | Ghi ký-tự input đủ phạm vi (system+tools+messages) so với steps[0].inputTokens; bỏ double-count cache | XONG (option B - làm chuẩn; 1 vòng review Opus phát hiện double-count cache, sửa lại; 1 vòng review Opus sạch) |

Hoãn: #7 config LLM đa-route (YAGNI).
Tùy chọn giá trị thấp: perm-bit 0o077 file cookie (đã mã hóa - lean bỏ); thông điệp
LUAT_CHEO nêu tên field (gộp vào P04 nếu tiện).

## Nguồn dsh cho từng phase
- P01: `packages/guard/timeout-policy/src/index.ts`, `packages/util/timeout/src/index.ts`
- P02: `packages/compaction/compaction-basic/src/summarizer.ts` (COMPACTION_INSTRUCTION,
  CHECKPOINT_PREAMBLE), `region.ts` (guard cỡ)
- P03: `packages/schedule/schedule/src/domain.ts` (renderReminderFraming)
- P04: `packages/llm/token-meter` (ý per-step usage, KHÔNG bê cỗ máy fold)
