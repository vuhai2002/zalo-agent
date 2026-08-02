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
- **Tool KHÔNG ném lỗi ra agent loop** - mọi nhánh hỏng bắt lại rồi trả câu cho model diễn giải. Hệ quả dễ quên: AI SDK chỉ sinh phần `tool-error` khi `execute` NÉM, nên nhánh hỏng trả chuỗi trơn là vô hình với `tool-loop-guard`. Vì vậy **mọi nhánh hỏng PHẢI bọc bằng `ketQuaLoi(...)`** (`src/agent/tools/tool-failure-result.ts`) - object `{ok:false,loi}` chứ không phải tiền tố chuỗi, vì nội dung web/tin nhắn của người lạ đi thẳng vào chuỗi kết quả nên luật dựa trên chữ có thể bị soạn cho trùng. Nhánh thành công vẫn trả chuỗi trần. Test dùng `loiCuaTool()` để khẳng định luôn cả dấu hiệu.
- Vẽ ảnh gọi `/v1/images/generations` với **`?response_format=binary` + JPEG** (157 KB so với 2.4 MB của JSON base64 PNG). Ảnh gốc để sửa nằm ở trường **`image`** dạng data URI, KHÔNG phải `ref_image` - sai tên thì provider bỏ qua âm thầm và ra ảnh vẽ mới. **Không gửi `size`**: model bỏ qua tham số này (đo: xin 1024x1024 nhận 1536x1024). Lỗi có 2 hình dạng - `400` trả `error.message`, `401` trả `error` là chuỗi.
- Lịch hẹn (`src/scheduler/`, tool `schedule_task`): KHÔNG nhận chuỗi datetime, chỉ `{date,time}` rời hoặc `{inMinutes}` - chuỗi naive qua `new Date()` bị hiểu theo giờ hệ điều hành, đúng lỗi Hermes từng dính (`jobs.py`, issue #51021). Quy đổi giờ CHỈ đi qua `zonedWallClockToUtc` (luxon, dependency trực tiếp trong `package.json` dù `cron-parser` đã kéo gián tiếp - pnpm layout chặn import gián tiếp).
- Job `once` trễ quá `SCHEDULER_ONCE_GRACE_MINUTES` vẫn GỬI kèm nhãn "(nhắc trễ, lịch gốc HH:MM)", không im lặng nuốt như Hermes/goclaw - bot cá nhân thì mất tích một lời đã hẹn là kết cục tệ nhất. Không retry ở tầng scheduler (agent-loop đã có 2 tầng chống chịu, thêm nữa là chồng 3 tầng); riêng lỗi ĐƯỜNG GỬI thử lại tối đa 3 lần qua cột bền `delivery_attempts`.
- Lượt agent theo lịch chạy `isolated: true`, loại 9 tool khỏi lượt này (`runsInScheduledTurn: false` trong `tool-registry.ts`): 4 tool thiếu hạ tầng cho lượt cô lập + 5 tool (`send_file`, `create_word_document`, `create_excel_file`, `create_image`, `tag_member`) gọi thẳng `enqueueSend` né hoàn toàn trần `SCHEDULER_MAX_PROACTIVE_PER_DAY`. Trần đó đếm theo TIN ZALO thật (không phải lượt job) ở bảng bền `proactive_send_counters` (không đếm bộ nhớ - mất khi restart; không đếm từ `scheduled_job_runs` - bị prune).
- "Chạy thử ngay" trên dashboard phải GIÀNH job (`next_run_at = NULL`) trước khi dispatch, giống clear-before-dispatch của vòng tick thật - không thì tick thật xen vào giữa gây gửi trùng.

## Lệnh hay dùng

```bash
pnpm zalo-login <account-id>   # login QR, ảnh QR tự mở (KHÔNG phải `pnpm login` - trùng lệnh built-in pnpm)
pnpm dev                       # chạy bot (watch mode)
pnpm typecheck                 # bắt buộc chạy trước khi báo hoàn thành
```

## Quy ước code

- File < 200 dòng, kebab-case, tên tự mô tả.
- Env var mới: khai schema Zod trong `src/config/env.ts` **kèm `.default()`** - `CREDENTIALS_ENCRYPTION_KEY` là biến DUY NHẤT được phép bắt buộc (nó giải mã chính những gì dashboard lưu nên không thể nằm trên dashboard). Tham số chỉnh được lúc chạy thì thêm vào `src/config/tuning-definitions.ts` là đủ - nó tự hiện trên trang Cấu hình. **Chỉ** thêm vào `.env.example` / `.env.production.example` khi biến đó phải đọc TRƯỚC lúc mở DB (log, DATA_DIR, cổng dashboard) - hai file đó cố ý chỉ còn 13 dòng, vì giá trị cũ nằm lại trong `.env` trong khi DB đang gánh đã gây hiểu nhầm thật.
- Thứ tự ưu tiên cấu hình ở MỌI nơi: dashboard (DB `runtime_settings`) > `.env` > `.default()` trong schema. Thiếu cấu hình LLM **không được** chặn boot: phải vào được dashboard mới nhập được.
- Tin nhắn bị lọc (allowlist, thiếu @mention) phải bị chặn **trước** khi gọi LLM để không tốn token.
- Chuỗi tiếng Việt giữ nguyên dấu; chỉ dùng dấu câu ASCII.

## Bẫy khi viết test

- `database.ts` mở SQLite và chạy migration ở MODULE SCOPE. Test nào import (trực tiếp hay bắc cầu) module đó TRƯỚC khi gọi `setupTestEnv()` (trong `src/shared/test-env-setup.ts`) sẽ mở nhầm `data/zalo-agent.db` THẬT thay vì DB tạm - migration hiện tại đều idempotent nên vô hại, nhưng một migration có backfill/ALTER sau này sẽ chạy lên dữ liệu thật mỗi lần ai đó chạy `pnpm test`. Luôn gọi `setupTestEnv()` xong rồi mới `await import()` động các module chạm DB - không import tĩnh ở đầu file test.
