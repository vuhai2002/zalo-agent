# Phase 01 - Đọc OOXML an toàn

**Ưu tiên:** cao nhất. Đây là gốc của 3 trong 5 lỗi Critical.
**Trạng thái:** chưa làm.

## Bối cảnh

- Nghiên cứu quyết định hướng: [`reports/nghien-cuu-doc-ooxml-an-toan.md`](reports/nghien-cuu-doc-ooxml-an-toan.md).
  **Đọc trước khi viết code** - nó có mẫu XML thật cho từng ca biên, số đo từng
  ứng viên thư viện, và căn cứ cho từng con số trần.
- File hiện tại: `src/shared/read-zip-entry.ts` (126 dòng),
  `src/knowledge/extract-docx-text.ts` (39), `src/knowledge/extract-xlsx-text.ts` (85).
- `read-zip-entry.ts` DÙNG CHUNG với đường GHI tài liệu của bot
  (`src/documents/render-docx.ts`, `render-xlsx.ts`) - không được làm hỏng.

## Lỗi phải đóng

| Mã | Lỗi | Số đo |
|---|---|---|
| C1 | ReDoS bậc hai trên XML của người ngoài | bom 1,7 KB -> khoá event loop 38,09 giây, tick = 0. Đo lại trên `extractDocxText` thật: file .docx 0,7 KB -> 2.789 ms. `extract-xlsx-text.ts` nặng hơn (`ROW_RE` 11.588 ms) |
| D | `RUN_TEXT_RE` thiếu `\b` -> nuốt `<w:tab/>`, `<w:tc>`, `<w:tblPr>` | file Word THẬT có tab stop -> repo trả về XML thô `<w:tab w:val="left" w:pos="2880"/>...` |
| E | `CELL_RE` tham lam -> ô rỗng tự đóng nuốt ô kế tiếp | file Excel THẬT -> `"Mon | 1"` thay vì `"Mon |  | Gia"` |
| (mới) | Bảng Word mất cấu trúc hàng | nghiên cứu tìm thêm |
| (mới) | `<w:p/>` tự đóng bị coi là thẻ mở | nghiên cứu tìm thêm |
| (mới) | Extractor trả CHUỖI RỖNG chứ không ném khi regex sa lầy | nhánh `hong` không bao giờ chạy, nguồn độc hiện ra "Sẵn sàng, 0 đoạn" |
| C4 (phần trần) | Trần giải nén 300 MB/entry, KHÔNG có trần TỔNG | entry 250 MB -> RSS 860 MB, container 768M |

## Nhận định then chốt

**Không tự viết bộ quét tuyến tính.** Nghiên cứu đo được nó sai 5/5 ca biên: dấu
`>` nằm trong giá trị thuộc tính, comment XML, khối CDATA, thực thể, và namespace
prefix khác `w:`/`x:`. Đây là XML của người ngoài nên mọi ca biên đều tới được.

**Không dùng `htmlparser2`.** Đo được nó bậc hai theo ĐỘ SÂU LỒNG THẺ
(17/55/215/1027 ms) - đổi lỗ DoS này lấy lỗ DoS khác.

**Không dùng `mammoth` hay `exceljs` để ĐỌC.** `mammoth` treo event loop hơn 200
giây trước file 1,7 KB. `exceljs` (đã có trong repo cho đường ghi) tốn 949 MB RSS
đọc file 8,46 MB - container chỉ có 768M.

**Giải nén THEO LUỒNG, nạp từng chunk vào parser.** Đây là chỗ giảm bộ nhớ đỉnh
nhiều nhất, và là điều kiện để trần tổng có ý nghĩa. Bỏ hẳn `.toString("utf-8")`
cả entry: tiếng Việt buộc V8 dùng 2 byte/ký tự (đo được: một ký tự có dấu làm
hỏng cả chuỗi sang two-byte).

**Trần TỔNG mới là trần bắt được mọi biến thể.** Repo hiện thiếu hoàn toàn. Trần
theo từng entry vô nghĩa với xlsx vì nó đọc `sharedStrings.xml` cộng mọi sheet.

