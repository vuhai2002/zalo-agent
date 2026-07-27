# Phase 02 - Renderer .docx

Liên quan: [plan.md](plan.md) · [report](reports/nghien-cuu-llm-tra-file-va-thu-vien.md) · cần [Phase 01](phase-01-schema-va-gioi-han.md)

## Tổng quan

- **Ưu tiên**: cao - đây là định dạng user hỏi đầu tiên
- **Trạng thái**: chưa làm
- Nhận `DocumentBlock[]` -> trả `Buffer` .docx. Toàn bộ quy ước định dạng nằm ở đây.

## Insight

Đây là chỗ chứa **know-how lấy từ skill Anthropic**. Điểm khác biệt so với IDE: ở
IDE model tự viết code nên chất lượng dao động theo model; ở đây renderer cố định
nên **file luôn đẹp như nhau**, kể cả khi chạy model rẻ tiền.

Các gotcha bên dưới đã **kiểm chứng chạy đúng trong spike**, không phải chép suông.

## Yêu cầu

**Chức năng**

- 4 loại block -> phần tử docx tương ứng.
- Tiếng Việt có dấu hiển thị đúng (spike đã xác nhận).
- Bảng có header đậm + nền nhạt, viền, chiều rộng chia đều theo số cột.

**Phi chức năng**

- Hàm thuần: `renderDocx(blocks, meta) => Promise<Buffer>`, không chạm đĩa (caller lo).
- File < 200 dòng; tách helper dựng bảng ra file riêng nếu chạm ngưỡng.

## Quy ước định dạng (từ skill, đã spike)

| Hạng mục | Chốt |
|---|---|
| Khổ giấy | A4 mặc định của thư viện - đúng cho VN, không đổi sang Letter |
| Bảng | `columnWidths` trên table + `width` trên MỌI cell, đều `WidthType.DXA`, tổng cột = bề rộng bảng (9360 DXA cho A4 lề 1 inch) |
| Nền ô | `ShadingType.CLEAR` - `SOLID` render ra nền đen |
| Bullet | `numbering` config + `LevelFormat.BULLET`, cấm chèn ký tự `•` |
| Xuống dòng | Mỗi dòng = 1 `Paragraph`, cấm `\n` |
| Heading | `HeadingLevel.HEADING_1/2/3` built-in (để TOC hoạt động nếu sau này cần) |
| Font | Để mặc định của thư viện (Calibri) - đã chuyên nghiệp; không ép Times New Roman |

## File liên quan

- Tạo: `src/documents/render-docx.ts`
- Sửa: `package.json` (thêm `docx`)

## Các bước

1. `pnpm add docx` (lưu ý `minimumReleaseAge` 24h của pnpm - bản 9.7.1 phát hành
   2026-05 nên không vướng).
2. Viết `renderDocx(blocks, { title })`:
   - Dựng `numbering` config một lần cho cả tài liệu.
   - Map từng block; block `table` gọi helper dựng `columnWidths` chia đều.
   - `Packer.toBuffer(doc)`.
3. Tự kiểm bằng cách đọc ngược (Phase 05 sẽ tự động hóa).

## Todo

- [ ] Thêm dependency `docx`
- [ ] `renderDocx` + helper bảng
- [ ] Test: mỗi loại block xuất hiện đúng trong `word/document.xml`
- [ ] Test hồi quy các gotcha: không có `•` thô, có `numPr`, shading là `clear`

## Tiêu chí hoàn thành

- Test đọc ngược file xác nhận: tiêu đề, đoạn văn, bullet, nội dung bảng đều có mặt.
- Mở file thật bằng Word/LibreOffice thấy đúng bố cục (kiểm tay 1 lần khi nghiệm thu).

## Rủi ro

- **Bảng nhiều cột tràn lề**: chia đều 9360 DXA cho N cột; N > 6 thì chữ bị bó.
  Giảm thiểu: cảnh báo trong mô tả tool là bảng nên <= 6 cột.
- **Thư viện đổi API** như đã dính với write-excel-file. Giảm thiểu: test đọc ngược
  file bắt được ngay nếu output rỗng.
