# Nghiên cứu: thay bộ đọc docx/xlsx viết bằng regex

Ngày: 2026-08-09. Phạm vi: chọn hướng kỹ thuật, KHÔNG sửa file nào trong repo.
Đối tượng: `src/knowledge/extract-docx-text.ts`, `src/knowledge/extract-xlsx-text.ts`,
`src/shared/read-zip-entry.ts`.

Mọi con số trong báo cáo đều **đo thật** trên máy này (Node v24.11.1, Windows 11)
trừ chỗ ghi rõ `[ước lượng]`. Script đo nằm trong scratchpad phiên làm việc.

---

## 0. Khuyến nghị (đọc phần này là đủ để quyết)

**Đi hướng (b): dùng một thư viện SAX + tự viết phần ngữ nghĩa OOXML trong repo.**
Cụ thể: `saxes` (hoặc `sax`), giải nén **theo luồng** rồi nạp chunk vào parser,
không bao giờ dựng cả chuỗi XML trong bộ nhớ.

Lý do một câu: SAX là thứ duy nhất trong 3 hướng vừa **tuyến tính trước input đối
kháng**, vừa **đọc đúng cả 5 ca đã hỏng**, vừa **giảm bộ nhớ đỉnh** - còn hướng (a)
tự viết thì sai 5/5 ca biên đã đo, hướng (c) thư viện đọc sẵn thì `exceljs` ngốn
949 MB cho một file 8,46 MB và `mammoth` treo event loop hơn 200 giây trước một
file 1,7 KB.

Ba con số quyết định:

| | file 1,7 KB (bom nén) | file .xlsx 8,46 MB thật |
|---|---|---|
| Cách HIỆN TẠI (regex) | **38,09 giây** khoá event loop, 0 tick | 367 MB RSS, 0,9 giây |
| `mammoth` (hướng c) | **> 200 giây**, watchdog không kịp chạy | - |
| `exceljs` (hướng c) | - | **949 MB RSS**, 7,3 giây |
| ĐỀ XUẤT (luồng + saxes + trần) | **7 mili-giây**, từ chối sạch | **237 MB RSS**, 1,8 giây |

Dependency thêm: **1 gói trực tiếp + 1 gói bắc cầu**.
- `saxes@6.0.0` - ISC, xuất bản 2021-11-07 (qua xa ngưỡng `minimumReleaseAge`),
  164 KB, **1 dependency runtime** (`xmlchars@2.2.0`, MIT, 0 dependency),
  không native binding, types TypeScript có sẵn trong gói.
- Phương án thay thế ngang giá: `sax@1.6.1` - BlueOak-1.0.0, xuất bản 2026-07-24,
  62 KB, **0 dependency runtime**, nhưng phải thêm devDependency `@types/sax`.

Trần bộ nhớ đề xuất: **tổng cả archive 64 MB, mỗi entry 32 MB, tỉ lệ nén tối đa
500:1 (miễn kiểm dưới 1 MB), tối đa 256 entry, bắt buộc đọc theo luồng**.
Trần 300 MB/entry hiện tại cao gấp **42 lần** entry lớn nhất từng đo trong file
thật, và một mình nó đã vượt ngân sách RAM của container.

