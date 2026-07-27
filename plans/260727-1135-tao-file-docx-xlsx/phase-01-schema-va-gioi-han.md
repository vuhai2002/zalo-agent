# Phase 01 - Schema tài liệu + giới hạn an toàn

Liên quan: [plan.md](plan.md) · [report nghiên cứu](reports/nghien-cuu-llm-tra-file-va-thu-vien.md)

## Tổng quan

- **Ưu tiên**: cao nhất - mọi phase sau đều phụ thuộc
- **Trạng thái**: chưa làm
- Định nghĩa "model gửi gì" và "bot chấp nhận tới đâu". Đây là bề mặt tấn công duy
  nhất của tính năng này nên phải chốt trước khi có dòng render nào.

## Insight quyết định thiết kế

Schema là **trung gian**, cố tình KHÔNG giống API của `docx`/`write-excel-file`:

- Model chỉ cần hiểu 4 khái niệm (`heading`, `paragraph`, `bullets`, `table`), không
  cần biết DXA, `WidthType`, `ShadingType` là gì.
- Đổi thư viện sau này chỉ sửa renderer, không đụng prompt/schema - model đã "học"
  schema nào thì giữ nguyên schema đó.
- Schema hẹp = model ít sai. Mỗi khái niệm thừa là một chỗ model bịa ra tham số lạ.

## Yêu cầu

**Chức năng**

- Schema Zod cho tài liệu văn bản: danh sách block, mỗi block là một trong 4 loại.
- Schema Zod cho bảng tính: danh sách sheet, mỗi sheet có tên + cột + dòng.
- Ô bảng tính hỗ trợ 3 kiểu: chữ, số (có định dạng), công thức.
- Hàm kiểm giới hạn trả về thông báo tiếng Việt cho model đọc hiểu (không throw).

**Phi chức năng**

- Module thuần: chỉ import `zod` + env, không chạm DB/mạng - test không cần setupTestEnv.
- Giới hạn đọc từ env, có mặc định an toàn.

## Kiến trúc

```
src/documents/
  document-content-schema.ts   <- schema Zod + type, dùng chung tool và renderer
  document-limits.ts           <- đọc env, hàm checkWithinLimits()
```

Luồng: tool nhận input -> Zod parse (sai shape thì AI SDK tự báo model sửa) ->
`checkWithinLimits` (quá khổ thì trả thông báo, model tự rút gọn) -> renderer.

## Chi tiết schema

```ts
// Tài liệu văn bản
type DocumentBlock =
  | { type: "heading"; text: string; level: 1 | 2 | 3 }
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] };

// Bảng tính
type SpreadsheetCell =
  | { kind: "text"; value: string }
  | { kind: "number"; value: number; format?: "plain" | "money" | "percent" }
  | { kind: "formula"; value: string };   // vd "=SUM(D2:D9)"

type Sheet = { name: string; headers: string[]; rows: SpreadsheetCell[][] };
```

Ghi chú: cột `format` là **tên gợi nhớ** chứ không phải mã Excel - renderer map sang
`#,##0` / `0.0%`. Model không được tự đặt mã định dạng (dễ sinh mã sai làm vỡ file).

## Giới hạn (env mới)

| Env | Mặc định | Ý nghĩa |
|---|---|---|
| `DOCUMENT_MAX_BLOCKS` | 60 | Số block tối đa 1 file docx |
| `DOCUMENT_MAX_ROWS` | 200 | Số dòng tối đa mỗi bảng/sheet |
| `DOCUMENT_MAX_CHARS` | 20000 | Tổng ký tự nội dung (chặn model đổ cả cuốn sách) |
| `DOCUMENT_MAX_SHEETS` | 5 | Số sheet tối đa 1 file xlsx |

Phải có đủ ở 3 nơi: `.env.example`, `.env.production.example`, schema Zod trong
`src/config/env.ts`.

## File liên quan

- Tạo: `src/documents/document-content-schema.ts`, `src/documents/document-limits.ts`
- Sửa: `src/config/env.ts`, `.env.example`, `.env.production.example`

## Todo

- [ ] Viết schema Zod + type xuất ra
- [ ] Viết `checkWithinLimits` (trả `{ ok: true } | { ok: false; reason: string }`)
- [ ] Thêm 4 env vào 3 nơi
- [ ] Test: schema chấp nhận input hợp lệ, từ chối shape sai, giới hạn chặn đúng ngưỡng

## Tiêu chí hoàn thành

- `pnpm typecheck` sạch.
- Test phủ: mỗi loại block parse được, ô công thức phải bắt đầu bằng `=`, vượt từng
  giới hạn đều có thông báo riêng biệt (không gộp chung một câu chung chung).

## Rủi ro

- **Schema quá hẹp** -> model không diễn đạt được nhu cầu thật (vd cần ảnh trong docx).
  Giảm thiểu: bản đầu cố tình hẹp, mở rộng sau khi thấy log model gọi gì.
- **Giới hạn quá chặt** -> báo giá 30 dòng bị chặn oan. Giảm thiểu: mặc định rộng rãi
  (200 dòng), chỉnh được bằng env.

## An toàn

- Không nhận HTML/markdown thô - chỉ text thuần, renderer tự escape khi ghi XML.
- Ô công thức: chỉ cho `=` + ký tự an toàn, chặn chuỗi lạ. Công thức Excel không
  chạy code trên máy bot nên rủi ro thấp, nhưng vẫn chặn để file không vỡ.
