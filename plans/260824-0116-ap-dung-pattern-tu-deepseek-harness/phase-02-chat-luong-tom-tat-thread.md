# Phase 02 - Nâng chất lượng tóm tắt thread (#2 + #3 + #4)

Nguồn dsh: `packages/compaction/compaction-basic/src/summarizer.ts` (COMPACTION_INSTRUCTION,
CHECKPOINT_PREAMBLE), `region.ts` (guard cỡ).

## Mục tiêu (3 cải tiến, cùng đụng thread-summarizer)
1. **Prompt tóm tắt cấu trúc cố định** (`buildSummaryPrompt()`): thay "tối đa 300 từ" tự do
   bằng bộ mục cố định hợp domain chat cá nhân (Người & quan hệ / Quyết định & đã hứa /
   Sở thích & thói quen / Việc đang dở / Câu hỏi treo). Meta-rule mượn từ dsh:
   - mục rỗng ghi "(none)", KHÔNG bỏ mục (chống LLM lặng lẽ đánh rơi khía cạnh);
   - giữ NGUYÊN VĂN đính chính của người dùng;
   - lần gộp thứ N: "giữ fact còn đúng, bỏ fact cũ, hợp nhất vào MỘT bản", không chép nguyên.
   KHÔNG bê bộ mục coding của dsh (Files/Code/Errors...) - vô nghĩa với bot chat.
2. **Guard cỡ** (`maybeSummarizeThread()`): nếu summary mới >= (oldSummary + backlog) đã đo
   thì KHÔNG ghi đè (bắt ca LLM trả dài dòng làm summary phình thay vì co).
3. **Framing checkpoint** lúc inject: bọc summary bằng câu "đây là bối cảnh nền đã chốt,
   dựa vào mà tiếp, ĐỪNG nhắc lại/xác nhận" + cặp tag, tại chỗ `getThreadSummary` được
   nhét vào system prompt.

## Files
- `src/conversation/thread-summarizer.ts` (prompt + guard)
- chỗ inject summary (tìm caller `getThreadSummary` trong `src/agent/`)

## Success criteria
- Test: prompt chứa đủ 5 mục + luật "(none)"/đính chính/gộp; guard chặn summary phình;
  framing bọc đúng khi có summary, không thêm gì khi rỗng.
- Phá-kiểm từng cái.
- Giữ nguyên kiến trúc: vẫn 1 LLM call fire-and-forget, incremental, không stream.

## Rủi ro
- Đổi prompt có thể đổi hành vi eval hiện có - chạy eval liên quan nếu có.
- Guard cỡ đo bằng ước token (`ky-tu-moi-token`) - dùng cùng thước với chỗ cắt context.
