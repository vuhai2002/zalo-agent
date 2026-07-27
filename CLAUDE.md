# CLAUDE.md - zalo-agent

Bot AI thường trú trên Zalo **tài khoản cá nhân**, nhiều account chạy chung một process.
Luồng: tin nhắn Zalo -> lọc -> gộp theo thread -> agent loop (LLM tự gọi tool) -> trả lời.

Chi tiết kiến trúc + lý do từng quyết định kỹ thuật: `docs/system-architecture.md`.
Trạng thái V1/V2/V3 + việc còn treo: `docs/project-roadmap.md`.

## Repo tham khảo (chỉ đọc, KHÔNG sửa)

Nằm ngoài project tại `D:\source-code\zalo-agent-references\`:

| Repo | Dùng để tra |
|---|---|
| `zca-js` | Source lib chính - chữ ký hàm, types, `examples/`, `src/apis/` |
| `zalo-agent-cli` | Pattern QR login, lưu credential mã hóa |
| `zalo-personal` | Cách gọi zca-js cho từng tính năng (react, file, tag, group) |
| `deplao-builder` | Pattern quản lý nhiều instance zca-js cùng lúc |
| `goclaw` | Pattern tool hệ thống (datetime, web search chain, UI Built-in Tools). **CC BY-NC 4.0: chỉ soi pattern, KHÔNG copy code** |
| `hermes-agent` | Toolset theo kênh, webhook-safe toolset, cascade web search (MIT - dùng thoải mái) |
| `9router` | Source của chính router đang dùng (MIT). Tra `open-sse/executors/` + `open-sse/translator/` khi cần biết router làm gì với request: khóa cache phiên, `cache_control`, `reasoning_effort`, cloaking |

**Trước khi viết code đụng zca-js, hãy grep trong `zalo-agent-references\zca-js\src\apis\` để xác nhận chữ ký hàm thật thay vì đoán.** Đã có tiền lệ đoán sai: `loginQR` KHÔNG tự ghi file QR khi mình truyền callback - phải tự gọi `event.actions.saveToFile()`.

## Ràng buộc bắt buộc

- **Chỉ dùng nick phụ.** zca-js là API không chính thức, có thể bị Zalo khóa tài khoản.
- **Không nối tool chuyển tiền/thanh toán vào agent.** Bot đọc tin từ người lạ; một tin soạn khéo (prompt injection) có thể lừa agent gọi tool. `zalo-agent-cli` có sẵn bank transfer/VietQR - không harvest phần đó.
- **Không commit `data/`, `.env`, `config/accounts.json`** (đã gitignore). `data/` chứa cookie Zalo mã hóa + SQLite history.
- **1 listener/account**: mở Zalo Web trên trình duyệt sẽ đá listener của bot (bot tự reconnect và đá ngược lại).
- **Không làm gửi tin hàng loạt / campaign CRM** - user đã chủ động loại khỏi phạm vi.

## Quyết định đã chốt (đừng lật lại nếu không có bằng chứng mới)

- Dùng `zca-js` qua npm, **không fork**. Update lib bằng `pnpm update`.
- Agent loop **tự viết** bằng Vercel AI SDK, không dùng framework agent (OpenClaw/Hermes/Zylos).
- LLM gọi qua **router proxy 9Router** (`LLM_PROVIDER=openai-compatible`) để đổi provider bằng env, không sửa code.
- History dùng **`node:sqlite` built-in**, không dùng better-sqlite3 (cần Visual Studio Build Tools trên Windows).
- tsconfig để `moduleResolution: Bundler` - `index.d.ts` của zca-js dùng directory import, NodeNext không resolve được types.
- Tạo file Office bằng `docx` + `exceljs` (npm), **không** dùng `write-excel-file` dù nhẹ hơn 12 lần: nó không ghi được giá trị cache `<v>` cho công thức nên mọi công cụ xem trước hiện ô trống, và ghi thừa dấu bằng trong `<f>` (sai ECMA-376). Cũng **không** cài LibreOffice để recalc - bot tự tính kết quả rồi ghi kèm.
- Tool tạo file chỉ nhận **dữ liệu** (tiêu đề, đoạn văn, bảng), tuyệt đối không chạy code do model sinh ra: bot đọc tin người lạ nên đó là đường prompt injection thành RCE.
- Vẽ ảnh gọi `/v1/images/generations` với **`?response_format=binary` + JPEG** (157 KB so với 2.4 MB của JSON base64 PNG). Ảnh gốc để sửa nằm ở trường **`image`** dạng data URI, KHÔNG phải `ref_image` - sai tên thì provider bỏ qua âm thầm và ra ảnh vẽ mới. **Không gửi `size`**: model bỏ qua tham số này (đo: xin 1024x1024 nhận 1536x1024). Lỗi có 2 hình dạng - `400` trả `error.message`, `401` trả `error` là chuỗi.

## Lệnh hay dùng

```bash
pnpm zalo-login <account-id>   # login QR, ảnh QR tự mở (KHÔNG phải `pnpm login` - trùng lệnh built-in pnpm)
pnpm dev                       # chạy bot (watch mode)
pnpm typecheck                 # bắt buộc chạy trước khi báo hoàn thành
```

## Quy ước code

- File < 200 dòng, kebab-case, tên tự mô tả.
- Env var mới phải có đủ ở 3 nơi: `.env.example`, `.env.production.example`, schema Zod trong `src/config/env.ts`.
- Tin nhắn bị lọc (allowlist, thiếu @mention) phải bị chặn **trước** khi gọi LLM để không tốn token.
- Chuỗi tiếng Việt giữ nguyên dấu; chỉ dùng dấu câu ASCII.
