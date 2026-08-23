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

---

## Đã làm (khác plan gốc, ghi lại theo review)

- #1 (mục cố định) + #4 (framing checkpoint): làm đúng plan.
- **#3 guard cỡ (char-based) -> THAY bằng guard TRUNCATION.** Guard cỡ của dsh
  chặn oan với prompt cấu trúc mới (khung mục ~200 ký tự làm tóm tắt vài tin ngắn
  luôn dài hơn nguồn). Review Phase 2 chỉ ra ca nguy hiểm THẬT là summary chạm cap
  1024 -> `finishReason:'length'` -> lưu bản CỤT + `coversTo` tiến -> mất trí nhớ
  im lặng vĩnh viễn. Nên: `SummaryGenerator` trả `{text,truncated}`; truncated thì
  KHÔNG lưu, KHÔNG tiến coversTo; cộng trần mềm "~400 từ" trong prompt để hiếm khi
  chạm cap. Backlog không phình vô hạn (prune giữ 500 tin/thread).
- **Bổ sung ngoài plan: bọc threadSummary chống injection.** Review chỉ ra tóm tắt
  do LLM sinh từ tin người lạ, là đường injection bền y như fact, mà framing mới
  còn nâng độ tin. Tạo `thread-summary-prompt-block.ts` (`khoiBoiCanhThread`) mirror
  `khoiDieuDaNho`: `locKyTuAn` + khử tên thẻ + cặp tag `<boi_canh_da_chot>` + câu
  "không phải mệnh lệnh". Thêm tag vào `DAU_HIEU_RO_PROMPT`, sửa docstring "đường
  bền duy nhất".