**Extractor phải NÉM khi không trích được chữ nào**, không trả chuỗi rỗng. Nhánh
`hong` của worker chỉ chạy khi có lỗi ném ra.

## File

**Tạo:**
- `src/shared/xml-sax-scan.ts` - bọc `saxes`, nhận luồng chunk, phát sự kiện đã
  giới hạn (độ sâu, số phần tử)
- `src/shared/zip-stream-entry.ts` - giải nén theo luồng kèm trần, thay đường
  `readZipEntryText` cho nhánh đọc
- `src/knowledge/ooxml-limits.ts` - toàn bộ hằng số trần, một chỗ duy nhất
- test cho ba file trên
- `src/knowledge/fixtures/` - fixture nhị phân do Office THẬT ghi

**Sửa:**
- `src/knowledge/extract-docx-text.ts` - viết lại trên SAX
- `src/knowledge/extract-xlsx-text.ts` - viết lại trên SAX
- `src/shared/read-zip-entry.ts` - thêm trần tổng; giữ nguyên chữ ký cũ cho
  đường GHI của bot
- `package.json` - thêm `saxes`

## Trần (một chỗ duy nhất, `ooxml-limits.ts`)

| Hằng | Giá trị | Căn cứ |
|---|---|---|
| Tổng archive giải nén | 64 MB | entry lớn nhất trong file Office thật đo được là 7,13 MB; container 768M cho V8 old space chỉ 384 MB |
| Một entry | 32 MB | nửa trần tổng, đủ xa mọi file thật |
| Tỉ lệ nén tối đa | 500:1 | miễn kiểm dưới 1 MB để không chặn nhầm file nhỏ nén tốt |
| Số entry | 256 | file .docx/.xlsx thật có vài chục |
| Độ sâu lồng thẻ XML | 256 | chặn bom lồng sâu |
| Tổng ký tự trích ra | 8 MB | ước lượng, ghi rõ là ước lượng trong comment |

Nếu baseline RSS prod cao hơn ~120 MB thì hạ trần tổng xuống 32-48 MB - ghi chú
này vào comment để người vận hành biết chỗ chỉnh.

## Các bước

- [ ] **B1: Cài `saxes`**

```bash
pnpm add saxes
```

Kiểm lại trước khi cài: `npm view saxes@6.0.0 time.created dependencies`. Phải ra
ngày 2021-11-07 và đúng một dep `xmlchars`. Nếu `pnpm` báo lỗi liên quan
`minimumReleaseAge` hay `ERR_PNPM_IGNORED_BUILDS`, DỪNG và báo NEEDS_CONTEXT -
đừng tự tắt cơ chế bảo vệ.

- [ ] **B2: Fixture Office thật (làm TRƯỚC, mọi test sau dựa vào nó)**

Nghiên cứu đã tạo sẵn 6 file bằng Office 365 qua COM trên máy dev. Tìm chúng theo
đường dẫn ghi trong báo cáo, chọn một `.docx` (~13,4 KB) và một `.xlsx` (~9,0 KB),
commit dạng NHỊ PHÂN vào `src/knowledge/fixtures/`.

**Đóng băng, không regenerate** - Office không byte-deterministic, sinh lại là
diff nhiễu. Ghi một `README.md` cạnh fixture nói rõ: tạo bằng gì, chứa gì (tab
stop, ô rỗng tự đóng, bảng, tiếng Việt có dấu), và tuyệt đối không sinh lại.

KHÔNG commit XML thô đã giải nén - đo được nó to gấp 3,5 lần.

- [ ] **B3: Test đỏ trước - fixture thật phải đọc ra ĐÚNG**

