# Phase 02 - Đọc file và cắt đoạn

**Ưu tiên:** cao. Chất lượng cắt đoạn quyết định chất lượng tra cứu nhiều hơn
thuật toán tìm kiếm.
**Trạng thái:** chưa làm. **Cần:** phase 01.

## Bối cảnh

- `src/shared/read-zip-entry.ts` - bộ đọc zip TỰ VIẾT, đã chạy thật (docx/xlsx
  đều là zip chứa XML). Hiện chỉ test dùng.
- `src/shared/html-to-text.ts` - đã có, dùng cho `web_fetch`.
- `src/documents/render-xlsx.ts` - biết cấu trúc xlsx từ phía GHI, đọc ngược lại.
- Chuẩn ngành: 400-512 token/đoạn, chồng lấn 10-20%; FAQ thì 200-400.

## Nhận định then chốt

**Cắt theo RANH GIỚI TỰ NHIÊN, không cắt cứng theo số ký tự.** Cắt giữa câu là
mất nghĩa, và đoạn mất nghĩa thì bm25 có tìm ra cũng vô dụng. Thứ tự ưu tiên
ranh giới: tiêu đề markdown (`#`) > dòng trống > xuống dòng > câu (`. `) > ký tự.

**Giữ TIÊU ĐỀ gần nhất phía trên vào từng đoạn.** Đoạn "trong vòng 7 ngày" một
mình thì vô nghĩa; kèm tiêu đề "Chính sách đổi trả" thì model đọc ra ngay. Đây
là mẹo rẻ nhất bù cho việc không có embedding ở đợt này.

**`.xlsx` cắt theo HÀNG, không theo ô.** Một hàng là một bản ghi có nghĩa
(tên hàng | giá | bảo hành). Gộp cả sheet thành một khối chữ là mất cấu trúc,
tách từng ô là mất quan hệ.

**Chồng lấn để MẶC ĐỊNH THẤP (10%).** Nghiên cứu 1/2026 đo được chồng lấn không
có lợi ích rõ rệt trên SPLADE + Mistral-8B. Vẫn để chỉnh được vì kho của người
dùng khác corpus benchmark.

## File

**Tạo:**
- `src/knowledge/doc-text-extract.ts` - điều phối theo định dạng
- `src/knowledge/extract-docx-text.ts` - `word/document.xml` -> chữ
- `src/knowledge/extract-xlsx-text.ts` - `sharedStrings.xml` + sheet -> chữ theo hàng
- `src/knowledge/extract-pdf-text.ts` - bọc `unpdf`
- `src/knowledge/chunk-text.ts` - cắt đoạn
- test cho từng file trên

**Sửa:**
- `package.json` - thêm `unpdf`

`boDauTiengViet` và cột `phang` đã xong ở phase 01 - phase này KHÔNG đụng
`kb-chunk-store.ts`.

## Giao diện

**Consumes:** `DoanMoi` (phase 01) - `catThanhDoan` trả về đúng hình dạng đó để
đưa thẳng vào `luuDoan`.

**Produces:**

```ts
// doc-text-extract.ts
export const DINH_DANG_HO_TRO = ["txt", "md", "docx", "xlsx", "pdf"] as const;
export type DinhDangKb = (typeof DINH_DANG_HO_TRO)[number];
export function laDinhDangHoTro(x: string): x is DinhDangKb;
/** Ném lỗi có câu tiếng Việt đọc được khi file hỏng - caller ghi vào `kb_sources.loi` */
export function docChuTuFile(buf: Buffer, dinhDang: DinhDangKb): Promise<string>;

// chunk-text.ts
export type ThamSoCat = { coDoanToiDa: number; chongLan: number };
export function catThanhDoan(chu: string, p: ThamSoCat): { thuTu: number; tieuDe: string; noiDung: string }[];
```

## Tham số vào trang Cấu hình

Thêm nhóm `kb` vào `src/config/tuning-definitions.ts` và schema Zod ở
`src/config/env.ts` (kèm `.default()`), KHÔNG thêm vào `.env.example`:

