# Nghiên cứu: LLM có trả file được không + chọn thư viện

Ngày đo: 2026-07-27. Mọi số liệu dưới đây là đo thật, không suy đoán.

## 1. LLM API không trả file được

Gọi thật với prompt "tạo file Word bao-gia.docx, trả về file đính kèm":

| Đường gọi | Field trong `message` | Có file? | Model nói gì |
|---|---|---|---|
| DeepSeek trực tiếp (`api.deepseek.com`) | `role`, `content` | Không | "Tôi không thể trực tiếp tạo và gửi file .docx" |
| 9Router + `cx/gpt-5.6-sol` | `role`, `content` | Không | "chưa thể tạo và đính kèm file trực tiếp" |
| 9Router + `ds/deepseek-v4-pro` | `role`, `content`, `reasoning_content` | Không | Trả về **code Python** dùng `python-docx` |

Không có field `attachments`/`files` ở cả cấp message lẫn cấp response. Chat
Completions API chỉ có kênh text - giới hạn của giao thức, không phải của model.

**Điểm mấu chốt**: `ds/deepseek-v4-pro` trả về *code tạo file* chứ không phải file.
Đó chính xác là cách IDE code hoạt động: model viết code, **IDE chạy code hộ**.

Phát hiện phụ: 9Router trả JSON dính đuôi `data: [DONE]` (script test dùng fetch
thuần chết ngay tại đó). Xác nhận fetch sanitizer trong repo vẫn đang gánh việc thật.

## 2. Vì sao file do IDE tạo lại "đẹp"

Không phải nhờ model giỏi hơn, mà nhờ **skill** - tài liệu quy ước nhét vào context:

| Repo | Đường dẫn | Ghi chú |
|---|---|---|
| Anthropic (gốc) | skill `docx`, `xlsx` | Bản chuẩn |
| GoClaw | `skills/docx`, `skills/xlsx`, `skills/pptx`, `skills/pdf` | Cùng bộ, kèm scripts Python |
| Hermes | `skills/productivity/docx`, `.../xlsx` | Ghi rõ "adapted by Nous Research" |

Ví dụ quy ước trong skill `xlsx`: chữ xanh cho input, đen cho công thức, `$#,##0`
cho tiền tệ, số 0 hiển thị `-`, âm trong ngoặc, % lưu dạng phân số, năm lưu dạng
text. Chính mấy trang quy ước đó biến "file thô" thành "tài liệu chuyên nghiệp".

## 2b. Zalo có chặn .docx/.xlsx không? KHÔNG - đã đo

Đọc source `zca-js/src/apis/uploadAttachment.ts`:

```ts
function isExtensionValid(ext: string) {
    return sharefile.restricted_ext_file.indexOf(ext) == -1;
}
if (isExtensionValid(extFile) == false)
    throw new ZaloApiError(`File extension "${extFile}" is not allowed`);
```

Điểm mấu chốt: `restricted_ext_file` là **DANH SÁCH CẤM do chính server Zalo trả về
lúc login** (nằm trong `ctx.settings.features.sharefile`), không phải whitelist cứng
trong lib. Kiểm tra chạy ở client, **trước khi chạm mạng**.

Đo thật bằng session của bot (chỉ gọi `uploadAttachment`, KHÔNG gọi `sendMessage`
nên không ai nhận được tin nào):

```
.docx: qua được cửa kiểm extension
.xlsx: qua được cửa kiểm extension
.exe : BỊ CHẶN - 'File extension "exe" is not allowed'
```

`.exe` bị chặn chứng minh cơ chế **có hoạt động** và danh sách cấm **có nội dung**;
`.docx`/`.xlsx` không dính nghĩa là chúng không nằm trong danh sách đó. Khớp với
thực tế người dùng Zalo gửi file Word/Excel cho nhau hàng ngày.

Ghi chú: lần thử upload lên thread thật bị treo ở tầng mạng (không kết luận thêm
được gì, cũng không phủ định điều trên). Kiểm tra cuối cùng vẫn nên là gửi thật 1
file qua Zalo khi nghiệm thu.

Thông số khác lấy được từ cùng chỗ: `max_file` (số file mỗi lần),
`max_size_share_file_v3` (MB) - nên đọc để giới hạn trước khi gửi thay vì để Zalo
từ chối.

## 3. Tinh túy Hermes - lấy gì, bỏ gì

| Cơ chế Hermes | Có lấy? | Lý do |
|---|---|---|
| `tools/code_execution_tool.py` (LLM viết Python, chạy qua UDS/Docker) | **KHÔNG** | Bot đọc tin người lạ; chạy code model sinh ra = RCE qua prompt injection |
| `tools/environments/` (docker, modal, daytona, ssh sandbox) | **KHÔNG** | Hạ tầng nặng, và vẫn không giải quyết được vấn đề tin từ người lạ |
| Skill = quy ước định dạng chi tiết | **CÓ** | Nhét vào renderer thay vì prompt -> chất lượng cố định |
| Verify output sau khi tạo (render PDF rồi xem) | **CÓ (bản nhẹ)** | Không có LibreOffice; thay bằng đọc ngược file trong test |
| Dùng `docx` (npm) thay vì python-docx | **CÓ** | Project là Node/TS, gọi thẳng thư viện, không cần Python |