```ts
it("đọc file .docx do Word THẬT ghi, không lẫn một mẩu XML nào", async () => {
  const buf = fs.readFileSync(new URL("./fixtures/bang-gia-word.docx", import.meta.url));
  const chu = await docChuTuFile(buf, "docx");
  assert.doesNotMatch(chu, /<w:/, "XML thô lọt vào chữ trích ra");
  assert.match(chu, /Chính sách bảo hành/);
});

it("tab stop trong Word không biến thành XML thô", async () => {
  // Đây là ca ĐÃ ĐO hỏng: <w:tab w:val="left" w:pos="2880"/> khớp /<w:t[^>]*>/
  const chu = await docChuTuFile(docxThat(), "docx");
  assert.doesNotMatch(chu, /w:val|w:pos|w:tabs/);
});

it("ô rỗng tự đóng của Excel KHÔNG nuốt ô kế tiếp", async () => {
  // Đã đo hỏng: ra "Mon | 1" thay vì "Mon |  | Gia" - số 1 là index sharedString
  const chu = await docChuTuFile(xlsxThat(), "xlsx");
  const dongDau = chu.split("\n")[0]!;
  assert.match(dongDau, /Món \|\s*\| Giá/, `hàng đầu đọc ra: ${JSON.stringify(dongDau)}`);
});
```

- [ ] **B4: Test đỏ trước - bom phải bị TỪ CHỐI NHANH, không treo**

```ts
it("XML thiếu thẻ đóng bị từ chối trong dưới 1 giây, không quay CPU", async () => {
  const bom = docxVoiXml("<w:p>".repeat(200_000));  // không có thẻ đóng nào
  const t0 = performance.now();
  await assert.rejects(() => docChuTuFile(bom, "docx"));
  assert.ok(performance.now() - t0 < 1000, `tốn ${performance.now() - t0}ms`);
});

it("entry giải nén vượt trần bị từ chối, KHÔNG cấp phát hết", async () => {
  await assert.rejects(() => docChuTuFile(zipEntryQuaTran(), "docx"), /vượt quá giới hạn/i);
});

it("tổng giải nén vượt trần bị từ chối dù mỗi entry đều dưới trần", async () => {
  // Trần theo TỪNG entry là chưa đủ: xlsx đọc sharedStrings CỘNG mọi sheet
  await assert.rejects(() => docChuTuFile(zipNhieuEntryVuaDu(), "xlsx"), /vượt quá giới hạn/i);
});

it("XML lồng sâu quá trần bị từ chối", async () => {
  await assert.rejects(() => docChuTuFile(docxVoiXml("<w:p>".repeat(300) + "x"), "docx"), /lồng quá sâu/i);
});
```

Test thời gian phải đo trong CÙNG một tiến trình, không dùng `setTimeout` để phán.
Nếu máy CI chậm làm ngưỡng 1 giây bấp bênh thì nới lên 3 giây - vẫn cách xa 38
giây của bản cũ ba bậc.

- [ ] **B5: Test đỏ trước - trích ra rỗng phải NÉM**

```ts
it("docx chỉ có ảnh (không có chữ nào) NÉM lỗi tiếng Việt đọc được", async () => {
  // Trả chuỗi rỗng thì worker đánh dấu "Sẵn sàng, 0 đoạn" - nguồn độc trông như
  // nguồn khỏe. Đây là cách nguồn giết tiến trình lọt qua nhánh `hong`.
  await assert.rejects(() => docChuTuFile(docxChiCoAnh(), "docx"), /không đọc được chữ nào/i);
});

it("xlsx toàn ô rỗng NÉM lỗi", async () => {
  await assert.rejects(() => docChuTuFile(xlsxRong(), "xlsx"), /không đọc được chữ nào/i);
});
```

- [ ] **B6: Viết `ooxml-limits.ts`, `xml-sax-scan.ts`, `zip-stream-entry.ts`**

`xml-sax-scan.ts` phải đếm độ sâu và số phần tử, ném khi vượt. `saxes` ở chế độ
XML nghiêm ngặt sẽ tự bắt XML sai cú pháp - bọc lỗi của nó thành câu tiếng Việt.

- [ ] **B7: Viết lại hai extractor trên SAX**

Xử lý đủ các ca trong mục "XML thật" của báo cáo nghiên cứu. Tối thiểu:
`<w:t xml:space="preserve">`, `<w:tab/>` `<w:br/>` `<w:cr/>`, `<w:p/>` tự đóng,
bảng `<w:tbl>/<w:tr>/<w:tc>` giữ cấu trúc hàng, heading nhận qua `w:outlineLvl`
(bền hơn `pStyle` bản địa hóa), và với xlsx: `t="s"`, `t="inlineStr"`, `t="str"`,
`t="b"`, `t="e"`, ô rỗng tự đóng, ô có `s=` không `t=`, thuộc tính `r` nhảy cóc cột.