| Key | Mặc định | Min-Max | Nhãn |
|---|---|---|---|
| `KB_CHUNK_CHARS` | 1600 | 400-4000 | Độ dài mỗi đoạn |
| `KB_CHUNK_OVERLAP_PERCENT` | 10 | 0-50 | Phần chồng lấn giữa hai đoạn |

1600 ký tự xấp xỉ 400 token với tiếng Việt (khoảng 4 ký tự/token) - đúng khoảng
chuẩn cho nội dung hỏi đáp.

## Các bước

- [ ] **B1: Cắt đoạn - test ranh giới tự nhiên**

```ts
it("cắt ở ranh giới đoạn văn, KHÔNG cắt giữa câu", () => {
  const chu = "Câu một dài dài dài.\n\nCâu hai cũng dài dài dài.";
  const d = catThanhDoan(chu, { coDoanToiDa: 30, chongLan: 0 });
  for (const x of d) assert.ok(!x.noiDung.trim().endsWith("dà"), "cắt giữa từ");
});

it("mỗi đoạn mang tiêu đề markdown gần nhất phía trên", () => {
  const chu = "# Chính sách đổi trả\n\nTrong vòng 7 ngày.\n\n# Bảo hành\n\n12 tháng.";
  const d = catThanhDoan(chu, { coDoanToiDa: 40, chongLan: 0 });
  const doanBaoHanh = d.find((x) => x.noiDung.includes("12 tháng"))!;
  assert.equal(doanBaoHanh.tieuDe, "Bảo hành");
});

it("đoạn dài hơn trần vẫn phải ra, không được nuốt mất", () => {
  const d = catThanhDoan("x".repeat(5000), { coDoanToiDa: 1000, chongLan: 0 });
  assert.equal(d.map((x) => x.noiDung).join("").length >= 5000 - d.length, true);
});

it("thứ tự đoạn liên tục từ 0", () => {
  const d = catThanhDoan("a\n\nb\n\nc", { coDoanToiDa: 3, chongLan: 0 });
  assert.deepEqual(d.map((x) => x.thuTu), d.map((_, i) => i));
});
```

- [ ] **B2: Đọc docx bằng `read-zip-entry` có sẵn**

Test dựng file docx THẬT bằng `renderDocx` của repo rồi đọc ngược lại - không
dùng fixture nhị phân chép tay:

```ts
it("đọc lại được chữ từ chính file docx do bot sinh ra", async () => {
  const buf = await renderDocx({ tieuDe: "Chính sách", khoi: [{ type: "paragraph", text: "Đổi trả trong 7 ngày" }] });
  const chu = await docChuTuFile(buf, "docx");
  assert.match(chu, /Đổi trả trong 7 ngày/);
});
```

- [ ] **B3: Đọc xlsx theo HÀNG**

```ts
it("mỗi hàng thành một dòng chữ, các ô nối bằng ' | '", async () => {
  const buf = await renderXlsx([{ ten: "Bảng giá", header: ["Món", "Giá"], rows: [[{kind:"text",value:"Cà phê"},{kind:"number",value:25000}]] }]);
  const chu = await docChuTuFile(buf, "xlsx");
  assert.match(chu, /Cà phê \| 25000/);
});
```

- [ ] **B4: Đọc PDF**

Cài `unpdf` (đã kiểm 08/08/2026: `1.8.0`, sửa lần cuối 24/07 nên qua được
`minimumReleaseAge: 1440`; KHÔNG có dependency runtime; không có script cài đặt
nên không phải thêm vào `allowBuilds`).

```bash
pnpm add unpdf
```

Fixture PDF **sinh ngay trong test**, không commit file nhị phân lạ vào repo.
PDF một trang chữ thuần viết tay được bằng cú pháp tối thiểu - dài khoảng 20
dòng, dùng `Tj` với font `Helvetica` chuẩn nên không phải nhúng font:

