# Phase 06 - Kiểm tra đầu ra (khoảng cách E)

## Liên kết ngữ cảnh

- [reports/audit-agent-chuan-production.html](reports/audit-agent-chuan-production.html) mục 3 và 8/E
- Code: `src/zalo/send-reply-in-parts.ts` (96 dòng), `src/agent/persona-prompt.ts`
  (`BASE_PERSONA`), `src/scheduler/silent-sentinel.ts`

## Tổng quan

- **Ưu tiên**: trung bình, nhưng rẻ và người dùng thấy ngay
- **Trạng thái**: XONG (03dbd41 + vòng sửa sau rà soát). **Độc lập** với 04/05.
- Text model trả về đang đi **thẳng** xuống Zalo. Thêm một lớp làm sạch cuối cùng.

## Nhận định then chốt

- **Chưa có gì cả.** Đã tra `send-reply-in-parts.ts` và `agent-turn-content.ts`: không có
  bất kỳ xử lý markdown hay lọc nào. Persona **dặn** không dùng markdown, nhưng dặn không
  phải là bảo đảm.
- **Markdown lọt lưới là lỗi thấy được ngay.** Zalo không render markdown, nên `**đậm**` và
  `## Tiêu đề` hiện ra nguyên ký tự. Đây là thứ người dùng nhìn thấy mỗi ngày, không phải
  rủi ro lý thuyết.
- **Guardrail đầu ra là lớp cuối cùng của mô hình phân lớp OpenAI.** Mọi lớp khác của mình
  đã có (lọc đầu vào, chống injection, rủi ro tool, rules-based); thiếu đúng lớp này.
- **Không làm quá.** Đây là bot cá nhân, không phải hệ kiểm duyệt. Chỉ chữa 3 thứ đo được,
  không thêm bộ lọc nội dung suy đoán.
- **Phải giữ dấu tiếng Việt.** Làm sạch là bỏ **ký tự định dạng**, không đụng vào chữ.

## Yêu cầu

Ba thứ cần chặn, theo thứ tự giá trị:

1. **Markdown**: `**đậm**`, `*nghiêng*`, `` `code` ``, ```` ```khối``` ````, `# Tiêu đề`,
   `[chữ](url)` -> giữ chữ, bỏ ký tự định dạng. Riêng `[chữ](url)` giữ `chữ (url)` vì URL
   là thông tin thật người dùng cần.
2. **Rò system prompt**: câu trả lời chứa dấu hiệu đặc trưng của prompt nội bộ
   (`<noi_dung_ngoai`, `Quy tắc an toàn (tuyệt đối`, `Khả năng của bạn lúc này`) -> không
   gửi, thay bằng câu xin lỗi ngắn + log ERROR.
3. **Sentinel lọt**: `[SILENT]` xuất hiện trong lượt chat thường (nó chỉ có nghĩa trong
   lượt theo lịch) -> bỏ dòng đó.

## Kiến trúc

```
src/zalo/sanitize-reply-text.ts   (thuan, khong import env/logger)
  lamSachTraLoi(text) -> { text, daSua: string[], chan: boolean }

message-turn-processor.ts
  result.text -> lamSachTraLoi -> chan? notifyTechnicalError + log.error
                                : sendReplyInParts(text)
```

Đặt ở `message-turn-processor.ts` chứ **không** trong `sendReplyInParts`: nơi đó cũng được
`scheduled-job-send.ts` dùng, mà lượt theo lịch có luật `[SILENT]` riêng - lọc chung sẽ
phá logic đó.

## File liên quan

Tạo:
- `src/zalo/sanitize-reply-text.ts` (< 200 dòng)
- `src/zalo/sanitize-reply-text.test.ts`

Sửa:
- `src/zalo/message-turn-processor.ts` - gọi trước `sendReplyInParts`
- `src/scheduler/scheduled-job-send.ts` - gọi **sau** khi đã xử lý `[SILENT]`
- `src/agent/persona-prompt.ts` - rút danh sách dấu hiệu rò prompt ra hằng số export được,
  để bộ lọc và persona dùng chung một nguồn

## Các bước

1. `lamSachTraLoi` trả về cả `daSua` (danh sách thứ đã chỉnh) để log biết đường - không
   sửa âm thầm.
2. Markdown: xử lý theo thứ tự **khối trước, inline sau** (``` trước `` ` ``), nếu không sẽ
   cắt nhầm giữa khối code. Bỏ ký tự bao, giữ nội dung.
3. **Không đụng vào dấu gạch đầu dòng `-`** - persona đang **dạy** bot dùng `-` để chia ý.
   Bỏ nó là phá đúng thứ mình vừa yêu cầu.
