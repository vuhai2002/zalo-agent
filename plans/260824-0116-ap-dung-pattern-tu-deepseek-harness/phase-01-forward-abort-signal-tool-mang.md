# Phase 01 - Forward abortSignal của lượt vào tool chạm mạng

**Phụ thuộc: Phase 00 xác nhận là bug + user duyệt.** Nếu P00 kết luận không phải bug
thì bỏ phase này.

## Mục tiêu
Nối `abortSignal` (bắn khi `LLM_TURN_TIMEOUT_MS` hết hoặc lượt bị hủy) xuống các lời
gọi mạng trong tool, theo hợp đồng cooperative của dsh: tool nhận signal từ
`execute(args, {abortSignal})` và forward vào `downloadFromPublicUrl`/`fetch`.

## Phạm vi (chốt lại sau P00)
- `src/shared/safe-remote-download.ts`: thêm tham số `signal` (tùy chọn), nối vào request,
  hủy stream khi abort - GIỮ nguyên timeout mạng nội bộ (hai lớp, không thay thế).
- Các tool mạng: `web-fetch-tool.ts` (và tool khác nếu P00 chỉ ra) forward `abortSignal`.
- KHÔNG đụng `upLenZalo` (đã có Promise.race riêng, và CLAUDE.md cấm race quanh enqueueSend).

## Success criteria
- Test: khi signal abort giữa chừng, tool dừng và trả `ketQuaLoi(...)` (không ném).
- Phá-kiểm: bỏ forward signal -> test đỏ.
- Không hồi quy: các test download/web-fetch cũ vẫn xanh.

## Rủi ro
- AI SDK có thể abort signal ở thời điểm khác kỳ vọng; test phải mô phỏng đúng.
- Tool KHÔNG được ném khi bị abort - phải bọc `ketQuaLoi` như mọi nhánh hỏng.
