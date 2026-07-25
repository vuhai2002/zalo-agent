# Phase 5 - Memory 3 lớp

## Overview

Theo mô hình đã research (ChatGPT: inject hết vào prompt, không vector DB; OpenClaw: compaction + memory flush). Lớp 1 (timestamps + passive listening) đã nằm trong Phase 1.

## Lớp 2 - Rolling summary per thread

- Cột `summary`, `summary_covers_to_message_id` trên bảng `threads`.
- Sau khi bot reply xong (async, không chặn phản hồi): nếu số tin từ `summary_covers_to_message_id` tới tin cũ nhất trong window > ngưỡng (`SUMMARY_TRIGGER_MESSAGES`, default 30), gọi 1 lượt LLM rẻ: "gộp summary cũ + các tin sắp rớt khỏi window thành summary mới <= 300 từ".
- Inject vào system prompt: "Tóm tắt phần hội thoại trước: {summary}".
- Lỗi summary không được làm hỏng lượt chat (try/catch, log warn, thử lại lần sau).

## Lớp 3 - save_memory tool + privacy bất đối xứng (user đã chốt)

- Bảng `memories (id, account_id, subject_id, content, learned_in_thread_id, learned_in_group INT, created_at)`.
- Tool `save_memory(content, about)`: about = "sender" (fact về người đang nói) | "thread" (fact về group/cuộc trò chuyện). Agent tự quyết khi người dùng chia sẻ thông tin đáng nhớ lâu dài.
- Quy tắc inject (bất đối xứng - private không chảy ra public):
  - Chat riêng với A: fact của A (mọi nguồn) + fact của thread DM đó
  - Group X, A vừa nói: fact của thread X + fact của A **học trong group X hoặc group khác** (KHÔNG lấy fact học ở DM)
- System prompt dặn: không nhắc lại thông tin cá nhân của người này trước người khác.
- Giới hạn: max `MEMORY_MAX_FACTS_PER_SUBJECT` (default 50) fact/subject, cũ nhất bị thay khi đầy; mỗi fact <= 500 ký tự (Zod trong tool schema).

## UI

- Trang Memory: list fact theo contact/thread, xóa fact (quyền user - bot không tự xóa).
- Session drawer hiện summary hiện tại của thread.

## Env mới (3 nơi)

`SUMMARY_TRIGGER_MESSAGES=30`, `MEMORY_MAX_FACTS_PER_SUBJECT=50`.

## Success Criteria

- Hội thoại > 50 tin: hỏi lại chuyện đầu cuộc trò chuyện, bot trả lời đúng nhờ summary
- "Mình thích cà phê đen" ở DM -> hôm sau DM hỏi "tôi thích uống gì" bot nhớ; hỏi cùng câu trong group bot KHÔNG tiết lộ
- Fact học trong group inject lại được ở DM
- Test: quy tắc inject bất đối xứng (đủ 4 ô của ma trận), giới hạn fact, summary trigger
