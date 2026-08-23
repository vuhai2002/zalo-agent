# Phase 00 - Điều tra nghi vấn BUG: abortSignal của lượt có tới tool mạng không

**Loại: ĐIỀU TRA (không sửa code).** Theo Issue/Bug Fix Protocol: tìm root cause,
báo user, xin duyệt rồi mới sang Phase 01.

## Nghi vấn (từ subagent research cụm guard/tool)
dsh (`guard/timeout-policy`) theo hợp đồng "cooperative cancel": chỉ tool CHỊU forward
`exec.signal` mới được coi là có timeout. zalo-agent có timeout mạng PHI TẬP TRUNG
(`safe-remote-download.ts` `DEFAULT_TIMEOUT_MS`, Jina `AbortSignal.timeout`, `upLenZalo`
`Promise.race` 5 phút) + trần LƯỢT `LLM_TURN_TIMEOUT_MS`. Nghi vấn: khi trần LƯỢT bắn,
AI SDK truyền `abortSignal` vào `execute(args,{abortSignal})`, nhưng
`downloadFromPublicUrl`/web-fetch có thể KHÔNG nhận/forward -> URL người lạ treo dưới
ngưỡng timeout mạng vẫn ăn tới trần lượt trong khi request nền còn sống.

## Cần trả lời (bằng đọc code)
1. Vòng agent-loop có đặt timeout cấp lượt bằng `AbortController` không, và có truyền
   signal đó vào `streamText`/tool `execute` không? (`src/agent/agent-loop.ts`,
   `stream-text-result.ts`)
2. `execute` của các tool mạng (`web-fetch-tool.ts`, `tai-video`, KB fetch) có nhận
   `{abortSignal}` từ AI SDK và forward xuống `downloadFromPublicUrl`/`fetch` không?
3. `downloadFromPublicUrl` (`safe-remote-download.ts`) có tham số signal không, hay chỉ
   có timeout nội bộ?
4. Thực tế điều gì xảy ra khi lượt hết giờ giữa lúc một tool đang tải: request nền có
   bị hủy không, hay chạy tới khi timeout mạng riêng của nó?

## Đầu ra
Báo cáo root cause + phạm vi + đề xuất sửa (nếu là bug thật) -> `reports/`. Xin duyệt.
Nếu KHÔNG phải bug (signal đã tới) thì ghi nhận và bỏ Phase 01.

## Success criteria
- Khẳng định dứt khoát có/không phải bug, dẫn `file:line`.
- Nếu là bug: nêu đúng chỗ đứt chuỗi signal + cách nối lại tối thiểu.
