# Phase 1 - Data layer

## Overview

Nền cho mọi phase sau: 3 bảng mới + refactor DB dùng chung + passive listening + timestamps trong replay + kill switch per thread.

## Related Code Files

Tạo mới:
- `src/conversation/database.ts` - mở DB, chạy migrations (CREATE TABLE + ALTER), export db dùng chung
- `src/conversation/thread-store.ts` - upsert thread, toggle bot_enabled, backfill, list/query
- `src/conversation/contact-store.ts` - upsert contact, backfill từ direct threads, list/query
- `src/conversation/usage-store.ts` - ghi agent_turns, tổng hợp per thread / per ngày

Sửa:
- `src/conversation/history-store.ts` - dùng db chung; thêm cột sender_id; trả created_at
- `src/middleware/allowlist-filter.ts` - FilterDecision thêm `record` (respond=false vẫn có thể ghi history)
- `src/zalo/account-manager.ts` - wire: upsert thread/contact mọi tin đến, check bot_enabled, ghi passive, ghi usage, resolve tên group
- `src/agent/agent-loop.ts` - replay kèm `[dd/MM HH:mm]`, trả về usage
- `src/agent/persona-prompt.ts` - giải thích format timestamp cho model
- `src/config/accounts.ts` - field `groupPassiveListen` (default true)

## Schema

```sql
threads   (account_id, thread_id, thread_type INT, display_name, bot_enabled INT DEFAULT 1,
           message_count INT, last_message_at, last_sender_name, PRIMARY KEY (account_id, thread_id))
contacts  (account_id, user_id, display_name, first_seen, last_seen,
           message_count INT, PRIMARY KEY (account_id, user_id))
agent_turns (id PK, account_id, thread_id, input_tokens, output_tokens, total_tokens,
             steps, created_at)
messages  + cột sender_id TEXT (ALTER, nullable - dữ liệu cũ không có)
```

## Luồng xử lý tin đến (account-manager)

1. parse -> upsert contact + thread (mọi tin không phải của bot, kể cả tin sẽ bị lọc - "auto-collected")
2. `shouldRespond` -> `{ respond, record, reason }`
   - respond=true: như cũ (batch -> agent)
   - respond=false, record=true (group không mention + groupPassiveListen; hoặc thread bị tắt bot): ghi history, không LLM
   - respond=false, record=false (tin của bot, tin rỗng, ngoài allowlist): bỏ qua như cũ
3. bot_enabled=false của thread -> respond=false, record=true
4. Sau agent turn: ghi agent_turns từ result.totalUsage

## Todo

- [ ] database.ts + migrations + backfill threads/contacts từ messages
- [ ] thread-store / contact-store / usage-store + tests
- [ ] history-store: sender_id, created_at, db chung; sửa test nếu cần
- [ ] allowlist-filter record flag + tests
- [ ] account-manager wire + agent-loop timestamps/usage + persona-prompt
- [ ] accounts.ts groupPassiveListen + accounts.example.json
- [ ] typecheck + full test pass

## Success Criteria

- Tin đến bất kỳ -> contact + thread xuất hiện trong DB với count/last_seen đúng
- Tắt bot_enabled -> bot im nhưng vẫn ghi history
- Group: tin không mention vào history; lần mention sau agent thấy ngữ cảnh
- Replay có timestamp; agent_turns có usage sau mỗi lượt
