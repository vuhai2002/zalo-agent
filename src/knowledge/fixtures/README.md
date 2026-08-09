# Fixture Office thật - ĐÓNG BĂNG, KHÔNG REGENERATE

3 file trong thư mục này do **Microsoft Word/Excel thật** ghi ra (Office 365,
build 16.0.20228.20158, COM automation trên máy dev), không phải do repo tự
sinh. Mục đích: bộ test `extract-docx-text.test.ts`/`extract-xlsx-text.test.ts`
trước đây chỉ đọc file do chính `renderDocx`/`renderXlsx` của repo tạo ra, nên
không bao giờ chạm được các ca biên mà chỉ Word/Excel thật mới ghi (tab stop,
ô rỗng tự đóng, `<w:p/>` tự đóng...). Xem
`plans/260809-remediation-kho-tri-thuc/reports/nghien-cuu-doc-ooxml-an-toan.md`
mục 4 cho toàn bộ quá trình tạo + căn cứ pháp lý.

## Vì sao chỉ 2 docx + 1 xlsx (không phải đúng nguyên "1 docx + 1 xlsx")

Brief gốc đề xuất "chọn MỘT .docx + MỘT .xlsx". Kiểm tra thực tế 4 file docx
nghiên cứu đã tạo (`word-com-min`, `word-rich-1`, `word-table`, `word-tabstop`)
cho thấy MỖI file chỉ mang ĐÚNG MỘT ca biên (tab stop CHỈ có trong
`word-tabstop.docx`; bảng + `<w:p/>` tự đóng CHỈ có trong `word-table.docx`) -
không file nào gồm đủ cả hai. Vì B3/B10 trong phase brief đòi hỏi cả hai ca
biên này trên FILE THẬT (không được thay bằng XML tự chế), buộc phải giữ 2
file docx thay vì 1. Đã chọn 2 file NHỎ NHẤT đủ điều kiện thay vì cả 4 file
nghiên cứu đã tạo, giữ đúng tinh thần "Chọn file nhỏ nhất còn đủ ca biên" của
brief.

## Danh sách file

| File | Byte | Nội dung | Ca biên chứng minh |
|---|---|---|---|
| `word-tabstop.docx` | 13.482 | Đoạn văn "Ca phe" + 2 tab stop định nghĩa trong `w:pPr><w:tabs>` + 2 ký tự tab thật trong `w:r`, chữ tiếng Việt không dấu (nội dung test tự gõ, không phải lỗi dịch) | Bug đã đo: `<w:tab w:val="left" w:pos="2880"/>` khớp nhầm `<w:t[^>]*>` của regex cũ, tab-định-nghĩa bị đọc thành XML thô lẫn vào kết quả |
| `word-table.docx` | 13.776 | Đoạn văn có `xml:space="preserve"` (khoảng trắng đầu/cuối) + bảng 2x2 (hàng 1 có chữ "Tên"/"Số", hàng 2 là 2 ô RỖNG tự đóng dạng `<w:p/>`) + 1 `<w:p/>` tự đóng ở cuối body | Bug đã đo: `PARAGRAPH_RE` coi `<w:p/>` là thẻ MỞ (nuốt dấu `/`) rồi quét tới `</w:p>` kế tiếp; bảng mất cấu trúc hàng khi đọc theo từng `<w:p>` riêng lẻ |
| `excel-o-rong-co-dinh-dang.xlsx` | 8.988 | Bảng "Mon / (ô trống, tô nền) / Gia", hàng 2 "Ca phe / (trống) / 25000". Ô B tự đóng `<c r="B1" s="1"/>`, KHÔNG có `<v>` | Bug đã đo: `CELL_RE` tham lam nuốt dấu `/` của ô tự đóng, mất hẳn cột C và lộ INDEX sharedString (số "1") ra ngoài thay vì tên thật |

## Tạo bằng gì, tạo thế nào

- Microsoft Office 365 (`O365HomePremRetail`), build `16.0.20228.20158`, x64.
- COM automation **late-binding** (`[Type]::GetTypeFromProgID` + `InvokeMember`)
  từ PowerShell trên máy dev - early-binding (`New-Object -ComObject`) hỏng với
  bản cài AppX/Store.
- Bắt đầu từ **Blank document/Workbook**, **KHÔNG nhúng font**, **KHÔNG dùng
  template/theme/clipart tải từ Office.com** - nội dung tự gõ, tầm thường,
  bảng tiếng Việt (có dấu và không dấu tùy file) đúng ngữ cảnh dự án.

## Căn cứ pháp lý được tạo hợp pháp

- Microsoft Services Agreement: *"We don't claim ownership of Your Content."*
  Không điều khoản nào đòi quyền trên output của phần mềm.
- Án lệ *Design Data Corp. v. Unigate Enterprise*, 847 F.3d 1169 (9th Cir.
  2017): chủ bản quyền phần mềm KHÔNG sở hữu file output do người dùng tạo
  (luật liên bang Mỹ, không phải tư vấn pháp lý).
- Tiền lệ mạnh nhất: `python-docx` ship `default.docx` (file Word nguyên bản,
  đủ `styles.xml`/`theme1.xml`/`docProps`) dưới MIT suốt 12 năm, hàng chục
  triệu lượt tải, chưa từng bị khiếu nại.

## TUYỆT ĐỐI KHÔNG regenerate

Office **KHÔNG byte-deterministic** - lưu 2 lần cùng nội dung ra 2 file khác
nhau (do `xr:uid`/`w:rsidR`/`w14:paraId` sinh ngẫu nhiên mỗi lần lưu). Sinh lại
file này sẽ tạo diff nhiễu vô nghĩa và có thể vô tình đổi nội dung đang được
test dựa vào (ví dụ độ dài chuỗi "Ca phe\tGia 25000..."). Fixture là artifact
**đóng băng**, sửa nội dung = tạo file MỚI với tên mới, không ghi đè lên file cũ.

## Không commit XML đã giải nén

Đã đo: XML thô đủ dùng (3 phần tối thiểu, thiếu `styles.xml`) to gấp 3,5 lần
bản zip nén, và thiếu `styles.xml` làm mất định dạng heading (`Heading1` tụt
về `Normal`). Giữ nguyên dạng binary là đúng 100% byte Word/Excel đã ghi.