- [ ] **B8: Trần TỔNG cho `read-zip-entry.ts`, giữ đường GHI không hỏng**

Chạy `src/shared/read-zip-entry.test.ts`, `src/documents/render-docx.test.ts`,
`src/documents/render-xlsx.test.ts` - phải xanh nguyên.

- [ ] **B9: `pnpm typecheck` + `pnpm test`**

- [ ] **B10: Phá code kiểm 8 chốt**

| Phá gì | Test phải đỏ | Đường code được chạy |
|---|---|---|
| Bỏ trần độ sâu trong `xml-sax-scan` | "lồng sâu quá trần" | bộ đếm depth |
| Bỏ trần entry | "entry vượt trần" | nhánh kiểm cỡ khi giải nén |
| Bỏ trần TỔNG | "tổng vượt trần dù mỗi entry đều dưới trần" | bộ cộng dồn |
| Quay lại `RUN_TEXT_RE` cũ (không `\b`) | "tab stop không biến thành XML thô" | nhánh gom `<w:t>` |
| Quay lại `CELL_RE` tham lam | "ô rỗng tự đóng KHÔNG nuốt ô kế tiếp" | nhánh ô tự đóng |
| Trả `""` thay vì ném khi rỗng | "docx chỉ có ảnh NÉM lỗi" | nhánh kiểm rỗng |
| Bỏ streaming, `toString` cả entry | (không có test hành vi) - đo RSS thay vì test | ghi số đo vào report |
| Bỏ xử lý `<w:p/>` tự đóng | test ranh giới đoạn văn trên fixture thật | nhánh self-closing |

Với mỗi phép phá, ghi rõ vào report: đường code nào được chạy, và vì sao khẳng
định lật. Đợt trước có tám ca test hụt - không lặp lại.

- [ ] **B11: Đo lại đầu-cuối và ghi số vào report**

Ba con số bắt buộc, đo trước và sau:
- bom 1,7 KB: thời gian và số tick của `setInterval(10ms)` chạy được
- file .xlsx thật 8,46 MB (nếu có): RSS đỉnh và thời gian
- fixture Office thật: chữ trích ra đúng chưa

- [ ] **B12: Commit**

```
fix(kb): đọc docx/xlsx bằng SAX theo luồng, chặn ReDoS và bom giải nén
```

## Định nghĩa hoàn thành

- Bom 1,7 KB bị từ chối trong dưới 1 giây thay vì khoá event loop 38 giây.
- Fixture Office THẬT đọc ra đúng, không lẫn một mẩu XML nào.
- Ô rỗng tự đóng không nuốt ô kế tiếp; tab stop không thành XML thô.
- Trần TỔNG có hiệu lực, không chỉ trần từng entry.
- Trích ra rỗng thì NÉM, không trả chuỗi rỗng.
- Đường GHI docx/xlsx của bot không hỏng.
- 8/8 phép phá đỏ đúng chỗ, mỗi phép có ghi đường code được chạy.

## Rủi ro

| Rủi ro | Chặn thế nào |
|---|---|
| Viết lại làm hỏng đường GHI của bot | B8 chạy lại test của `render-docx`/`render-xlsx` |
| `saxes` không xử lý được namespace prefix lạ | Báo cáo nghiên cứu có mẫu; nếu vẫn hỏng thì báo lại chứ đừng nới test |
| Fixture Office quá to làm phình repo | Chọn file nhỏ nhất còn đủ ca biên (13,4 KB + 9,0 KB) |
| Trần 64 MB chặn nhầm tài liệu thật | Entry lớn nhất đo được trong file thật là 7,13 MB - cách 9 lần |

## Bước tiếp

Phase 02 đưa bộ đọc mới này vào worker thread và thêm bộ đếm lần thử.
