# System Architecture - zalo-agent

## Tổng quan

```
Zalo servers <--ws/https--> zca-js (npm lib, unofficial)
                                |
                    src/zalo/account-manager.ts   (N account, mỗi account 1 api + 1 listener)
                                |
              middleware: allowlist-filter -> (lọc xong mới tốn token)
                                |
                    src/agent/agent-loop.ts       (Vercel AI SDK generateText + tools)
                                |                  provider theo env: 9Router / Anthropic
              tools: add_reaction | send_file | tag_member | get_group_info
                                |
              middleware: rate-limiter (queue per thread + delay ngẫu nhiên) -> sendMessage
                                |
              conversation/history-store.ts        (node:sqlite, key account_id + thread_id)
```

## Quyết định kỹ thuật chính

| Quyết định | Lý do |
|---|---|
| Dùng zca-js qua npm, không fork | Update lib bằng `pnpm update`; phần reverse-engineer giao thức để lib gánh |
| Vercel AI SDK thay vì SDK provider trực tiếp | Đổi LLM provider = đổi env, không sửa code (mặc định trỏ router proxy 9Router) |
| `node:sqlite` built-in thay better-sqlite3 | better-sqlite3 cần Visual Studio Build Tools trên Windows (Node 24 chưa có prebuilt); node:sqlite đủ cho history, zero native dep. Trạng thái experimental - nếu Node đổi API thì chỉ sửa 1 file `history-store.ts` |
| tsconfig `moduleResolution: Bundler` | `index.d.ts` của zca-js dùng directory import (`export * from "./dist"`) - NodeNext không resolve được types; Bundler khớp cách tsx/esbuild chạy runtime |
| Cookie mã hóa AES-256-GCM, key từ env | Cookie = full quyền tài khoản Zalo; file layout `[iv][authTag][ciphertext]`, mode 0600 |
| Filter trước agent | Tin bị lọc (không @mention, ngoài allowlist, tin của bot) không bao giờ chạm LLM -> không tốn token |
| Tool send_file giới hạn `data/shared-files/` | Chặn agent đọc file tùy ý trên máy (vd credentials) qua prompt injection |

## Ràng buộc từ Zalo (qua zca-js)

- 1 listener/account: mở Zalo Web trên trình duyệt sẽ đá listener bot (bot tự reconnect với backoff).
- Rủi ro khóa nick vì dùng unofficial API - chỉ dùng nick phụ, giữ rate limit gửi tin.
- zca-js v2 bỏ sharp: gửi ảnh cần `imageMetadataGetter` - đã wire bằng package `image-size` trong `zalo-client.ts`.
