# Phase 03 - Renderer .xlsx

Liên quan: [plan.md](plan.md) · [report](reports/nghien-cuu-llm-tra-file-va-thu-vien.md) · cần [Phase 01](phase-01-schema-va-gioi-han.md)

## Tổng quan

- **Ưu tiên**: cao - báo giá/danh sách hợp Excel hơn Word
- **Trạng thái**: chưa làm
- Nhận `Sheet[]` -> trả `Buffer` .xlsx, **kèm giá trị đã tính cho mọi công thức**.

## Insight quyết định - vì sao dùng exceljs

Skill xlsx của Anthropic yêu cầu "dùng công thức thật, không hardcode kết quả" và
bắt buộc chạy `recalc.py` (LibreOffice) sau đó. Lý do: `openpyxl` ghi công thức
dạng chuỗi **không kèm kết quả**, nên mọi thứ đọc giá trị cache (`pandas`, previewer)
đều thấy `None`.

Đo thật 2 thư viện Node trên cùng bảng báo giá:

| Thư viện | XML sinh ra | Ô công thức có `<v>` |
|---|---|---|
| `write-excel-file` | `<c r="C2"><f>=A2*B2</f></c>` | 0/3 |
| `exceljs` | `<c r="D2"><f>B2*C2</f><v>3000000</v></c>` | **3/3** |

`exceljs` nhận `{ formula: "B2*C2", result: 3000000 }`. **Bot tự biết result** vì
chính nó sinh ra dữ liệu -> không cần LibreOffice, mà preview vẫn hiện số.

Bonus: `write-excel-file` ghi `<f>=A2*B2</f>` thừa dấu `=` (chuẩn ECMA-376 là không
có). Một lý do nữa để bỏ.

## API - chốt cứng

```ts
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Báo giá");
ws.addRow(["Sản phẩm", "SL", "Đơn giá (VND)", "Thành tiền (VND)"]);
ws.addRow(["Bàn phím", 2, 1500000, { formula: "B2*C2", result: 3000000 }]);
const buf = Buffer.from(await wb.xlsx.writeBuffer());
```

**Luật bất di bất dịch: mọi ô công thức PHẢI kèm `result`.** Thiếu nó là quay về
đúng vấn đề đang tránh. Test phải khoá điều này lại.

## Bot tự tính result thế nào

Schema chỉ cho model mô tả công thức **có kiểm soát**, không cho gõ chuỗi tự do:

| Loại | Model gửi | Bot sinh |
|---|---|---|
| Nhân 2 ô cùng dòng | `{ kind: "formula", op: "multiply", columns: ["B","C"] }` | `B2*C2` + result tính từ giá trị 2 ô đó |
| Tổng một cột | `{ kind: "formula", op: "sum", column: "D", fromRow, toRow }` | `SUM(D2:D9)` + result |

Bot có sẵn mọi giá trị số trong `Sheet` nên tính được. Không hỗ trợ công thức tự do:
model gõ `=SUMIFS(...)` thì bot không tính nổi result -> quay về ô trống trong preview.
Phạm vi báo giá/danh sách của bot Zalo thì 2 phép này thừa đủ.

## Quy ước định dạng (từ skill xlsx)

| Hạng mục | Chốt |
|---|---|
| Font | Arial 11 |
| Header | Đậm + nền `#F1F5F9` + freeze dòng 1 (`views: [{ state: "frozen", ySplit: 1 }]`) |
| Số thường / tiền | `numFmt = "#,##0"`, đơn vị ghi trong header ("Đơn giá (VND)") |
| Phần trăm | `0.0%`, lưu dạng phân số (0.15 = 15%) |
| Cột | Bề rộng theo nội dung dài nhất, kẹp trong [10, 40] |
| Tên sheet | Sanitize ký tự cấm `: \ / ? * [ ]`, cắt còn 31 ký tự (giới hạn Excel) |

## File liên quan

- Tạo: `src/documents/render-xlsx.ts`
- Sửa: `package.json` (thêm `exceljs`)

## Todo

- [ ] `pnpm add exceljs`
- [ ] `renderXlsx(sheets)` + map kiểu ô + tính result cho công thức
- [ ] Tính bề rộng cột, sanitize tên sheet
- [ ] Test: chuỗi tiếng Việt, **công thức CÓ result**, format số, freeze pane, nhiều sheet

## Tiêu chí hoàn thành

- Test đọc ngược: `sheet1.xml` có `<f>` **và** `<v>` trên cùng ô; `styles.xml` có
  `#,##0` và `Arial`.
- Test đọc chéo bằng chính exceljs: `cell.value.result` khác `undefined`.

## Rủi ro

- **exceljs im từ 2024-12** (hơn 1,5 năm). Rủi ro bảo trì thật, nhưng thư viện rất
  phổ biến và API dùng ở đây là phần lõi ổn định. Đổi lại là tính đúng đắn của file.
  Nếu sau này cần thay: schema trung gian ở Phase 01 khiến việc thay chỉ đụng file này.
- **21.8MB `node_modules`**: chấp nhận trên server.
- **Model gửi công thức ngoài 2 phép hỗ trợ**: schema Zod chặn từ đầu, trả thông báo
  để model chuyển sang `kind: "number"` với giá trị tính sẵn.