Khác biệt threat model quyết định tất cả: IDE = người dùng tin agent, ngồi ngay đó,
duyệt từng lệnh. Bot Zalo = người lạ nhắn, không ai duyệt.

## 3b. Tinh túy GoClaw - pattern `deliver`

GoClaw không có tool tạo docx riêng (nó đi đường skill + exec như Hermes). Nhưng
`internal/tools/filesystem_write.go` có một pattern đáng lấy nguyên:

**Tool ghi file mang sẵn cờ `deliver` (mặc định `true`) - file tự động gửi cho
người dùng, không cần gọi tool gửi riêng.** Mô tả tham số của nó:

> "Deliver this file to the user as an attachment. Defaults to true. Set to false
> ONLY for intermediate/temporary files the user will never see."

Và khi `deliver=true`, thông báo trả về cho model ghi thẳng:

> "File will be automatically delivered to the user - do NOT send it again via
> message tool."

Kèm theo là `DeliveredMedia.Mark()`: đánh dấu file đã gửi để tool gửi tin phát hiện
và chặn gửi trùng (`filesystem_write.go:236, 281`). Có cả test đặc tả khoá hợp đồng
này lại (`filesystem_write_deliver_test.go`) để phase sau không phá vỡ.

**Lấy 2 điều:**

1. Tool tạo file **tự gửi luôn** - đúng thiết kế đã chốt ở Phase 04, giờ có tiền lệ
   xác nhận.
2. **Câu trả về phải dặn model đừng gửi lại.** Nếu chỉ trả "đã tạo file xong", model
   rất dễ gọi tiếp `send_file` -> người dùng nhận 2 lần. Đây là chi tiết nhỏ mà quý.

## 4. Chọn thư viện

```
npm view <pkg> version time.modified license dist.unpackedSize dependencies
```

| Gói | Version | Cập nhật | Size | Deps | Kết luận |
|---|---|---|---|---|---|
| `docx` | 9.7.1 | 2026-05-27 | 4.6MB | jszip, xml-js, nanoid, hash.js, xml (thuần JS) | **Chọn cho .docx** |
| `exceljs` | 4.4.0 | 2024-12-20 | 21.8MB | 9 deps (archiver, unzipper, saxes...) | **Chọn cho .xlsx** - lý do ở mục 5b |
| `write-excel-file` | 4.1.1 | 2026-06-08 | 1.8MB | fflate (1 dep) | Bỏ - không ghi được giá trị cache |

Cả 3 đều MIT, không native build (chạy được trên Windows không cần VS Build Tools).

## 5. Spike - đã chạy thật, kết quả

Cài vào thư mục tạm, tạo file thật trên Node 24 + ESM, rồi **đọc ngược file** để
chứng minh nội dung vào đúng chỗ:

```
DOCX: 8998 bytes | magic: PK        XLSX: 3401 bytes | magic: PK

-- DOCX --                          -- XLSX --
  tiêu đề tiếng Việt: true            chuỗi tiếng Việt: true
  nội dung bảng: true                 formula B2*C2: true
  không có bullet thô: true           SUM tổng: true
  bullet qua numbering: true          freeze pane: true
  shading CLEAR: true                 format #,##0: true
```

## 5b. Vì sao đổi từ write-excel-file sang exceljs - vấn đề GIÁ TRỊ CACHE

User hỏi đúng chỗ đau: *"đa phần người ta xem trước chứ đâu có tải về mới mở"*.

File .xlsx lưu công thức ở `<f>` và **kết quả đã tính** ở `<v>`. Excel mở lên thì
tự tính lại nên `<v>` không quan trọng; nhưng **mọi công cụ xem trước** (preview
trong Zalo, Google Drive, Outlook) chỉ đọc `<v>` - thiếu nó thì ô hiện TRỐNG.

Đo thật cùng một bảng báo giá, rồi đọc ngược `xl/worksheets/sheet1.xml`:

| Thư viện | XML sinh ra | Ô công thức có `<v>` |
|---|---|---|
| `write-excel-file` | `<c r="C2"><f>=A2*B2</f></c>` | **0/3** |
| `exceljs` | `<c r="D2"><f>B2*C2</f><v>3000000</v></c>` | **3/3** |

Kiểm chứng chéo (dùng exceljs đọc file của write-excel-file):

```
write-excel-file tạo:  C2=F[=A2*B2] cache=TRỐNG
exceljs tạo:           D2=F[B2*C2]  cache=3000000
```