```ts
/**
 * PDF một trang tối thiểu, chữ ASCII. Truyền chuỗi rỗng thì ra trang KHÔNG có
 * toán tử vẽ chữ nào - đúng hình dạng của PDF quét ảnh nhìn từ phía trình đọc.
 * Bảng xref là ĐỘ LỆCH BYTE nên phải cộng dồn khi ghép, không ghi số cứng.
 */
function pdfMotTrang(chu: string): Buffer {
  const noiDungTrang = chu ? `BT /F1 12 Tf 72 720 Td (${chu}) Tj ET\n` : "";
  const obj = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>",
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    `<</Length ${noiDungTrang.length}>>\nstream\n${noiDungTrang}endstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const lech: number[] = [];
  obj.forEach((than, i) => {
    lech.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${than}\nendobj\n`;
  });

  const lechXref = pdf.length;
  pdf += `xref\n0 ${obj.length + 1}\n0000000000 65535 f \n`;
  for (const v of lech) pdf += `${String(v).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<</Size ${obj.length + 1}/Root 1 0 R>>\nstartxref\n${lechXref}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");  // latin1: 1 ký tự = 1 byte, độ lệch xref mới đúng
}

it("đọc được chữ từ PDF", async () => {
  const ra = await docChuTuFile(pdfMotTrang("Bao hanh 12 thang"), "pdf");
  assert.match(ra, /Bao hanh 12 thang/);
});

it("PDF hỏng thì ném lỗi có câu tiếng Việt đọc được, không ném lỗi thư viện thô", async () => {
  await assert.rejects(() => docChuTuFile(Buffer.from("khong phai pdf"), "pdf"), /không đọc được/i);
});

it("PDF không có lớp chữ (ảnh quét) báo ĐÚNG BỆNH, không báo chung chung", async () => {
  // `unpdf` trả chuỗi rỗng chứ không ném - nhánh này phải tự nhận ra
  await assert.rejects(() => docChuTuFile(pdfMotTrang(""), "pdf"), /ảnh quét/i);
});
```

Nếu `unpdf` không chịu bản PDF viết tay này (đã tính trước: pdfjs khá dễ tính
với PDF thiếu chuẩn, nhưng không dám chắc 100%), phương án hai là dùng chính
`unpdf` đọc một PDF do trình duyệt/Word xuất ra rồi commit file đó - nhưng thử
đường sinh-trong-test TRƯỚC vì nó không để lại nhị phân lạ trong repo.

Chữ trong fixture để **không dấu**: mục đích của test này là kiểm đường đọc
PDF, không phải kiểm mã hóa font tiếng Việt. Nhúng font Unicode vào PDF viết
tay là một bài riêng và sẽ làm test hỏng vì lý do không liên quan.

- [ ] **B5: `pnpm typecheck` + `pnpm test`**

- [ ] **B6: Phá code kiểm 4 chốt**

| Phá gì | Test phải đỏ |
|---|---|
| `catThanhDoan` cắt cứng theo số ký tự | "KHÔNG cắt giữa câu" |
| Không gắn tiêu đề vào đoạn | "mang tiêu đề markdown gần nhất" |
| xlsx nối mọi ô thành một khối | "mỗi hàng thành một dòng" |
| PDF hỏng ném thẳng lỗi thư viện | "câu tiếng Việt đọc được" |

- [ ] **B7: Commit**

```
feat(kb): đọc 5 định dạng file và cắt đoạn theo ranh giới tự nhiên
```

## Định nghĩa hoàn thành

- 5 định dạng đọc ra chữ, có test cho từng định dạng.
- Đoạn mang tiêu đề gần nhất.
- Hai tham số hiện trên trang Cấu hình.
- 4/4 phép phá đỏ đúng chỗ.

## Rủi ro

| Rủi ro | Chặn thế nào |
|---|---|
| `unpdf` kéo theo cây phụ thuộc lớn | Đã kiểm: 0 dependency runtime, bundle sẵn pdfjs, 2.1MB |
| PDF quét ảnh (scan) không có lớp chữ -> ra rỗng | Ra rỗng thì đặt trạng thái `hong` kèm câu "PDF này là ảnh quét, chưa đọc được chữ" - phase 05 hiện lên dashboard |
| File khổng lồ làm nghẽn tiến trình (node:sqlite đồng bộ) | Trần dung lượng ở phase 05 |

## Bước tiếp

Phase 03 truy vấn các đoạn vừa cắt.
