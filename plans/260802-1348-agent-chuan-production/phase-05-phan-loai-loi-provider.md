# Phase 05 - Phân loại lỗi provider (khoảng cách G)

## Liên kết ngữ cảnh

- [reports/audit-agent-chuan-production.html](reports/audit-agent-chuan-production.html) mục 8/G và 6.4
- Mẫu tham chiếu: `zalo-agent-references/hermes-agent/agent/error_classifier.py` (1699 dòng - **không** chép quy mô đó)
- Code: `src/agent/agent-loop.ts` (nhánh catch), `src/agent/vision-rejection-fallback.ts`,
  `src/zalo/send-reply-in-parts.ts` (`TECHNICAL_ERROR_REPLY`)

## Tổng quan

- **Ưu tiên**: trung bình
- **Trạng thái**: chưa làm. Độc lập, trừ nhánh `context_overflow` dùng lại hàm cắt của phase 03.
- Hết quota, context tràn, sai khóa, và mạng chập đang bị xử lý **y như nhau**. Tách ra để
  mỗi loại được chữa đúng cách và người dùng nhận đúng câu.

## Nhận định then chốt

- **Hiện retry mù.** `maxRetries: 2` cho mọi thứ, cộng đúng 2 nhánh đặc thù đã có:
  completion rỗng (`isEmptyRouterCompletion`) và provider từ chối ảnh (`isImageRejectionError`).
- **Đã có sẵn một bộ phân loại**: `vision-rejection-fallback.ts` chính là bộ phân loại cho
  đúng một loại lỗi. Phase này **mở rộng họ đó**, không dựng hệ thứ hai song song.
- **Retry sai loại là có hại, không trung tính.** Sai khóa mà retry 2 lần chỉ làm chậm gấp
  ba rồi vẫn hỏng. Hết quota mà retry ngay lập tức có thể bị siết thêm.
- **Một câu lỗi cho mọi thứ là nói dối người dùng.** `TECHNICAL_ERROR_REPLY` dùng chung
  khiến "bot hết tiền" và "mạng chập" đọc y hệt nhau - người dùng không biết nên chờ hay
  báo chủ bot.
- **Router che mất hình dạng lỗi.** Đã ghi trong `CLAUDE.md`: lỗi ảnh có 2 hình dạng khác
  nhau (`400` trả `error.message`, `401` trả `error` là chuỗi). Bộ phân loại phải chịu được
  chuyện đó, không giả định một hình dạng JSON.

## Yêu cầu

- Phân được 5 loại: `rate_limit`, `context_overflow`, `auth`, `transient`, `unknown`.
- Mỗi loại có một cách xử lý và một câu trả lời cho người dùng.
- Không loại nào làm chết lượt mà không để lại log nói rõ loại.
- Module thuần, test được bằng đối tượng lỗi dựng tay.

## Kiến trúc

```
src/agent/provider-error-classifier.ts   (thuan)
  phanLoaiLoiProvider(err) -> LoaiLoi

  LoaiLoi          Cach chua                          Cau tra loi
  ---------------  ---------------------------------  ------------------------
  rate_limit       cho theo Retry-After roi thu 1 lan  "dang qua tai, thu lai sau"
  context_overflow cat nguc canh (phase 03) roi thu 1  (khong bao - chua duoc thi thoi)
  auth             KHONG retry, log ERROR              "cau hinh ket noi co van de"
  transient        de maxRetries cua SDK lo            TECHNICAL_ERROR_REPLY
  unknown          nhu transient                        TECHNICAL_ERROR_REPLY
```

## File liên quan

Tạo:
- `src/agent/provider-error-classifier.ts` (< 200 dòng)
- `src/agent/provider-error-classifier.test.ts`

Sửa:
- `src/agent/agent-loop.ts` - nhánh catch gọi bộ phân loại thay vì ném thẳng
- `src/zalo/send-reply-in-parts.ts` - thêm câu cho `rate_limit` và `auth` (giữ
  `TECHNICAL_ERROR_REPLY` làm mặc định)
- `src/zalo/message-turn-processor.ts` - `notifyTechnicalError` nhận thêm loại lỗi

## Các bước