Còn một lỗi nữa của `write-excel-file`: nó ghi `<f>=A2*B2</f>` - **có dấu `=`**,
trong khi chuẩn ECMA-376 quy định `<f>` chứa công thức KHÔNG có dấu `=`. Excel
thường tha thứ, nhưng đó là sai chuẩn và có thể vỡ ở parser khác.

### Kết luận: không cần LibreOffice

Skill Anthropic phải chạy `recalc.py` (LibreOffice) vì `openpyxl` không ghi được
giá trị cache. `exceljs` cho phép **truyền thẳng kết quả** (`{ formula, result }`),
mà bot thì tự biết kết quả - chính nó sinh ra dữ liệu. Nên:

- **Không cài LibreOffice** (tiết kiệm ~1GB, không phải cài trên VPS, không tốn
  1-3 giây mỗi lần gọi tiến trình con).
- Bot tự tính giá trị trong TypeScript rồi ghi cả `<f>` lẫn `<v>`.
- Đổi lại: chỉ hỗ trợ vài phép bot tính được (nhân, cộng, SUM một dải). Công thức
  phức tạp hơn (SUMIFS, INDEX/MATCH) thì hoặc bot không nhận, hoặc nhận mà chấp
  nhận ô trống trong preview. Phạm vi báo giá/danh sách của bot Zalo thì thừa đủ.

Đánh đổi khi chọn exceljs: nặng hơn (21.8MB vs 1.8MB) và im từ 2024-12. Chấp nhận
vì tính đúng đắn của file quan trọng hơn dung lượng `node_modules` trên server.

### Hai cái bẫy phát hiện được nhờ spike

**Bẫy 1 - `write-excel-file` v4 đổi API, gọi sai thì IM LẶNG không báo lỗi.**
Tài liệu v3 dùng `filePath` trong options. v4 thì hàm trả về
`{ toBuffer, toStream, toFile }` và **không ghi file nào cả** nếu truyền `filePath` -
không exception, không cảnh báo, chỉ đơn giản là không có file. Mất 3 vòng debug.

```js
// SAI (im lặng, không có file):
await writeXlsxFile(rows, { filePath: "a.xlsx" });
// SAI (chữ ký 3 tham số, vẫn im lặng):
await writeXlsxFile(rows, sheetOptions, { filePath: "a.xlsx" });
// ĐÚNG:
const out = await writeXlsxFile(rows, sheetOptions);
const buf = await out.toBuffer();   // hoặc await out.toFile(path)
```

**Bẫy 2 - `write-excel-file` ghi zip kiểu streaming.** Local file header có
`compSize = 0` (flag bit 3 bật, kích thước thật nằm ở data descriptor sau data).
Đọc entry theo local header ra **dữ liệu rỗng** - và test sẽ "pass" một cách vô
nghĩa vì không tìm thấy gì để so. Phải đọc qua **central directory** (đầu vào từ
EOCD ở cuối file). Cách này đúng cho cả `docx` (ghi size đầy đủ) lẫn `xlsx`.

Hệ quả cho Phase 05: helper đọc zip trong test **bắt buộc** đi qua central directory.

## 6. Gotcha từ skill Anthropic phải nhét vào renderer

### docx (đã kiểm chứng trong spike)

- Khổ giấy mặc định **A4**; muốn US Letter phải set `12240 x 15840` DXA (1440 = 1 inch).
- Bảng cần **dual widths**: `columnWidths` trên table VÀ `width` trên từng cell, đều
  `WidthType.DXA`. Dùng PERCENTAGE là vỡ khi mở bằng Google Docs. Tổng cột phải bằng
  bề rộng bảng.
- Shading dùng `ShadingType.CLEAR`, **không bao giờ** `SOLID` (render ra nền đen).
- Bullet: cấm chèn ký tự `•` trực tiếp, phải khai `numbering` config với
  `LevelFormat.BULLET`.
- Cấm dùng `\n` - mỗi dòng là một `Paragraph` riêng.
- `PageBreak` phải nằm trong `Paragraph`. `ImageRun` bắt buộc có `type`.
- Đừng dùng bảng làm đường kẻ ngang - dùng border dưới của paragraph.

### xlsx

- Font chuyên nghiệp (Arial), header đậm + nền nhạt, freeze dòng header.
- **Dùng formula thật, không hardcode kết quả** - sheet phải tính lại được khi sửa input.
- Format số: `#,##0` cho tiền tệ, đơn vị ghi trong header ("Đơn giá (VND)").
- Chỉ dùng hàm đời Excel-2007 (`SUM`, `SUMIFS`, `INDEX`, `MATCH`, `IFERROR`,
  `SUMPRODUCT`). **Tránh** `XLOOKUP`, `FILTER`, `UNIQUE`, `SORT`, `SEQUENCE` - đây
  là hàm mảng tràn, file ghi ra không có metadata spill nên chỉ ô góc trên trái có giá trị.
- Ghi chú nguồn/giả định ngay cạnh bảng khi có số liệu do người dùng cấp.