Fixture: **tự tạo bằng Word/Excel có sẵn trên máy dev** (`C:\Program Files\Microsoft
Office\root\Office16\`, Office 365 build 16.0.20228.20158, COM late-binding đã chạy
được headless). docx 13,4 KB + xlsx 9,0 KB, không nghĩa vụ giấy phép nào, nội dung
tiếng Việt đúng ngữ cảnh dự án. Đã dùng chính đường này để tạo 6 file chứng minh
các lỗi bên dưới.

---

## 1. Ba lỗi đã đo - tái hiện lại và xác nhận trên FILE WORD/EXCEL THẬT

Phần này quan trọng hơn phần so sánh thư viện: nó cho thấy lỗi không phải giả
thuyết, và cho thấy **bộ test hiện tại không thể bắt được chúng** vì nó chỉ nạp
file do chính repo sinh ra.

### 1.1 ReDoS bậc hai - xác nhận, và tệ hơn mô tả

`PARAGRAPH_RE = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g` với input có nhiều `<w:p>` mà
không có `</w:p>`: mỗi vị trí bắt đầu phải quét tới hết chuỗi rồi thất bại.

Đo đường cong (chỉ riêng regex, chưa tính giải nén):

| cỡ XML | giây | so với mốc trước |
|---|---|---|
| 32 KB | 0,035 | - |
| 64 KB | 0,143 | x4,1 |
| 128 KB | 0,551 | x3,9 |
| 256 KB | 2,200 | x4,0 |
| 512 KB | 32,250 | x14,7 (thêm áp lực GC) |

Gấp đôi input thì gấp **bốn** thời gian: đúng O(n^2).

Hai regex còn lại cùng bệnh: `RUN_TEXT_RE` 5,66 giây ở 256 KB;
`CELL_RE` (xlsx) 3,09 giây ở 256 KB.

**Đo đầu-cuối trên file .docx thật sự dựng được:**

```
bom-1mb.docx   : 1,7 KB trên đĩa -> 1 MB XML   (tỉ lệ 596:1)
bom-100mb.docx : 149,4 KB trên đĩa -> 100 MB XML (tỉ lệ 685:1)
```

Kết quả trên `bom-1mb.docx` (1,7 KB - lọt mọi trần dung lượng upload):

```
CÁCH HIỆN TẠI : 38,09 giây | setInterval(10ms) chạy 0 lần (đáng lẽ ~3809 lần)
ĐỀ XUẤT       : 0,007 giây | từ chối "XML lồng quá sâu" | RSS không tăng
```

`tick = 0` là bằng chứng trực tiếp: **event loop bị khoá hoàn toàn 38 giây**.
Trong 38 giây đó bot không nhận được tin Zalo nào, không gửi được tin nào, không
chạy được tick scheduler nào, trên **mọi** tài khoản - vì tất cả dùng chung một
process một luồng. `kb-ingest-worker.ts:62-99` gọi extractor đồng bộ ngay trong
vòng đó, chỉ nhả event loop **giữa các nguồn**, không nhả giữa chừng một nguồn.

Con số 38 giây thấp hơn 78 giây mà bản rà soát ghi - khác máy, khác nội dung
đệm. Kết luận không đổi.

Ngoại suy trên trần thật: entry được phép giải nén tới 300 MB. Từ mốc 256 KB =
2,2 giây, quadratic cho ra `(300 MB / 256 KB)^2 x 2,2` = khoảng **37 ngày** cho
một file mà attacker chỉ cần upload vài trăm KB. Đây là ngoại suy, không đo.

### 1.2 `RUN_TEXT_RE` thiếu `\b` - XÁC NHẬN TRÊN FILE WORD THẬT

Đã tạo `word-tabstop.docx` bằng **Microsoft Word thật** (COM, Office 365
16.0.20228.20158): một đoạn văn có 2 tab stop và 2 ký tự tab - đúng thứ nằm
trong hầu hết tài liệu sinh từ template.

XML Word ghi ra:

```xml
<w:body><w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="2880"/><w:tab w:val="left" w:pos="5760"/></w:tabs></w:pPr><w:r><w:t>Ca phe</w:t></w:r><w:r><w:tab/><w:t>Gia 25000</w:t></w:r><w:r><w:tab/><w:t>Bao hanh 12 thang</w:t></w:r></w:p>
```

Chạy **chính `docChuTuFile` của repo** trên file đó:

```
"<w:tab w:val=\"left\" w:pos=\"2880\"/><w:tab w:val=\"left\" w:pos=\"5760\"/></w:tabs></w:pPr><w:r><w:t>Ca phe<w:t>Gia 25000<w:t>Bao hanh 12 thang"
```

XML thô đi thẳng vào chỉ mục và vào prompt của model. Không phải suy đoán, không
phải fixture tự chế: đây là output của repo trước một file Word bình thường.

Cơ chế: `<w:t[^>]*>` khớp cả `<w:tabs>` (`<w:t` + `abs` + `>`), `<w:tab .../>`,
`<w:tblPr>`, `<w:tc>`, `<w:tcPr>`, `<w:top/>`. Thiếu đúng một `\b`.

Ghi chú quan trọng cho lúc sửa: **thêm `\b` KHÔNG đủ**. `<w:tab/>` nằm trong
`<w:pPr><w:tabs>` là *định nghĩa điểm dừng tab*, không phải ký tự tab; còn
`<w:tab/>` nằm trong `<w:r>` mới là ký tự tab thật. Đo được: một bộ đọc SAX ngây
thơ (bắt mọi `w:tab`) vẫn ra `"\tXin chao"` thay vì `"Xin chao"`. Phải **bỏ qua
cả cây con** của `w:pPr`/`w:rPr`/`w:tblPr`/`w:tcPr`/`w:trPr`/`w:sectPr`.

### 1.3 `CELL_RE` tham lam - XÁC NHẬN TRÊN FILE EXCEL THẬT

Đã tạo `excel-o-rong-co-dinh-dang.xlsx` bằng **Microsoft Excel thật**: bảng
`Mon | (trống, tô nền) | Gia`, ô B tô màu nhưng không có giá trị.

XML Excel ghi ra - đúng dạng tự đóng mà bản rà soát dự đoán:

```xml
<sheetData>
 <row r="1" spans="1:3"><c r="A1" t="s"><v>0</v></c><c r="B1" s="1"/><c r="C1" t="s"><v>1</v></c></row>
 <row r="2" spans="1:3"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"/><c r="C2"><v>25000</v></c></row>
</sheetData>
```

Chạy **chính `docChuTuFile` của repo**:

```
thật ra  : "Mon | 1\nCa phe | 25000"
đáng lẽ  : "Mon |  | Gia\nCa phe |  | 25000"
```

Hai thiệt hại cùng lúc, đúng như mô tả:
1. **Mất hẳn cột "Gia"** - `[^>]*` nuốt dấu `/` của `<c r="B1" s="1"/>` nên nhánh
   tự-đóng trượt, `[\s\S]*?</c>` ăn luôn ô C1 kế tiếp.
2. **Lộ index sharedString thành số trần**: ô ghép có `attrs = ' r="B1" s="1"/'`
   nên không thấy `t="s"`, đọc `<v>1</v>` của ô C1 và trả về `"1"` - trong khi
   `1` là *chỉ số* trỏ tới chuỗi `"Gia"`. Bảng giá vào chỉ mục thành số vô nghĩa.

Xác nhận thêm bằng ca tách rời: hàng `<c r="A1" t="s"><v>0</v></c><c r="B1" s="2"/><c r="C1" t="s"><v>1</v></c>`
-> regex bắt được **2 ô thay vì 3**.

### 1.4 Hai lỗi PHÁT SINH THÊM, chưa nằm trong bản rà soát

Đo trên `word-table.docx` (bảng 2x2 do Word thật ghi):

**(a) Bảng mất cấu trúc hàng.** Repo trả về `"chữ có khoảng trắng đầu dòng\n\nTên\n\nSố"`
- mỗi ô thành một đoạn riêng, quan hệ cùng hàng biến mất. Trớ trêu là
`extract-xlsx-text.ts` đã ghi rõ trong comment rằng "cắt theo HÀNG, không theo ô"
vì "một hàng là một bản ghi có nghĩa" - nhưng `extract-docx-text.ts` lại làm đúng
điều nó tránh. Bảng giá trong file Word bị băm thành từng ô rời.

**(b) `<w:p/>` tự đóng.** Word ghi thật:
`<w:tc><w:tcPr>...</w:tcPr><w:p/></w:tc>` và `<w:p/>` ở cuối body.
`PARAGRAPH_RE` coi `<w:p/>` là thẻ MỞ (vì `[^>]*` nuốt dấu `/`), rồi quét tới
`</w:p>` kế tiếp - nếu phía sau còn đoạn văn thật thì ranh giới đoạn bị gộp sai.
Trong file đo được thì vô hại vì không còn `</w:p>` phía sau, nhưng đây là bom
hẹn giờ cho tài liệu có ô bảng rỗng nằm giữa.

### 1.5 Vì sao test hiện tại không bắt được

`extract-docx-text.test.ts` và `extract-xlsx-text.test.ts` chỉ nạp file do
`renderDocx`/`renderXlsx` của **chính repo** sinh ra. Bộ sinh đó không bao giờ
ghi tab stop, không ghi ô rỗng tự đóng, không ghi `<w:p/>`, không ghi bảng Word.
Test round-trip qua chính mình nên xanh vĩnh viễn. Đây là gốc chung của cả 5 lỗi.

---

## 2. Câu hỏi 1 - nên đi hướng nào

### 2.1 Hướng (a): tự viết bộ quét tuyến tính bằng `indexOf`/`slice`

Chống ReDoS: **có** - đo được 601 MB/s trên input đối kháng, 130 MB/s trên XML
thật, không có backtracking.

Nhưng đọc đúng thì **không**. Đã viết thử một bộ quét tuyến tính "ngay thơ"
(cùng kiểu tư duy với code hiện tại, chỉ đổi regex thành `indexOf`) và cho chạy
5 ca biên:

| ca kiểm | quét tuyến tính tự viết | saxes |
|---|---|---|
| dấu `>` nằm TRONG giá trị thuộc tính | `"b\">Gia dung"` SAI | `"Gia dung"` OK |
| chữ nằm trong `<!-- comment -->` | `"BI MAT DA XOAChu that"` SAI | `"Chu that"` OK |
| CDATA | `"<![CDATA[a < b & c]]>"` SAI | `"a < b & c"` OK (cần bắt sự kiện `cdata` riêng) |
| thực thể `&amp;` `&lt;` | `"Cong ty A &amp; B &lt;VN&gt;"` SAI | `"Cong ty A & B <VN>"` OK |
| prefix khác `w:` | `""` SAI (mất sạch) | `"Chu can lay"` OK |

**Sai 5/5.** Ca comment đặc biệt khó chịu về mặt bảo mật: chữ trong comment XML
là chữ đã bị xóa khỏi tài liệu, trích ra là đưa nội dung không nhìn thấy vào chỉ
mục rồi vào prompt.

Muốn quét tuyến tính mà ĐÚNG thì phải tự xử lý: trạng thái trong/ngoài giá trị
thuộc tính, comment, CDATA, processing instruction, DTD, giải mã thực thể, ánh
xạ namespace. Đó chính là viết lại một XML parser - đúng thứ đã đẻ ra 5 lỗi hiện
tại. Trái nguyên tắc "đứng trên vai người khổng lồ" của dự án.

**Kết luận: loại.** Giữ `indexOf` cho phần *đọc zip* (đã tự viết, đơn giản, đúng)
nhưng không dùng cho phần *đọc XML*.

### 2.2 Hướng (b): thư viện SAX/streaming - đo 6 ứng viên

Đo trên 2 input 1 MB: XML docx bình thường, và XML đối kháng (`<w:p>` lặp, không
đóng).

| gói | XML thật 1 MB | đối kháng 1 MB | tăng trưởng đối kháng | kết luận |
|---|---|---|---|---|
| `saxes` | **50-77 ms** | 1572 ms | **tuyến tính** (87/165/335/672 ms ở 64/128/256/512 KB) | ĐẠT |
| `sax` | 124-222 ms | 75 ms | **tuyến tính** (10/20/22/35 ms) | ĐẠT |
| `htmlparser2` | 78 ms | **11 068 ms** | **BẬC HAI** (17/55/215/1027 ms - gấp 4 mỗi lần gấp đôi) | **LOẠI** |
| `fast-xml-parser` | 469 ms | ném "Maximum nested tags exceeded" | có trần độ sâu sẵn | loại (chậm + dựng cả cây DOM) |
| `txml` | 89 ms | ném "Maximum call stack size exceeded" | đệ quy, tràn stack | loại (dựng cả cây, vỡ stack) |
| bộ quét tự viết | 8 ms | 1,7 ms | tuyến tính | loại vì SAI (mục 2.1) |

`htmlparser2` bị loại thẳng: nó **bậc hai theo độ sâu lồng thẻ**, tức là đổi một
lỗ DoS lấy một lỗ DoS khác. Đây là kết quả bất ngờ nhất của cả nghiên cứu và là
lý do phải đo thay vì tin danh tiếng gói.

**Kiểm an toàn XML (quan trọng không kém tốc độ):**

| gói | Billion laughs (bom thực thể) | XXE (đọc `file:///C:/Windows/win.ini`) |
|---|---|---|
| `saxes` | ném "undefined entity" - KHÔNG bung | ném "undefined entity" - KHÔNG đọc file |
| `sax` | ném "Invalid character entity" - KHÔNG bung | ném lỗi - KHÔNG đọc file |
| `htmlparser2` | không bung (nhưng nhả rác `]>&x;`) | không đọc file |
| `fast-xml-parser` | không bung | ném "External entities are not supported" |

Cả 4 đều an toàn trước XXE/entity bomb. `saxes` và `sax` an toàn theo cách sạch
nhất: từ chối thực thể không khai sẵn thay vì im lặng nhả rác.

**Chốt giữa `saxes` và `sax`:**

| | `saxes@6.0.0` | `sax@1.6.1` |
|---|---|---|
| giấy phép | ISC | BlueOak-1.0.0 |
| xuất bản gần nhất | 2021-11-07 (4,7 năm) | **2026-07-24** |
| qua ngưỡng `minimumReleaseAge: 1440` | có | có |
| dependency runtime | **1** (`xmlchars@2.2.0`, MIT, 0 dep) | **0** |
| kích thước giải nén | 164 KB | 62 KB |
| native binding | không | không |
| types TypeScript | **có sẵn trong gói** | phải thêm `@types/sax` (devDep) |
| namespace (`xmlns: true`) | có - đã đo đúng cả 3 dạng prefix | có - đã đo đúng cả 3 dạng prefix |
| tốc độ XML thật | **20,0 MB/s** | 8,1 MB/s |
| chặn độ sâu ở 4 MB đối kháng | 2,1 ms | 1,7 ms |
| đã có trong cây phụ thuộc | **có** - `exceljs` kéo `saxes@5.0.1` | không |
| `npm audit` | 0 lỗ hổng | 0 lỗ hổng |

Cả hai đều dùng được và cho **kết quả giống hệt nhau** trên mọi ca đã kiểm.

- Chọn `saxes` nếu ưu tiên: types có sẵn (repo TypeScript strict), nhanh hơn 2,5
  lần, đã nằm sẵn trong cây phụ thuộc, XML là bài toán đã đóng nên "4 năm không
  release" phần nhiều là ổn định chứ không phải bỏ hoang.
- Chọn `sax` nếu ưu tiên: 0 dependency runtime và tác giả còn xuất bản đều
  (2026-07-24). Đổi lại là thêm `@types/sax` từ DefinitelyTyped.

Nghiêng về **`saxes`**, nhưng đây là chỗ đáng để người quyết cân lại theo khẩu vị
chuỗi cung ứng - không có đáp án sai.

### 2.3 Hướng (c): thư viện đọc docx/xlsx có sẵn

**`exceljs` - ĐÃ CÓ trong `package.json`, nhưng KHÔNG dùng để đọc được.**

Đo thật trên file `.xlsx` 8,46 MB (300 000 hàng x 5 cột - một bảng giá lớn nhưng
hoàn toàn hợp lệ; giải nén ra 86 MB XML, tỉ lệ 10,2:1):

| cách | RSS | thời gian |
|---|---|---|
| `wb.xlsx.readFile()` (nạp cả workbook) | **949 MB** ngay sau `readFile`, chưa duyệt ô nào; 1253 MB sau khi duyệt | 7,3 giây |
| `ExcelJS.stream.xlsx.WorkbookReader` | 388 MB | 5,1 giây |
| bộ đọc regex hiện tại | 367 MB | 0,9 giây |
| **đề xuất (luồng + saxes)** | **237 MB** | **1,8 giây** |

949 MB cho một file 8,46 MB, trong container **768 MB**. Nghĩa là `exceljs` đường
đọc **OOM ngay ở dưới nửa trần `KB_MAX_FILE_MB` mặc định (20 MB)**. Suy tuyến
tính, file 20 MB cần khoảng 2,2 GB `[ước lượng]`.

`ExcelJS.stream.xlsx.WorkbookReader` khá hơn nhưng vẫn 388 MB và chậm gấp 2,8
lần đề xuất; nó cũng chỉ đọc `.xlsx`, không giải quyết `.docx`.

**`docx` (dolanmiu) - ĐÃ CÓ, nhưng chỉ ghi.** Kiểm `dist/index.d.ts`: không có
export nào tên `read`/`parse`/`load`/`import`/`extract`. Đây là thư viện dựng
tài liệu, không có đường đọc.

**`mammoth@1.12.0` - LOẠI, tệ hơn cả regex hiện tại.**
Đo trên `bom-1mb.docx` (1,7 KB): chạy **quá 200 giây** rồi bị cắt ngang. Đáng chú
ý: `setTimeout` watchdog đặt ở 180 giây **không kịp chạy**, vì mammoth khoá event
loop hoàn toàn. Nó dùng `@xmldom/xmldom` - dựng cả cây DOM, nên vừa chậm vừa tốn
bộ nhớ theo cỡ XML. 10 dependency runtime (kéo cả `jszip`, `bluebird`,
`underscore`), 2,17 MB.

**`officeparser@7.5.1` - LOẠI vì cỡ.** 12,38 MB giải nén, kéo `pdfjs-dist` và
`tesseract.js` (OCR). Dự án đã có `unpdf` cho PDF; nhận thêm một bộ OCR và một
bộ PDF thứ hai để đọc docx là trái YAGNI hoàn toàn.

**`xlsx` / SheetJS - LOẠI.** Bản trên npm registry chính đứng yên ở `0.18.5`
xuất bản **2022-03-24**: SheetJS đã rời npm, bản mới chỉ phát ở CDN riêng
(`cdn.sheetjs.com`), tức nằm ngoài mọi cơ chế `minimumReleaseAge`/audit của pnpm.
7,5 MB, 7 dependency. Bản mirror `@e965/xlsx@0.20.3` có 0 dependency và
Apache-2.0 nhưng là mirror bên thứ ba - thêm một mắt xích tin cậy không cần
thiết. Gói `node-xlsx` còn tệ hơn: nó khai dependency trỏ thẳng URL
`https://cdn.sheetjs.com/xlsx-0.20.2/xlsx-0.20.2.tgz`, tức lockfile không bảo vệ
được gì.

**Các gói zip (`node-stream-zip`, `yauzl`, `unzipper`, `fflate`, `jszip`).**
Không cần: `read-zip-entry.ts` tự viết đã đúng và đã xử lý được cả bẫy khó nhất
(central directory so với local header, cờ streaming bit 3) - đã xác nhận nó đọc
đúng cả 3 file Office thật. Chỉ cần **bổ sung đường đọc theo luồng** cho nó
(`zlib.createInflateRaw()`), không cần đổi thư viện. Nếu sau này muốn đổi thì
`fflate` (MIT, 0 dependency) là ứng viên duy nhất thật sự stream được; `unzipper`
kéo 5 dependency kể cả `bluebird` và `fs-extra`.

### 2.4 Bảng tổng kết hướng đi

| hướng | chống ReDoS | đọc đúng 5 ca | dep thêm | native | bảo trì | quyết |
|---|---|---|---|---|---|---|
| (a) tự viết quét tuyến tính | có | **KHÔNG (0/5)** | 0 | không | tự gánh | loại |
| (b) `saxes` + ngữ nghĩa tự viết | **có** | **có (5/5)** | 1 + 1 bắc cầu | không | ISC, ổn định | **CHỌN** |
| (b') `sax` + ngữ nghĩa tự viết | có | có | 1, 0 bắc cầu | không | còn xuất bản | thay thế ngang |
| (b'') `htmlparser2` | **KHÔNG (bậc hai)** | có | 4 | không | tốt | loại |
| (c) `exceljs` đọc | có | phần lớn | 0 (đã có) | không | 2023 | **loại - 949 MB** |
| (c) `mammoth` | **KHÔNG (>200s)** | tốt | 10 | không | tốt | loại |
| (c) `officeparser` | không rõ | tốt | 5 (12,4 MB) | không | tốt | loại - quá to |
| (c) `xlsx`/SheetJS | - | tốt | 7 | không | **rời npm 2022** | loại |

---

## 3. Câu hỏi 2 - XML thật của Word/Excel trông thế nào

Phần này liệt kê các ca một bộ đọc đúng chuẩn phải xử lý. Mẫu XML đánh dấu
"(đo thật)" là trích nguyên văn từ file do Word/Excel trên máy này ghi ra.

### 3.1 WordprocessingML

**1. `<w:t>` và `xml:space="preserve"`** (đo thật, `word-table.docx`):

```xml
<w:p><w:r><w:t xml:space="preserve"> chữ có khoảng trắng đầu dòng </w:t></w:r></w:p>
```

Word chỉ ghi thuộc tính này khi chuỗi có khoảng trắng ở **đầu hoặc cuối**; khoảng
trắng kép ở giữa thì không cần (đo thật: `<w:t>Đoạn văn có  khoảng trắng kép...</w:t>`
giữ nguyên 2 dấu cách mà không có `xml:space`). Theo XML 1.0, không có
`xml:space="preserve"` thì bộ xử lý được phép chuẩn hoá khoảng trắng - nên bộ đọc
phải giữ nguyên nội dung `<w:t>` và chỉ trim ở mức ĐOẠN, không trim ở mức run
(trim từng run sẽ dính hai từ vào nhau).

*Hiện trạng repo: đúng (gộp run rồi mới `.trim()` cả đoạn).*

**2. Phần tử trong dòng** (đo thật, `word-tabstop.docx`):

```xml
<w:r><w:tab/><w:t>Gia 25000</w:t></w:r>
```

| phần tử | nên trích ra |
|---|---|
| `<w:tab/>` **trong `<w:r>`** | ký tự tab `\t` |
| `<w:tab/>` **trong `<w:pPr><w:tabs>`** | **KHÔNG GÌ CẢ** - đó là định nghĩa điểm dừng |
| `<w:br/>` | xuống dòng `\n` (thuộc tính `w:type` = page/column/textWrapping) |
| `<w:cr/>` | xuống dòng `\n` |
| `<w:noBreakHyphen/>` | `-` |
| `<w:softHyphen/>` | không gì (hoặc chuỗi rỗng) |
| `<w:sym>` | ký tự theo `w:char`, thường bỏ qua được |

*Hiện trạng repo: SAI - `<w:tab/>` và `<w:tabs>` bị `RUN_TEXT_RE` khớp nhầm rồi
nhả XML thô (mục 1.2). Không phân biệt được tab trong `w:r` với tab trong `w:pPr`.*

**3. Phần tử KHÔNG được trích dù chứa chữ:**

- `<w:delText>` - chữ **đã bị xóa** trong track changes. Trích nhầm là đưa nội
  dung người viết đã cố ý xóa vào chỉ mục rồi vào prompt của model. Khác `<w:t>`
  ở đúng tên thẻ, cùng cấu trúc.
- `<w:instrText>` - mã field, ví dụ ` HYPERLINK "http://..." `. Trích nhầm là đưa
  URL và cú pháp field vào chỉ mục.
- `<w:proofErr>`, nội dung trong `<w:rPr>`/`<w:pPr>` - thuộc tính, không phải chữ.

Đã kiểm bộ đọc SAX đề xuất: bỏ qua đúng cả hai, giữ lại `<w:ins>` (chữ được
chèn, là nội dung hiện hành nên PHẢI trích):

```
<w:del><w:delText>Gia cu 999k</w:delText></w:del><w:ins><w:t>Gia moi 1200k</w:t></w:ins>
  -> "Gia moi 1200k"   OK
<w:instrText> HYPERLINK "http://evil.example/x" </w:instrText><w:t>Bam vao day</w:t>
  -> "Bam vao day"     OK
```

*Hiện trạng repo: `<w:delText>` và `<w:instrText>` KHÔNG bị lọc - `RUN_TEXT_RE`
khớp `<w:t` nên `<w:delText>` không khớp (may mắn: `<w:d` khác `<w:t`), nhưng
`<w:instrText>` cũng không khớp. Tức là repo tình cờ đúng ở hai ca này, không
phải do thiết kế. Khi sửa sang SAX phải chủ động loại chúng.*

**4. Đoạn rỗng `<w:p/>`** (đo thật, `word-table.docx`): Word **có** ghi dạng tự
đóng, cả trong ô bảng rỗng lẫn ở cuối body:

```xml
<w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr><w:p/></w:tc>
...
</w:tbl><w:p/>
```

*Hiện trạng repo: SAI - `PARAGRAPH_RE` coi `<w:p/>` là thẻ mở (mục 1.4b).*

**5. Bảng `<w:tbl>`/`<w:tr>`/`<w:tc>`** (đo thật): mỗi `<w:tc>` chứa ít nhất một
`<w:p>`. Hệ quả: bộ đọc "mỗi `<w:p>` là một dòng" biến bảng thành mỗi ô một
dòng, mất quan hệ hàng.

Cách trích có nghĩa: gom các `<w:p>` trong cùng `<w:tc>` thành một ô, nối ô cùng
`<w:tr>` bằng dấu phân cách (` | `), mỗi `<w:tr>` là một dòng - **giống hệt luật
mà `extract-xlsx-text.ts` đã chọn cho Excel**. Ô gộp `<w:gridSpan>` (gộp ngang)
và `<w:vMerge>` (gộp dọc) có thể bỏ qua ở bản đầu; ảnh hưởng là lệch cột ở bảng
có ô gộp, chấp nhận được cho mục đích tìm kiếm.

*Hiện trạng repo: SAI (mục 1.4a).*

**6. Nhận diện heading không phụ thuộc ngôn ngữ.** Word bản tiếng Anh ghi
(đo thật, `word-rich-1.docx`):

```xml
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Báo cáo doanh thu</w:t></w:r></w:p>
```

`w:val="Heading1"` (không dấu cách) là **styleId**, và styleId do bản địa hoá của
Word quyết định - bản tiếng Pháp/Đức/Bồ ghi `Titre1`, `berschrift1`, `Ttulo1`...
Bắt cứng chuỗi `Heading([1-9])` chỉ đúng với Word tiếng Anh.

Cơ sở của cách làm đúng: Word giữ **hai** tên cho mỗi built-in style - tên chuẩn
(luôn tiếng Anh, ghi vào `<w:name>`) và tên bản địa hoá (chỉ để hiển thị).
Tài liệu Word VBA `Style.NameLocal` nói thẳng: *"Returns the name of a built-in
style **in the language of the user**"*, và ví dụ trên chính trang đó tra style
bằng tên tiếng Anh `ActiveDocument.Styles("Heading 1")`
([Microsoft Learn](https://learn.microsoft.com/en-us/previous-versions/office/developer/office-2010/ff195140(v=office.14))).

**Cascade 3 tầng đề xuất** (không phải chọn một, mà xếp chồng - mỗi tầng bịt lỗ
của tầng dưới):

| tầng | cách | bền | chi phí |
|---|---|---|---|
| 1 | `<w:outlineLvl w:val="N"/>` ghi thẳng trong `<w:pPr>` của đoạn | cao khi có | 0 |
| 2 | đọc `word/styles.xml`, tra `<w:style w:styleId="X"><w:name w:val="heading N"/>` | **cao nhất** - `w:name` là tên chuẩn tiếng Anh | +1 entry zip, +1 lượt parse |
| 3 | regex trên chính `styleId` (`^Heading([1-9])$`) | thấp - chỉ Word tiếng Anh | 0 |

Bốn cái bẫy khiến **không được bỏ tầng nào**:

- **Casing của `w:name` không nhất quán ngay trong bộ spec.** Ví dụ trên trang
  `style` của ECMA-376 dùng **chữ hoa** `<w:name w:val="Heading 1"/>`
  ([c-rex.net/ECMA-376 Part 4](https://c-rex.net/samples/ooxml/e1/Part4/OOXML_P4_DOCX_style_topic_ID0E5ZQT.html)),
  còn mẫu do Word sinh và `<w:latentStyles>` thật dùng **chữ thường**
  `heading 1`. LibreOffice mã hoá cứng cả hai biến thể trong bảng import
  (`sw/source/writerfilter/dmapper/StyleSheetTable.cxx`: `{"heading 1", ...}`
  **và** `{"Heading 1", ...}`). => luật phải là **trim + lowercase** rồi mới
  khớp `^heading ([1-9])$`, kể cả khi chỉ đọc file đúng chuẩn.
- **`styles.xml` KHÔNG bắt buộc tồn tại.** Microsoft: *"the styles part is not
  required for a document to be considered valid"*
  ([Learn](https://learn.microsoft.com/en-us/office/open-xml/word/how-to-apply-a-style-to-a-paragraph-in-a-word-processing-document)).
  Tệ hơn: `pStyle` có thể trỏ tới built-in style **không có `<w:style>` nào**
  trong `styles.xml` - Word tự cấp định nghĩa mặc định. Khi đó cả tầng 1 lẫn
  tầng 2 đều mù, chỉ còn tầng 3. => **tầng 3 không phải chỉ là dự phòng khi
  thiếu FILE, mà còn là dự phòng khi thiếu ĐỊNH NGHĨA style.**
- **Style tuỳ biến dựa trên Heading vẫn là heading.** Tài liệu doanh nghiệp hay
  có `<w:style w:styleId="TieuDeChuong"><w:basedOn w:val="Heading1"/>` với
  `w:name` riêng ("Tiêu đề chương") và **không có `outlineLvl` của chính nó** -
  nó kế thừa. => cả tầng 1 lẫn tầng 2 phải **duyệt hết chuỗi `basedOn`**, không
  chỉ nhìn style lá. Chỉ nhìn lá là mất trắng loại heading này.
- **Không khớp trên `<w:aliases>`.** MS-OI29500 §17.7.4.9: Word không cho dấu
  phẩy trong `w:name` (vì dấu phẩy là ký tự ngăn cách alias), giới hạn tổng độ
  dài tên + alias là 253 ký tự, và *"Word removes white space from the beginning
  or end of primary style name"*
  ([MS-OI29500](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/716e4d7c-3b23-4210-9617-2b8324486a3b)).
  Điều cuối xác nhận việc trim là an toàn.

Ghi chú về nguồn: **ECMA-376/ISO 29500 KHÔNG liệt kê danh sách tên built-in và
KHÔNG bắt ứng dụng bản địa hoá** (từ dùng là *"may be used ... as desired"*).
Nguồn chính thức duy nhất cho bảng 9 tên `heading 1`..`heading 9` là
**MS-OI29500 của Microsoft, không phải ECMA/ISO**.

*Hiện trạng repo: chỉ có tầng 3 - tầng kém bền nhất. Đây là hạn chế đã biết chứ
không phải lỗi: tài liệu tiếng Việt thường soạn trên Word tiếng Anh nên vẫn chạy
(đã xác nhận trên `word-rich-1.docx`).*

**7. Namespace prefix.** Word thật luôn dùng `w:`, nhưng file do thư viện khác
ghi có thể dùng prefix khác hoặc namespace mặc định. Đã đo bộ đọc SAX với
`xmlns: true` trên cả 3 dạng - khớp theo **namespace URI + local name** thì cả 3
đều ra đúng, còn bắt cứng `w:` thì dạng 2 và 3 mất sạch chữ:

```
prefix w:   -> "Xin chao" OK
prefix la:  -> "Xin chao" OK
default ns  -> "Xin chao" OK
```

*Hiện trạng repo: bắt cứng `w:`. Rủi ro thấp trong thực tế (nguồn chủ yếu là
Word), nhưng khi đã đổi sang SAX thì khớp theo URI là miễn phí - nên làm.*

**8. Chữ ở nơi khác:** `<w:hyperlink>` (chứa `<w:r>` bên trong - trích được nếu
duyệt cây thay vì chỉ quét `<w:p>` cấp cao), `<w:sdt>`/`<w:sdtContent>` (content
control), `<w:txbxContent>` (hộp văn bản, nằm trong `<mc:AlternateContent>`).
Bộ đọc SAX duyệt theo sự kiện nên tự nhiên bắt được cả 3 mà không cần code riêng
- một lợi thế nữa so với regex quét theo `<w:p>` cấp cao.

Header/footer/footnote/comment nằm ở entry riêng (`word/header1.xml`,
`word/footnotes.xml`...). Cho mục đích kho tri thức, đề xuất **không đọc**: chúng
lặp lại trên mọi trang (header/footer) hoặc là ghi chú bên lề, đưa vào chỉ mục
làm nhiễu kết quả tìm kiếm. Đây là lựa chọn sản phẩm, nên hỏi lại người dùng.

### 3.2 SpreadsheetML

**1. Các kiểu ô (`t`)** - đo thật trên `excel-com-min.xlsx`:

```xml
<row r="1" spans="1:2"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
<row r="2" spans="1:2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>10</v></c></row>
<row r="4" spans="1:2"><c r="A4" t="s"><v>4</v></c><c r="B4"><f>SUM(B2:B3)</f><v>15</v></c></row>
```

| `t` | nghĩa | giá trị ở đâu | trích ra |
|---|---|---|---|
| `s` | chỉ số vào sharedStrings | `<v>` | `sharedStrings[Number(v)]` |
| (không có) | số thường | `<v>` | chính `<v>` |
| `inlineStr` | chuỗi nhúng thẳng | `<is><t>` hoặc `<is><r><t>` | gộp các `<t>` |
| `str` | chuỗi là KẾT QUẢ công thức | `<v>` | chính `<v>` |
| `b` | boolean | `<v>` = `0`/`1` | nên đổi thành chữ dễ đọc |
| `e` | lỗi | `<v>` = `#DIV/0!`... | giữ nguyên hoặc bỏ |
| `d` | ngày ISO (ECMA-376 bản 2+) | `<v>` | Excel gần như không ghi kiểu này |

Ô công thức: `<f>` đứng TRƯỚC `<v>`, và Excel ghi `<f>SUM(B2:B3)</f>` **không có
dấu bằng** kèm `<v>15</v>` là giá trị đã tính. Trích `<v>` là ra đúng giá trị.

*Hiện trạng repo: đúng về nguyên tắc (`V_RE` chỉ bắt `<v>`), nhưng `V_RE` là
regex không cờ `g` chạy trên chuỗi `inner` đã bị `CELL_RE` cắt sai, nên vẫn ra
kết quả sai (mục 1.3).*

**2. Ô rỗng.** Có **hai** dạng, phải xử lý cả hai:
- Ô không có gì cả: Excel **bỏ hẳn** khỏi XML (đo thật - `<row>` chỉ chứa các ô
  có nội dung).
- Ô có định dạng nhưng không có giá trị: Excel ghi **tự đóng** `<c r="B1" s="1"/>`
  (đo thật, mục 1.3).

Cả hai đều dẫn tới cùng một yêu cầu: **không được nối ô theo thứ tự xuất hiện**,
phải đọc thuộc tính `r` (ví dụ `"C1"`), quy ra chỉ số cột, rồi chèn ô rỗng cho
các cột bị nhảy cóc. Đã kiểm bộ đọc đề xuất:

```
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>
  -> "Ca phe |  | 25000"   OK (tự chèn cột B rỗng)
```

*Hiện trạng repo: SAI ở cả hai dạng - nối theo thứ tự xuất hiện, không đọc `r`.*

**3. Hàng nhảy cóc.** Thuộc tính `r` của `<row>` cũng nhảy cóc (hàng rỗng bị bỏ
hẳn). Với kho tri thức thì bỏ qua hàng rỗng là ĐÚNG, không cần chèn lại - repo
hiện tại đã bỏ qua hàng không có ô nào có chữ.

**4. sharedStrings và bẫy `<rPh>`** (đo thật):

```xml
<sst xmlns="..." count="5" uniqueCount="5"><si><t>San pham</t></si>...</sst>
```

Chuỗi rich-text tách thành nhiều `<r><t>` lồng trong một `<si>` - gom hết `<t>`
là ra đúng chữ. **Nhưng** `<si>` còn có thể chứa `<rPh>` (phiên âm furigana tiếng
Nhật), mà `<rPh>` cũng chứa `<t>`. Bộ đọc gom **mọi** `<t>` trong `<si>` sẽ nhân
đôi chữ với file tiếng Nhật.

*Hiện trạng repo: `T_TAG_RE` gom mọi `<t>` trong `<si>` - sẽ nhân đôi với file
tiếng Nhật. Rủi ro thấp cho bot tiếng Việt nhưng đã có thì loại luôn:
bộ đọc đề xuất đã cài cờ bỏ qua cây con `<rPh>`.*
Thêm nữa `T_TAG_RE = /<t[^>]*>/` cũng thiếu `\b` - cùng bệnh với `RUN_TEXT_RE`,
sẽ khớp bất kỳ thẻ nào bắt đầu bằng `<t`.

**5. Namespace.** Sheet XML dùng **namespace mặc định, không prefix** (đo thật):
`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`,
nên thẻ là `<c>`, `<row>`, `<v>` trần. Đây là lý do regex `<c\b...>` của repo
"chạy được" - nhưng nó cũng là lý do khiến regex mong manh: `<c>` là tên quá
ngắn, dễ đụng. Khớp theo namespace URI xử lý được cả file do thư viện khác ghi
với prefix `x:`.

**6. Thứ tự và tên sheet.** Tên sheet **chỉ có** ở `xl/workbook.xml`
(`<sheet name="..." sheetId="..." r:id="rId1"/>`), map qua
`xl/_rels/workbook.xml.rels` mới ra tên file thật. Đọc theo tên file
`sheet1.xml, sheet2.xml` có thể sai thứ tự hiển thị và **không có tên sheet**.
Với kho tri thức, tên sheet ("Bảng giá 2026", "Bảo hành") là thông tin ngữ cảnh
đáng giá cho việc tìm kiếm - đề xuất đọc `workbook.xml` để lấy tên và thứ tự.

*Hiện trạng repo: đọc theo tên file, đã ghi rõ trong comment là "xấp xỉ chấp nhận
được". Đúng là chấp nhận được, nhưng bỏ lỡ tên sheet.*

**7. Ngày tháng.** Excel lưu số serial (ví dụ `45000`) + `s=` trỏ tới `cellXfs`
trong `xl/styles.xml` -> `numFmtId` (id dựng sẵn 14..22 là ngày/giờ, hoặc
`numFmt` tự định nghĩa). Muốn hiện "15/03/2023" thay vì "45000" phải đọc thêm
`styles.xml`, dựng bảng `s -> numFmtId`, rồi tự quy đổi serial (epoch 1900, có
bug 29/02/1900, và tuỳ chọn `date1904`).

Đánh giá: **đáng làm ở mức tối thiểu**. Một bảng giá/lịch mà mọi ngày thành
`45000` là mất nghĩa hoàn toàn cho việc hỏi đáp. Nhưng chi phí thật (một entry
nữa, một bảng tra, luật epoch) nên tách thành việc riêng sau khi vá xong phần an
toàn. Không chặn đường chính.

**8. Thực thể và escape.** `&amp;` `&lt;` `&gt;` `&quot;` `&apos;` `&#x27;` -
parser SAX giải mã sẵn, không cần `decodeHtmlEntities` nữa. Ngoài ra Excel dùng
escape riêng `_x000D_` cho ký tự điều khiển trong chuỗi (ví dụ xuống dòng trong
ô) - đây là quy ước của Excel **nằm trong dữ liệu chữ**, parser XML không đụng
tới, bộ đọc phải tự thay.

*Hiện trạng repo: `decodeHtmlEntities` xử lý được entity XML (và dư ra nhiều
entity HTML không bao giờ xuất hiện trong OOXML), nhưng KHÔNG xử lý `_x000D_`.*

**9. Tiếng Việt.** Đo thật: Excel/Word lưu tiếng Việt **UTF-8 nguyên ký tự**,
không đổi thành entity: `<si><t>Cà phê sữa đá</t></si>`, `<w:t>Báo cáo doanh thu</w:t>`.
Điểm này quan trọng cho tính toán bộ nhớ ở mục 5.

---

## 4. Câu hỏi 3 - lấy fixture thật ở đâu

### 4.1 Kết quả kiểm máy dev

| công cụ | có? |
|---|---|
| LibreOffice (`soffice`) | **KHÔNG** (không có ở cả Program Files và Program Files (x86), không có winget) |
| **Microsoft Word** | **CÓ** - `C:\Program Files\Microsoft Office\root\Office16\WINWORD.EXE` |
| **Microsoft Excel** | **CÓ** - cùng thư mục |
| phiên bản | Office 365 (`O365HomePremRetail`), build 16.0.20228.20158, x64 |

COM automation chạy được **nếu dùng late binding**
(`[Type]::GetTypeFromProgID` + `InvokeMember`); early binding
(`New-Object -ComObject`) hỏng với `TYPE_E_CANTLOADLIBRARY` vì đây là bản cài
AppX/Store. Đã dùng đúng đường này để tạo toàn bộ file chứng minh trong mục 1.

Kích thước đo thật:

| file | byte | ghi chú |
|---|---|---|
| `word-com-min.docx` | 13 419 | 1 dòng chữ, 11 entry |
| `word-rich-1.docx` | 13 555 | Heading1 + đoạn văn tiếng Việt |
| `word-table.docx` | 13 776 | bảng 2x2 + `xml:space` + `<w:p/>` |
| `word-tabstop.docx` | 13 482 | **tab stop - file chứng minh lỗi 1.2** |
| `excel-com-min.xlsx` | 9 263 | 4 dòng + công thức `SUM` |
| `excel-o-rong-co-dinh-dang.xlsx` | 8 988 | **ô rỗng tự đóng - file chứng minh lỗi 1.3** |

### 4.2 So sánh nguồn

| nguồn | giấy phép | file nhỏ nhất do Office thật ghi | nghĩa vụ |
|---|---|---|---|
| **Tự tạo bằng Word/Excel trên máy này** | không có (bản quyền của chính mình) | docx 13,4 KB / xlsx 9,0 KB | **không** |
| `dotnet/Open-XML-SDK` | MIT (.NET Foundation) | `Plain.docx` 11 546 / `MCExecl.xlsx` 6 949 | kèm MIT notice |
| `python-docx` | MIT (Steve Canny) | 8 358 | kèm MIT notice |
| `exceljs` `spec/integration/data/` | MIT | `test-pr-567.xlsx` 6 371 | kèm MIT notice |
| `openpyxl` `tests/data/genuine/` | MIT | 7 511 | kèm MIT notice |
| `tafia/calamine` | MIT | 5 787 | kèm MIT notice |
| `XlsxWriter` | BSD-2 (một chủ sở hữu) | `simple01.xlsx` 7 333 | giữ copyright + disclaimer |
| `mammoth` | BSD-2 | 11 692 | giữ copyright + disclaimer |
| `apache/poi` | Apache-2.0 | 6 524 | **nặng nhất** - kèm cả AL-2.0 + NOTICE, không relicense được |
| `qax-os/excelize` | BSD-3 | 5 838 | thêm điều khoản cấm endorse |
| SheetJS `test_files` | **không xác định** | - | **LOẠI** - repo bị GitHub disable với lý do `private_information` |
| govdocs1 | không tự động CC0 | - | LOẠI - chỉ 164 docx/39 xlsx trên 986k file, phải tải mù ~465 GB |
| MS Open Specs / Ecma-376 | không MIT-compatible | **không có file mẫu kèm** | LOẠI |
| file-examples.com | mơ hồ "All rights reserved" | - | **TRÁNH** |

Ba cảnh báo rút ra khi đi vay corpus:
1. **File nhỏ nhất trong corpus thường KHÔNG do Office ghi.** `mammoth/empty.docx`
   (3 306 B), `poi/59021.xlsx` (1 933 B), `exceljs/missing-bits.xlsx` (1 214 B)
   đều thiếu `docProps/app.xml` - file tự chế hoặc đã cắt gọt. Ngưỡng thật cho
   "Word/Excel thật" là **6-12 KB**.
2. **Nhiều file trộn LibreOffice/openpyxl** dù nằm trong thư mục tên "genuine".
   Phải mở `docProps/app.xml` kiểm từng file.
3. **PII trong `docProps/core.xml`** - copy nguyên file là phát tán tên thật của
   người khác (Nick Burch, Eric White, Steve Canny...). Sửa để dọn thì với
   Apache-2.0 lại phát sinh nghĩa vụ "đánh dấu file đã sửa".

### 4.3 Tự tạo có hợp pháp không

Có, và rủi ro thực tế gần bằng 0:
- Microsoft Services Agreement: *"We don't claim ownership of Your Content."*
  Không có điều khoản nào đòi quyền trên output của phần mềm.
- Án lệ *Design Data Corp. v. Unigate Enterprise*, 847 F.3d 1169 (9th Cir. 2017):
  chủ bản quyền phần mềm **không** sở hữu file output do người dùng tạo.
- Tiền lệ thực tế mạnh nhất: `python-docx` ship `default.docx` (file Word nguyên
  bản, đủ `styles.xml`/`theme1.xml`/`docProps`) dưới MIT suốt 12 năm, hàng chục
  triệu lượt tải, chưa từng bị khiếu nại.

Ba điều kiện bắt buộc khi tạo: **không nhúng font** (không bật "Embed fonts"),
**không dùng template/theme/clipart tải từ Office.com**, **bắt đầu từ Blank
document** với nội dung tầm thường tự gõ.

### 4.4 Commit binary hay commit XML thô

Đo thật, và số liệu **bác một nửa** giả định "XML thô nhỏ hơn":

| tiêu chí | commit binary `.docx` | commit XML thô rồi zip trong test |
|---|---|---|
| kích thước | docx 13 555 B, xlsx 9 263 B | 3 part tối thiểu 5 306 B, **nhưng thêm `styles.xml` là 48 069 B - to gấp 3,5 lần bản zip** |
| đọc diff | "Binary files differ" | đọc được |
| độ trung thực | **100%** - đúng byte Word ghi, 11 part, cờ zip = 6 | bản 3-part làm **`Heading1` tụt về `Normal`** vì thiếu `styles.xml` |
| đang test cái gì | zip của Word/Excel | **zip do chính test sinh ra** - tự test writer của mình |

XML thô đủ dùng thì **to hơn** bản binary (vì binary đã nén sẵn); muốn nhỏ thì
phải bỏ `styles.xml`, mà bỏ là mất đúng thứ cần fidelity. Lập luận "đọc diff
được" cũng yếu: fixture là artifact **đóng băng, không bao giờ sửa**.

**Ghi chú vận hành quan trọng: Office KHÔNG byte-deterministic.** Lưu 2 lần cùng
nội dung ra 2 file khác nhau (xlsx 9 301 so với 9 297 B; docx 13 555 so với
13 560 B) do `xr:uid`/`w:rsidR`/`w14:paraId` sinh ngẫu nhiên mỗi lần lưu.
=> **Tạo một lần, commit, ĐÓNG BĂNG. Tuyệt đối không regenerate trong CI.**

Repo đã khai sẵn `*.docx binary` / `*.xlsx binary` trong `.gitattributes`, và
`read-zip-entry.ts` đã đọc được cả 3 file Office thật - **không cần thêm hạ tầng
nào**.

### 4.5 Khuyến nghị fixture

**Phương án 1 (khuyến nghị):** tự tạo bằng Word/Excel trên máy dev. 6 file đã tạo
sẵn trong scratchpad phiên này, tổng ~72 KB, có đủ tab stop, ô rỗng tự đóng,
`<w:p/>`, bảng, `xml:space`, công thức `<f>`+`<v>`, tiếng Việt có dấu. Không
nghĩa vụ giấy phép, không PII người lạ. Kèm một `README.md` nhỏ cạnh fixture ghi:
ai tạo, Office build nào, tạo từ Blank document, không nhúng font, cấp MIT, và
**không regenerate**.

**Phương án 2:** vay `dotnet/Open-XML-SDK` (`Plain.docx` 11,5 KB + `MCExecl.xlsx`
6,9 KB) - cả hai MIT, chuỗi bản quyền rõ ràng nhất (nhân viên Microsoft tạo bằng
Office thật -> .NET Foundation -> MIT). Cần dựng `THIRD-PARTY-NOTICES.md`.

**Loại:** SheetJS, govdocs1, MS Open Specs, file-examples.com. `apache/poi` dùng
được nhưng nghĩa vụ AL-2.0 nặng nhất.

---

## 5. Câu hỏi 4 - trần bộ nhớ

### 5.1 Vì sao trần hiện tại không an toàn

`read-zip-entry.ts` đặt `TRAN_GIAI_NEN_MAC_DINH = 300 MB` **cho từng entry**.
Ba vấn đề, xếp theo mức nghiêm trọng:

1. **Không có trần TỔNG.** `extract-xlsx-text.ts` đọc `sharedStrings.xml` **cộng**
   mọi `sheetN.xml`. Một archive 30 sheet, mỗi sheet 299 MB thì từng entry đều
   lọt trần còn tổng là ~9 GB. Comment trong file đã tự ghi nhận hạn chế này -
   đúng, và đây là lỗ hổng chính.
2. **300 MB một mình đã vượt ngân sách container.** Entry lớn nhất đo được trong
   file `.docx`/`.xlsx` thật là **7,13 MB** (`document.xml` của một tài liệu API
   kỹ thuật 37 entry); tổng uncompressed lớn nhất là **20,6 MB**. Trần 300 MB cao
   gấp **42 lần** thực tế.
3. **`.toString("utf-8")` nhân đôi chi phí với tiếng Việt.** V8 lưu chuỗi 1
   byte/ký tự **chỉ khi toàn bộ chuỗi nằm trong Latin-1**; chữ có dấu tiếng Việt
   nằm ngoài Latin-1 nên cả chuỗi thành two-byte.

   Đo thật (`--expose-gc`, so `used_heap_size`):

   | nội dung | Buffer UTF-8 | heap tăng | byte/code unit |
   |---|---|---|---|
   | ASCII thuần 56 MB | 56 000 000 B | 53,4 MB | 1,00 |
   | tiếng Việt 70 MB | 70 000 000 B | **93,5 MB** | **2,00** |
   | XML ASCII 61 MB | 61 000 000 B | 58,2 MB | 1,00 |
   | **y hệt + đúng một `<w:t>Tiếng Việt</w:t>` ở cuối (25 byte)** | 61 000 025 B | **116,3 MB** | **2,00** |

   Một ký tự có dấu duy nhất làm hỏng cả chuỗi. Mọi `document.xml` tiếng Việt
   luôn là two-byte string. Với trần 300 MB: ~300 MB Buffer (external) + ~400 MB
   heap = **~700 MB cho MỘT entry** trong container 768 MB.

### 5.2 Node trong container 768M

Node đọc giới hạn cgroup qua `uv_get_constrained_memory()` (có từ Node 12.7,
ổn định với cgroup v2 từ Node 20+). Công thức V8 (`src/heap/heap.cc`):
`old_generation = clamp(physical_memory / 2, 256 MB, 4 GB)`.

**Với 768M: old space = 384 MB** cho **cả process** - dùng chung cho mọi tài
khoản Zalo, agent loop, bộ gộp tin, cache.

Ba hệ quả:
1. Một entry OOXML không được phép ngốn quá khoảng 1/4 số đó.
2. **`Buffer` KHÔNG nằm trong old space** (đo: 70 MB buffer -> `external` +70 MB,
   `used_heap_size` +0). Nghĩa là `--max-old-space-size` **không** chặn được bom
   dạng Buffer; thứ chặn là cgroup, mà cgroup chặn bằng **SIGKILL cả process** -
   đúng kịch bản "OOM giết mọi account".
3. `buffer.constants.MAX_STRING_LENGTH` trên Node 24 = **536 870 888** (~512 MB
   theo code unit UTF-16). Trần chuỗi không cứu được: cgroup giết trước.

### 5.3 Các thư viện lớn đặt trần thế nào

| công cụ | trần/entry | trần TỔNG | tỉ lệ nén tối đa | số entry |
|---|---|---|---|---|
| Apache POI `ZipSecureFile` | 4 GiB - 1 (chỉ chặn tràn 32-bit) | không có | **100:1** (`MIN_INFLATE_RATIO = 0.01`), miễn kiểm dưới 100 KiB | 1000 |
| POI trích text | `MAX_TEXT_SIZE = 10 MiB` | - | - | - |
| **ClamAV** | `MaxFileSize 100M` | **`MaxScanSize 400M`** | không có | `MaxFiles 10000` |
| Python `zipfile` | không có | không có | không có | không có |
| Java `java.util.zip` | không có | không có | không có | không có |
| Go `archive/zip` | không có | không có | không có | không có |
| `yauzl` | không có | không có | không có | không có |
| `unzipper`/`jszip`/`node-stream-zip`/`fflate` | không có | không có | không có | không có |
| Composer (ví dụ thực tế) | - | - | >99% (~100:1) | - |
| Node `zlib` mặc định | `2^53-1` = **không có trần** | - | - | - |

Mã của POI đáng học nhất (3 ý): kiểm **liên tục trong lúc** giải nén (không đợi
xong), có **vùng miễn kiểm** cho entry nhỏ, tính tỉ lệ theo
`compressed/uncompressed` để tránh chia cho 0.

Nhưng **đừng sao chép con số 100:1 của POI**: đã có tiền lệ false positive hàng
loạt trên file Excel hợp lệ (Dataverse #7854, spark-excel #231, IBM CRRIT8251E),
và hậu quả là người dùng đặt `setMinInflateRatio(0)` - tức **tắt sạch phòng thủ**.
Trần quá chặt còn tệ hơn không có trần.

### 5.4 Ba loại trần - loại nào quan trọng nhất

- **(a) trần theo entry**: bắt một entry phình to; **bắt hụt** archive nhiều
  entry vừa phải (đúng lỗ hổng hiện tại).
- **(b) trần TỔNG cả archive**: **bắt được mọi biến thể** - dù chia nhỏ thế nào,
  tổng byte giải nén là hằng số bị chặn. **Đây là xương sống.** ClamAV
  (`MaxScanSize`) là ví dụ chuẩn; POI thiếu hẳn loại này.
- **(c) tỉ lệ nén**: lớp fail-fast rẻ, dừng sau vài KB. **Bắt hụt hai chỗ**:
  (1) bom **overlapping** của David Fifield (WOOT 2019) - 42 KB -> 5,4 GB không
  lồng nhau, tỉ lệ per-entry vẫn dưới 1032 nên kiểm tỉ lệ không thấy gì;
  (2) attacker chỉ cần giữ tỉ lệ dưới ngưỡng - nén 500 MB ở tỉ lệ 50:1 ra file
  10 MB, lọt mọi kiểm tỉ lệ, vẫn giết container.

Trần lý thuyết của DEFLATE là **1032:1** (RFC 1951: mỗi cặp (length, distance)
mã hoá tối đa 258 byte với chi phí tối thiểu ~2 bit). Đo thật trên Node 24:
`deflateRawSync` 50 MB byte 0 -> 50 970 B = **1028,6x**. Vượt 1032 chỉ có hai
đường: **lồng nhau** (42.zip: 5 lớp, 42 KB -> 4,5 PB) hoặc **chồng lấn entry**.

**Tỉ lệ nén thật của OOXML** (đo trên 19 file .docx/.xlsx thật + file tự sinh):

| chỉ số | trung bình | cao nhất |
|---|---|---|
| tỉ lệ cả archive | 6,25x | **20,75x** |
| tỉ lệ entry đơn (entry > 20 KB) | 14,5x | **50,2x** (`word/numbering.xml`) |
| số entry | 23,2 | **99** |
| entry lớn nhất | - | **7,13 MB** |
| tổng uncompressed lớn nhất | - | **20,6 MB** |

Đo bổ sung của tôi trên `.xlsx` 300 000 hàng do `exceljs` ghi: **10,2:1** cả
archive (8,46 MB -> 86 MB), `sheet1.xml` 9,4:1, `sharedStrings.xml` 13,8:1.

Ca hợp lệ tệ nhất: sheet 50 000 hàng **giống hệt nhau** (file máy sinh hợp lệ
nhưng thoái hoá) đạt **292,9x** - vượt xa trần 100:1 của POI, đúng cơ chế sinh ra
làn sóng false positive nói trên.

**Giới hạn trên của định dạng:** Excel cho 1 048 576 hàng x 16 384 cột. Đo thực
tế đã công bố: 1 triệu hàng x 100 cột toàn số -> `sheet1.xml` = 4 661 743 770 B
(~4,4 GB), vừa vượt trần `0xFFFFFFFF` của ZIP32. Con số 4 GiB của POI không phải
"mức hợp lý" mà là "mức chặn tràn kiểu dữ liệu".

### 5.5 Đọc theo luồng hay nạp cả khối

Đo thật (payload 200 MB):

| cách | maxRSS trước | maxRSS sau | chênh |
|---|---|---|---|
| `zlib.inflateRawSync(comp)` một phát | 251 MB | 461 MB | **+210 MB** |
| `createInflateRaw()` + đếm byte, `destroy()` ở 64 MB | 251 MB | 264 MB | **+13 MB** |

Streaming đưa đỉnh về **mức trần mình đặt**, không phải mức bom khai báo.

Câu hỏi mấu chốt - streaming có giảm đỉnh THẬT không nếu cuối cùng vẫn cần cả
text để parse?

- **Parser cần cả chuỗi** (DOM, `fast-xml-parser` mặc định, `xml2js`): **KHÔNG**.
  Chỉ dời chỗ tốn. Lợi duy nhất là cắt sớm được - nhưng đó đã là lợi ích lớn.
- **Parser SAX**: **CÓ, giảm rất mạnh.** Chỉ phải giữ lại phần chữ trích được.
  Đo trên `document.xml` 7,13 MB thật: 7 279 443 ký tự XML nhưng chỉ **119 218
  ký tự** nằm trong `<w:t>` - **text thật chỉ chiếm 1,6%**. Đỉnh còn khoảng
  1-2% của entry thay vì 100%+.

Đây chính là lý do hướng (b) SAX + streaming thắng, chứ không phải vì tốc độ.

Lưu ý kỹ thuật: `maxOutputLength` **chỉ áp dụng cho convenience methods**
(`inflateRawSync`...), **stream `zlib.createInflateRaw()` KHÔNG nhận tham số
này** - phải tự đếm byte trong vòng `for await` và `destroy()` khi vượt.

Đo xác nhận trên đề xuất: `bom-100mb.docx` (149 KB trên đĩa, 100 MB XML) bị từ
chối sau **7 ms** với RSS không tăng.

### 5.6 Bộ số đề xuất

Ngân sách dẫn xuất:

```
Container                                                    768 MB
- Node baseline + SQLite + zca-js listeners        ~120 MB  [ước lượng - CẦN ĐO]
- dự phòng GC spike + phân mảnh                     ~80 MB
= ngân sách một lượt xử lý OOXML                   ~200 MB đỉnh
```

Đỉnh cho phép 200 MB, mà tiếng Việt nhân 2 nếu còn `toString` -> ngân sách byte
giải nén khoảng **64 MB**.

| tham số | đề xuất | lập luận |
|---|---|---|
| **trần TỔNG cả archive** | **64 MB** | Trần **duy nhất bắt được mọi biến thể**. File thật lớn nhất đo được 20,6 MB -> headroom 3,1x. Đỉnh xấu nhất kể cả còn `toString`: 64 + 128 = 192 MB, lọt ngân sách 200 MB và dưới old space 384 MB. Đây là thứ repo hiện **thiếu hoàn toàn**. |
| **trần theo entry** | **32 MB** | `document.xml` lớn nhất đo được 7,13 MB -> headroom 4,5x. Không entry nào ăn quá nửa ngân sách archive. Bỏ hẳn 300 MB (gấp 42x thực tế, một mình đã vượt container). |
| **tỉ lệ nén tối đa** | **500:1**, miễn kiểm dưới **1 MB** | OOXML thật cao nhất 50,2x; file máy sinh thoái hoá 292,9x; bom thật 1028x. 500:1 nằm giữa 293 và 1028 -> headroom 1,7x trên ca hợp lệ tệ nhất mà vẫn bắt bom. **KHÔNG dùng 100:1 kiểu POI** (tiền lệ false positive -> người dùng tắt sạch). Miễn kiểm 1 MB thay vì 100 KiB của POI vì entry nhỏ nhiễu mạnh và không đe doạ gì. |
| **số entry tối đa** | **256** | Corpus thật: trung bình 23,2, cao nhất 99 -> headroom 2,6x. Chặn archive vài vạn entry nhỏ. |
| **đọc theo luồng** | **BẮT BUỘC** | Đo: một phát +210 MB, luồng + cắt ở trần +13 MB. |
| **độ sâu lồng zip** | **0** | OOXML không bao giờ chứa zip lồng hợp lệ; 42.zip đạt 4,5 PB **chỉ nhờ 5 lớp lồng**. Từ chối thẳng entry là archive. |
| **`maxOutputLength`** cho mọi lời gọi `zlib` một phát | **= trần entry (32 MB)** | Mặc định Node là `2^53-1`, tức không có trần. Phải truyền tay. |
| **độ sâu lồng THẺ XML** | **256** | Đây là trần chặn ReDoS/stack overflow. Đo: chặn 4 MB input đối kháng trong **2,1 ms**, không phụ thuộc cỡ input. Tài liệu Word thật hiếm khi sâu quá ~20 cấp. |
| **trần tổng số ký tự trích ra** | **8 MB** `[ước lượng]` | Chặn ca "XML hợp lệ nhưng toàn chữ". Nên chỉnh theo `KB_MAX_FILE_MB`. |
| **`.toString("utf-8")` cả entry** | **BỎ** | Text thật chỉ 1,6% của `document.xml`; tiếng Việt buộc two-byte. Nạp chunk vào SAX thay vì dựng chuỗi. |

Ba quy tắc kèm theo (không phải con số nhưng bắt buộc):

1. **Không tin `uncompressedSize` trong central directory.** Spec cho phép khai
   gian. Dùng nó để **từ chối SỚM** (tổng khai báo > 64 MB thì khỏi mở), nhưng
   vẫn phải **đếm byte thật** khi giải nén.
2. **Kiểm chồng lấn entry.** Bom Fifield qua mọi kiểm tỉ lệ per-entry. Cách rẻ:
   quét `relativeOffsetOfLocalHeader` trùng nhau trước khi giải nén bất cứ thứ
   gì. Info-ZIP (patch Mark Adler) và zip.js đều làm vậy.
3. **Trần upload KHÔNG phải phòng thủ.** `KB_MAX_FILE_MB` mặc định 20 MB (tối đa
   100). 20 MB ở tỉ lệ 1028:1 = 20 GB. Trần upload chỉ giới hạn băng thông và
   đĩa. Mọi phòng thủ phải nằm ở tầng giải nén.

Ghi chú: comment trong `read-zip-entry.ts:22` viết "KB_MAX_FILE_MB, tới 100 MB" -
đúng về mặt trần tối đa cho phép chỉnh, nhưng mặc định thực tế là **20 MB**
(`src/config/env.ts:289`). Đáng làm rõ khi sửa.

---

## 6. Hình dạng bộ đọc đề xuất (đã chạy thử, không phải phác thảo)

Nguyên mẫu đã chạy đúng trên: file Word/Excel thật, bom 1 MB, bom 100 MB, và
`.xlsx` 300 000 hàng. Đủ nhỏ để chia thành 2-3 file dưới 200 dòng.

```
đọc zip theo LUỒNG (mở rộng read-zip-entry.ts)
  -> đếm byte, kiểm 4 trần: tổng archive / entry / tỉ lệ nén / số entry
  -> nạp từng chunk vào SaxesParser({ xmlns: true })
       -> khớp theo NAMESPACE URI + local name (không phụ thuộc prefix)
       -> đếm độ sâu, vượt 256 thì ném
       -> bỏ qua CẢ CÂY CON: w:pPr, w:rPr, w:tblPr, w:tcPr, w:trPr, w:sectPr,
                             w:instrText, w:delText, w:proofErr; (xlsx) rPh
       -> bắt cả sự kiện `text` VÀ `cdata` (saxes phát riêng)
  -> phát ra từng ĐOẠN (docx) / từng HÀNG (xlsx), không tích luỹ cả tài liệu
```

Kết quả kiểm trên nguyên mẫu:

```
tab stop trong w:pPr KHÔNG thành ký tự tab        -> "Xin chao"          OK
w:tab THẬT trong w:r VẪN thành tab                -> "Ten\tGia"          OK
w:delText (chữ đã xóa) KHÔNG lọt vào chỉ mục      -> "Gia moi 1200k"     OK
w:instrText (mã field HYPERLINK) KHÔNG lọt        -> "Bam vao day"       OK
ô rỗng tự đóng <c r="B1" s="2"/>                  -> "Ca phe |  | 25000" OK
thuộc tính r nhảy cóc (A1, C1 thiếu B1)           -> "Ca phe |  | 25000" OK
prefix khác w: / namespace mặc định               -> "Xin chao"          OK
dấu > trong giá trị thuộc tính                    -> "Gia dung"          OK
chữ trong comment XML KHÔNG bị trích              -> "Chu that"          OK
CDATA (cần handler `cdata` riêng)                 -> "a < b & c"         OK
thực thể &amp; &lt;                               -> "Cong ty A & B <VN>" OK
```

Hệ quả phụ đáng chú ý: **`decodeHtmlEntities` không còn cần cho đường OOXML** -
parser XML tự giải mã. Nó vẫn cần cho đường web scraping (`html-to-text.ts`),
nên đừng xoá, chỉ ngừng gọi từ hai extractor.

---

## 7. Việc còn treo / cần người quyết

1. **`saxes` hay `sax`?** Cả hai đo ra kết quả giống hệt. `saxes` nhanh hơn 2,5
   lần, có types sẵn, đã nằm trong cây phụ thuộc (qua `exceljs`), nhưng xuất bản
   gần nhất 2021-11-07. `sax` 0 dependency và còn xuất bản (2026-07-24) nhưng
   cần `@types/sax`. Nghiêng `saxes`, cần người chốt theo khẩu vị chuỗi cung ứng.
2. **Baseline RSS thật của prod chưa đo.** Con số ~120 MB cho Node + SQLite + n
   listener là **ước lượng**. Nếu thật cao hơn (5 account -> 250 MB) thì trần
   tổng 64 MB nên hạ xuống 32-48 MB. Cần một lần `docker stats` lúc bot chạy đủ
   account.
3. **Có đọc header/footer/footnote không?** Đề xuất không (làm nhiễu chỉ mục),
   nhưng đây là lựa chọn sản phẩm.
4. **Ngày tháng trong xlsx** (số serial -> chữ) có làm ngay không? Cần đọc thêm
   `xl/styles.xml`. Đề xuất tách thành việc riêng sau khi vá xong phần an toàn.
5. **Nhận heading qua cascade 3 tầng** có làm ngay không? Hiện chỉ có tầng kém
   bền nhất (đúng với Word tiếng Anh). Chi phí: +1 entry zip, +1 lượt parse, +
   logic duyệt chuỗi `basedOn`. Hai điểm **không tra được nguồn chính thức**:
   (a) thuật toán Word sinh `styleId` từ tên bản địa hoá; (b) Word 2019/365 còn
   bản địa hoá `styleId` hay đã bỏ - bằng chứng cộng đồng gần nhất là 2023 và
   vẫn khẳng định là có. Cả hai đều không chặn đường: cascade 3 tầng đã bọc được
   ca xấu nhất mà không cần biết thuật toán.
6. **Trần 8 MB cho tổng ký tự trích ra là ước lượng**, chưa đo trên tài liệu
   thật lớn nhất mà người vận hành dự định upload.
7. **Chưa kiểm chồng lấn entry** (bom Fifield) trên `read-zip-entry.ts` hiện tại
   - nhiều khả năng chưa có, cần xác nhận khi sửa.
8. Phần án lệ ở mục 4.3 là tổng hợp nguồn công khai, **không phải tư vấn pháp
   lý**; *Design Data* là luật liên bang Mỹ (9th Cir.).

---

## Phụ lục - nguồn

**Apache POI**: [ZipSecureFile javadoc](https://poi.apache.org/apidocs/dev/org/apache/poi/openxml4j/util/ZipSecureFile.html) -
[ZipArchiveThresholdInputStream.java](https://raw.githubusercontent.com/apache/poi/trunk/poi-ooxml/src/main/java/org/apache/poi/openxml4j/util/ZipArchiveThresholdInputStream.java) -
[IOUtils javadoc](https://poi.apache.org/apidocs/dev/org/apache/poi/util/IOUtils.html) -
[Dataverse #7854](https://github.com/IQSS/dataverse/issues/7854) -
[spark-excel #231](https://github.com/crealytics/spark-excel/issues/231)

**ClamAV**: [clamd.conf(5)](https://manpages.debian.org/testing/clamav-daemon/clamd.conf.5.en.html) -
[clamd.conf.sample](https://github.com/Cisco-Talos/clamav/blob/main/etc/clamd.conf.sample)

**Python / Java / Go**: [CPython #80441 (CVE-2019-9674)](https://github.com/python/cpython/issues/80441) -
[golang/go#33036](https://github.com/golang/go/issues/33036) -
[golang/go#78367](https://github.com/golang/go/issues/78367) -
[AWS CodeGuru: Decompression Bomb](https://docs.aws.amazon.com/codeguru/detector-library/go/decompression-bomb)

**OWASP**: [File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) -
[WSTG: Test Upload of Malicious Files](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/10-Business_Logic_Testing/09-Test_Upload_of_Malicious_Files)

**Zip / DEFLATE**: [A better zip bomb - Fifield, WOOT 2019](https://www.usenix.org/system/files/woot19-paper_fifield_0.pdf) -
[Zip bomb (Wikipedia)](https://en.wikipedia.org/wiki/Zip_bomb) -
[madler/unzip](https://github.com/madler/unzip) -
[zip.js #587: detecting zip bombs](https://github.com/gildas-lormeau/zip.js/discussions/587) -
[composer#12369](https://github.com/composer/composer/issues/12369)

**Node / V8**: [Node zlib docs (v24)](https://nodejs.org/docs/latest-v24.x/api/zlib.html) -
[nodejs/node#33516 (maxOutputLength)](https://github.com/nodejs/node/pull/33516) -
[nodejs/node#27508 (cgroup memory limits)](https://github.com/nodejs/node/pull/27508) -
[Node 20+ memory management in containers (Red Hat)](https://developers.redhat.com/articles/2025/10/10/nodejs-20-memory-management-containers) -
[v8/src/heap/heap.cc](https://github.com/v8/v8/blob/master/src/heap/heap.cc) -
[V8 string optimizations](https://iliazeus.lol/articles/js-string-optimizations-en/) -
[Max string length across Node versions](https://blog.philz.dev/blog/node-string-length/)

**OOXML**: [Excel and ZIP64 (sheet1.xml vượt 4GB)](https://rzymek.github.io/post/excel-zip64/)

**Giấy phép fixture**: [Design Data Corp. v. Unigate Enterprise, 847 F.3d 1169 (9th Cir. 2017)] -
[python-docx default.docx (MIT)](https://github.com/python-openxml/python-docx) -
[dotnet/Open-XML-SDK (MIT)](https://github.com/dotnet/Open-XML-SDK)

**Số đo trực tiếp trong nghiên cứu này**: Node v24.11.1 trên Windows 11; Microsoft
Office 365 build 16.0.20228.20158 (COM late-binding) để sinh 6 file .docx/.xlsx
thật; `npm view` cho metadata gói; `npm audit` cho lỗ hổng; và chính
`src/knowledge/doc-text-extract.ts` của repo chạy qua `tsx` trên các file đó.