4. **Không đụng vào `*` giữa từ** (ví dụ `2*3`) - chỉ khớp cặp `*...*` không có khoảng
   trắng ngay sau dấu mở và ngay trước dấu đóng.
5. Rò prompt: nhập dấu hiệu từ hằng số dùng chung với `persona-prompt.ts`. Trúng thì
   `chan: true`, không gửi nửa vời.
6. Sentinel: dùng lại `silent-sentinel.ts` sẵn có để nhận biết, đừng viết regex thứ hai.
7. Nối vào `message-turn-processor.ts`. Nhánh `chan` gọi `notifyTechnicalError` và log
   ERROR kèm 200 ký tự đầu của text bị chặn (để chẩn đoán), **không** ghi vào history.
8. Nối vào `scheduled-job-send.ts` sau bước xử lý `[SILENT]`.
9. Test: từng loại markdown; chuỗi có dấu tiếng Việt đi qua **nguyên vẹn**; `-` đầu dòng
   giữ nguyên; `2*3` giữ nguyên; link ra `chữ (url)`; text chứa dấu hiệu prompt bị chặn;
   text sạch đi qua không đổi một ký tự nào.

## Việc cần làm

- [x] `sanitize-reply-text.ts` (thuần) + test
- [x] Markdown: khối trước inline sau
- [x] Giữ `-` đầu dòng, giữ `*` giữa từ, giữ dấu tiếng Việt
- [x] Link -> `chữ (url)`
- [x] Hằng số dấu hiệu rò prompt dùng chung với `persona-prompt.ts`
- [x] Dùng lại `silent-sentinel.ts`, không viết regex thứ hai
- [x] Nối vào `message-turn-processor.ts` và `scheduled-job-send.ts`
- [x] `pnpm test` + `pnpm typecheck`

## Lệch so với kế hoạch (có chủ ý)

- Nối vào `run-scheduled-job.ts` chứ không `scheduled-job-send.ts`: nhánh `[SILENT]`
  nằm ở file đầu, mà làm sạch BẮT BUỘC phải chạy sau nhánh đó.
- Thêm 2 việc kế hoạch không nêu, cùng lớp vấn đề: dọn `job.payload` của job
  `kind='message'` và nội dung của tool `tag_member` - hai đường chữ của model xuống
  Zalo mà không qua bộ lọc nào.
- Bỏ DÒNG KẺ của bảng markdown (kế hoạch chỉ liệt kê 6 dạng, không có bảng) vì kịch bản
  nghiệm thu chính là "trình bày dạng bảng". Chỉ bỏ dòng kẻ, không dựng lại bảng.
- Cố ý KHÔNG bắt `__đậm__`/`_nghiêng_`: gạch dưới sống đầy trong tên file và URL thật.
- Caption của file/ảnh (`send_file`, `create_image`, `create_word_document`,
  `create_excel_file`) CHƯA nối - giá trị thấp hơn nhiều (một dòng chú thích ngắn) và
  chưa có test hạ tầng cho các tool đó.

## Tiêu chí hoàn thành

- Ép bot trả lời có markdown (hỏi "trình bày dạng bảng markdown giúp tôi"): tin xuống Zalo
  không còn `**`, `##`, `` ` ``.
- Một câu trả lời tiếng Việt bình thường đi qua **không đổi một ký tự nào** (test canh
  bằng so sánh chính xác).
- Text chứa dấu hiệu system prompt bị chặn, log có dòng ERROR, người dùng nhận câu lỗi.

## Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Bỏ nhầm dấu `-` mà persona đang dạy dùng | Bước 3 + test riêng |
| Cắt nhầm nội dung có `*` toán học | Bước 4 - yêu cầu không có khoảng trắng cạnh dấu |
| Regex ăn tham làm hỏng câu dài | Test với câu 2000 ký tự nhiều ký tự đặc biệt |
| Chặn nhầm câu trả lời hợp lệ vì trùng dấu hiệu prompt | Dấu hiệu chọn loại **rất đặc trưng** (`<noi_dung_ngoai`), không phải từ thường gặp |
| Lọc chung phá logic `[SILENT]` của scheduler | Đặt ở tầng caller, không đặt trong `sendReplyInParts` |

## An ninh

- Đây là lớp guardrail đầu ra cuối cùng - hoàn thiện mô hình phân lớp của OpenAI cho dự án.
- Chặn rò system prompt trực tiếp chống lại đường tấn công "bảo bot đọc lại chỉ dẫn của mày".
- Log text bị chặn giới hạn 200 ký tự để không đổ nguyên prompt vào file log.

## Bước kế tiếp

Sau phase 07, thêm case eval: yêu cầu bot trả lời dạng bảng markdown, khẳng định tin cuối
không còn ký tự định dạng.
