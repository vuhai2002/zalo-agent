# Phase 04 - Tool cho agent + tích hợp

Liên quan: [plan.md](plan.md) · cần [Phase 02](phase-02-renderer-docx.md) + [Phase 03](phase-03-renderer-xlsx.md)

## Tổng quan

- **Ưu tiên**: cao - phần này biến renderer thành thứ người dùng chạm được
- **Trạng thái**: chưa làm

## Insight

Chốt **tool tự gửi file luôn**, không tách "tạo" rồi "gửi":

- `send_file` hiện chỉ nhận file trong `shared-files` hoặc URL - file tạm không gửi
  được qua đó, sửa nó để nhận thêm đường dẫn tạm là nới lỏng chốt chặn an toàn.
- Tách 2 bước tốn thêm 1 step agent = gửi lại toàn bộ hội thoại thêm 1 lần (bài học
  token đã ghi ở V2.5.4).
- **GoClaw đã làm đúng vậy**: `write_file` mang cờ `deliver` (mặc định true), file
  tự động gửi cho người dùng.

**Lấy nguyên chi tiết quý của GoClaw**: câu trả về cho model phải **dặn đừng gửi lại**.
GoClaw ghi: *"File will be automatically delivered to the user - do NOT send it again
via message tool"* và có `DeliveredMedia.Mark()` chống gửi trùng. Nếu chỉ trả "đã tạo
file xong", model rất dễ gọi tiếp `send_file` -> người dùng nhận 2 lần.

Tách **2 tool riêng** thay vì 1 tool có `format`: schema nội dung của docx và xlsx
khác hẳn nhau, gộp lại thì model phải đoán field nào dùng với format nào.

## Yêu cầu

**Chức năng**

- `create_word_document(fileName, title, blocks, caption?)` -> tạo, gửi, xóa file tạm.
- `create_excel_file(fileName, sheets, caption?)` -> tương tự.
- Câu trả về khi thành công phải chốt rõ: **"Đã gửi file cho người dùng rồi - KHÔNG
  gọi send_file để gửi lại."** (pattern GoClaw).
- Mọi nhánh lỗi trả **thông báo cho model đọc**, không throw ra agent loop (cùng luật
  với `web_search`, `read_image`).

**Phi chức năng**

- Nhóm `action` trong registry (có tác động ra ngoài) -> tắt được per account.
- Đi qua `enqueueSend` của rate-limiter sẵn có.

## Kiến trúc

```
src/agent/tools/create-document-tools.ts
  createWordDocumentTool(ctx)   ->  renderDocx  ->  withTempFile  ->  enqueueSend
  createExcelFileTool(ctx)      ->  renderXlsx  ->  withTempFile  ->  enqueueSend
```

Tái dùng nguyên `withTempFile` (đã tự xóa trong `finally`) và `enqueueSend`.

## Chống lạm dụng

Bot đọc tin người lạ, tạo file tốn CPU + băng thông:

| Chốt chặn | Cách làm |
|---|---|
| Kích thước nội dung | `checkWithinLimits` từ Phase 01 |
| Số file mỗi thread | Đếm trong bộ nhớ theo `accountId:threadId`, tối đa `DOCUMENT_MAX_PER_HOUR` (mặc định 10)/giờ |
| Tên file | `path.basename` + bỏ ký tự lạ + ép đuôi đúng (`.docx`/`.xlsx`) |
| Tắt được | Nhóm `action`, hiện ở trang Tools |

## File liên quan

- Tạo: `src/agent/tools/create-document-tools.ts`, `src/documents/document-rate-limit.ts`
- Sửa: `src/agent/tools/tool-registry.ts` (đăng ký 2 tool), `src/agent/persona-prompt.ts`
  (thêm 1-2 dòng dặn model khi nào nên gửi file thay vì trả lời dài trong chat)

## Todo

- [ ] 2 tool + sanitize tên file
- [ ] Giới hạn số file/giờ per thread (có dọn map khi hết cửa sổ - bài học rò rỉ Map ở V2.4)
- [ ] Đăng ký registry nhóm `action`
- [ ] Thêm env `DOCUMENT_MAX_PER_HOUR` vào 3 nơi
- [ ] Dòng hướng dẫn trong system prompt

## Tiêu chí hoàn thành

- Trang Tools hiện 2 tool mới, tắt/bật được, tool tắt thì không vào schema LLM.
- Test: tool trả thông báo (không throw) khi vượt giới hạn / tên file lạ / render lỗi.

## Rủi ro

- **Model gọi tool cho việc không cần file** (trả lời ngắn cũng xuất file). Giảm thiểu:
  mô tả tool ghi rõ "chỉ dùng khi người dùng yêu cầu file, hoặc nội dung dạng bảng dài".
- **Model gửi lại file lần nữa qua `send_file`** -> người dùng nhận 2 lần. Giảm thiểu:
  câu trả về dặn thẳng đừng gửi lại (pattern GoClaw).
- ~~Zalo chặn định dạng~~: **đã loại trừ** - đo thật thấy `.exe` bị chặn còn
  `.docx`/`.xlsx` qua được cửa kiểm `restricted_ext_file`. Vẫn nên gửi thử 1 file
  thật khi nghiệm thu.
- **Vượt giới hạn của Zalo**: `max_file` và `max_size_share_file_v3` do server quy
  định. Nên kiểm dung lượng trước khi gọi `sendMessage` để báo lỗi tử tế thay vì để
  Zalo từ chối.

## An toàn

- Không bao giờ đọc file từ đường dẫn model cấp - nội dung 100% từ tham số tool.
- File tạm nằm trong `data/tmp`, xóa ngay sau khi gửi; sweep định kỳ đã có sẵn.
