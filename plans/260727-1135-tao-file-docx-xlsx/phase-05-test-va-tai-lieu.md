# Phase 05 - Test đọc-ngược-file + tài liệu

Liên quan: [plan.md](plan.md) · [report](reports/nghien-cuu-llm-tra-file-va-thu-vien.md)

## Tổng quan

- **Ưu tiên**: cao - user yêu cầu rõ "test kỹ cẩn thận"
- **Trạng thái**: chưa làm
- Viết song song với từng phase, chốt lại ở cuối.

## Insight - vì sao phải đọc ngược file

Test kiểu "hàm chạy không throw" là **vô nghĩa** với tính năng này. Bằng chứng: trong
spike, `writeXlsxFile(rows, { filePath })` chạy sạch sẽ, không lỗi, và **không tạo
file nào**. Chỉ khi mở file ra đọc mới phát hiện.

Skill Anthropic giải bằng cách render PDF rồi nhìn ảnh. Bot không có LibreOffice nên
thay bằng: **giải nén file, đọc XML bên trong, khẳng định nội dung có mặt**.

## Bẫy kỹ thuật đã phát hiện

Có thư viện ghi zip kiểu **streaming**: local file header để `compSize = 0` (flag bit
3 bật, kích thước thật nằm ở data descriptor SAU dữ liệu). Đọc entry theo local header
ra **dữ liệu rỗng** - và test sẽ xanh một cách vô nghĩa vì không có gì để so.

**Bắt buộc đọc qua central directory** (đi từ EOCD ở cuối file). Cách này đúng cho mọi
file OOXML, không phụ thuộc thư viện nào sinh ra nó.

## Test riêng cho giá trị cache (quan trọng nhất của xlsx)

Toàn bộ lý do chọn `exceljs` là để công thức có `<v>`. Phải có test khoá lại:

```
mọi ô công thức trong sheet1.xml đều khớp <f>...</f><v>...</v>
```

Thiếu test này thì một ngày nào đó ai đó bỏ `result` khi thêm loại công thức mới, và
không ai phát hiện cho tới khi người dùng phàn nàn "mở xem trước thấy ô trống".

## Kiến trúc

```
src/shared/read-zip-entry.ts        <- đọc entry OOXML qua central directory (node:zlib, 0 dep)
src/documents/render-docx.test.ts
src/documents/render-xlsx.test.ts
src/documents/document-limits.test.ts
src/agent/tools/create-document-tools.test.ts
```

`read-zip-entry.ts` đặt ở `shared/` chứ không phải trong test: nó là utility thật,
và sau này nếu cần đọc file người dùng gửi thì dùng lại được.

## Bộ test

**render-docx**

- Mỗi loại block xuất hiện đúng trong `word/document.xml`.
- Tiếng Việt có dấu round-trip nguyên vẹn.
- Hồi quy gotcha: không có `•` thô trong `<w:t>`, có `numPr`, shading `clear` (không `solid`).
- Bảng: số ô đúng, header đậm.

**render-xlsx**

- Chuỗi tiếng Việt có trong `sharedStrings.xml` hoặc `sheet1.xml`.
- **Mọi ô công thức có `<f>` KÈM `<v>`** - test quan trọng nhất, xem mục trên.
- Giá trị trong `<v>` đúng bằng kết quả phép tính (nhân đúng tích, SUM đúng tổng).
- `styles.xml` có `#,##0` và `Arial`; `sheet1.xml` có `pane` (freeze).
- Tên sheet có ký tự cấm -> bị sanitize, file vẫn hợp lệ.
- Nhiều sheet -> đủ số worksheet trong file.

**limits + tool**

- Vượt từng giới hạn -> thông báo riêng biệt.
- Tên file lạ (`../../etc/passwd`, `a.exe`) -> ép về tên an toàn đúng đuôi.
- Quá số file/giờ -> thông báo, không throw.
- Tool trả thông báo khi renderer ném lỗi.

## Kiểm bằng tay khi nghiệm thu (không tự động được)

- [ ] Mở `.docx` bằng Word thật: bố cục, bảng, bullet đúng.
- [ ] Mở `.xlsx` bằng Excel thật: công thức tính ra số đúng.
- [ ] **Gửi thử qua Zalo**: xác nhận Zalo không chặn 2 định dạng này.

## Tài liệu phải cập nhật

- `docs/system-architecture.md`: thêm dòng quyết định - vì sao không exec, vì sao
  schema trung gian, đánh đổi công thức không có giá trị cache.
- `docs/project-roadmap.md`: mốc mới + mục "chưa test Zalo thật".
- `README.md`: 1 dòng nhắc bot xuất được file.
- `CLAUDE.md`: thêm 2 dependency vào phần quyết định đã chốt (`docx` + `exceljs`),
  kèm lý do bỏ `write-excel-file` để phiên sau không "tối ưu" ngược lại.

## Tiêu chí hoàn thành

- `pnpm test` xanh, `pnpm typecheck` sạch.
- Mọi file mới < 200 dòng.
- 3 mục kiểm tay ở trên đã làm.