1. Viết `phanLoaiLoiProvider(err: unknown)`. Đọc theo thứ tự chắc chắn dần:
   - `err.statusCode` / `err.status` nếu có (SDK `AI_APICallError` mang trường này)
   - rồi mới tới chuỗi thông báo
   Ánh xạ: `429` -> `rate_limit`; `401`/`403` -> `auth`; `400` + thông báo chứa
   `context`/`token`/`too long`/`maximum` -> `context_overflow`; `5xx` + lỗi mạng
   (`ECONNRESET`, `ETIMEDOUT`, `fetch failed`) -> `transient`; còn lại `unknown`.
2. **Không nuốt lỗi ảnh.** `isImageRejectionError` phải được kiểm **trước** bộ phân loại
   mới trong `agent-loop.ts`, vì lỗi ảnh cũng là `400` và sẽ bị bắt nhầm thành
   `context_overflow`. Giữ nguyên thứ tự nhánh hiện có, chèn bộ mới vào **sau**.
3. Nhánh `rate_limit`: đọc header `Retry-After` nếu SDK có phơi ra; không có thì chờ cố
   định (5 giây), thử **đúng một lần**. Không dựng backoff nhiều tầng - `agent-loop` đã có
   2 tầng chịu lỗi, thêm nữa là chồng ba (cùng lý do đã ghi trong `CLAUDE.md` cho scheduler).
4. Nhánh `context_overflow`: gọi hàm cắt của phase 03 với trần **thấp hơn** (0.5 thay vì
   0.7), dựng lại messages, thử một lần. Phase 03 chưa xong thì tạm ghi log + trả câu lỗi,
   để lại `TODO` trỏ tới phase 03.
5. Nhánh `auth`: **không** retry. Log ERROR kèm gợi ý kiểm tra trang Providers. Trả câu
   riêng để chủ bot biết đây là chuyện cấu hình, không phải trục trặc thoáng qua.
6. Ba câu trả lời mới viết bằng lời thường, không lộ chi tiết kỹ thuật ra ngoài Zalo (người
   nhắn có thể là người lạ).
7. Log ở mọi nhánh: `{ loai, statusCode, err }` - để trang Logs lọc theo loại được.
8. Test bằng lỗi dựng tay: object có `statusCode`, object chỉ có `message`, chuỗi thuần,
   `null`, `undefined`. Khẳng định không nhánh nào ném khi gặp đầu vào lạ.

## Việc cần làm

- [ ] `provider-error-classifier.ts` (thuần) + test 5 loại + 5 đầu vào lạ
- [ ] Giữ `isImageRejectionError` **trước** bộ phân loại mới
- [ ] Nhánh `rate_limit` - chờ rồi thử đúng 1 lần
- [ ] Nhánh `context_overflow` - nối vào hàm cắt phase 03 (hoặc TODO nếu chưa có)
- [ ] Nhánh `auth` - không retry, log ERROR
- [ ] 2 câu trả lời mới, không lộ chi tiết kỹ thuật
- [ ] Log kèm `loai` ở mọi nhánh
- [ ] `pnpm test` + `pnpm typecheck`

## Tiêu chí hoàn thành

- Đổi `LLM_API_KEY` thành khóa sai: bot trả câu về cấu hình, log ERROR một lần, **không**
  retry (đo bằng số dòng log).
- Lỗi mạng thoáng qua vẫn được `maxRetries` cứu như trước, hành vi không đổi.
- Lỗi ảnh vẫn đi đúng nhánh fallback cũ, không bị bắt nhầm thành `context_overflow`.

## Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Bắt nhầm lỗi ảnh thành `context_overflow` (cùng là 400) | Bước 2 - giữ `isImageRejectionError` kiểm trước; có test riêng canh thứ tự |
| Router bọc lỗi làm mất `statusCode` | Đọc statusCode trước, rơi về khớp chuỗi sau; `unknown` xử như `transient` nên hỏng an toàn |
| Câu lỗi mới lộ thông tin hệ thống ra người lạ | Câu viết bằng lời thường, chi tiết chỉ vào log |
| Chồng thêm tầng retry | Mỗi loại thử **tối đa 1 lần**, không backoff nhiều tầng |

## An ninh

- Không đưa thông báo lỗi thô của provider xuống Zalo - nó có thể chứa URL nội bộ, tên
  model, hoặc một phần prompt.
- Nhánh `auth` không được in khóa hay một phần khóa vào log.

## Bước kế tiếp

Nhánh `context_overflow` chỉ hoàn chỉnh khi phase 03 xong. Nếu làm phase này trước, quay
lại nối sau.
