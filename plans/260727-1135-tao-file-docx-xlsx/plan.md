# Tool tạo file .docx và .xlsx cho bot Zalo

## Bối cảnh

User hỏi bot có tạo được file Word/Excel không. Đã đo thật (xem
`reports/nghien-cuu-llm-tra-file-va-thu-vien.md`): **LLM API chỉ trả text**, cả
DeepSeek trực tiếp lẫn qua 9Router đều không có kênh file. IDE code tạo được file
là vì IDE **chạy code** model viết ra - đường đó không dùng được cho bot Zalo (đọc
tin người lạ, không ai duyệt lệnh).

Lời giải: **bot tự dựng file**, model chỉ cung cấp nội dung có cấu trúc. Chất lượng
("đẹp") lấy từ know-how trong skill `docx`/`xlsx` của Anthropic - nhưng nhét vào
**renderer của bot** thay vì vào prompt, nên chất lượng cố định, model không làm hỏng được.

## Nguyên tắc chốt trước khi code

1. **Không exec, không sandbox.** Tool nhận DỮ LIỆU (tiêu đề, đoạn văn, bảng),
   không nhận code. Đây là ranh giới an toàn quan trọng nhất.
2. **Schema trung gian, không lộ API thư viện.** Model gửi shape đơn giản của
   mình; đổi thư viện sau này không phải sửa prompt hay schema.
3. **Quy ước định dạng nằm trong renderer.** Model không quyết font/màu/lề.
4. **Tự gửi + tự xóa.** Tool tạo xong gửi luôn qua đường rate-limiter sẵn có rồi
   xóa file tạm (`withTempFile`), không để lại rác.

## Thư viện (đã spike thật trên Node 24 + ESM, xem report)

| Việc | Thư viện | Vì sao |
|---|---|---|
| .docx | `docx` 9.7.1 (MIT) | Chính thư viện skill Anthropic + GoClaw + Hermes đều dùng. Deps thuần JS, cập nhật 2026-05 |
| .xlsx | `exceljs` 4.4.0 (MIT) | **Thư viện duy nhất ghi được GIÁ TRỊ CACHE cho công thức** - thứ quyết định preview có hiện số hay ô trống. `write-excel-file` nhẹ hơn 12 lần nhưng 0/3 ô có cache và còn ghi sai chuẩn (`<f>=A2*B2</f>` thừa dấu `=`) |

## Hai câu hỏi lớn đã trả lời bằng đo đạc

**Có cần LibreOffice để recalc không? KHÔNG.** Skill Anthropic phải chạy LibreOffice
vì `openpyxl` không ghi được giá trị cache. `exceljs` cho truyền thẳng
`{ formula, result }`, mà bot tự biết result - chính nó sinh ra dữ liệu. Tiết kiệm
~1GB dependency hệ thống và 1-3 giây mỗi lần gọi tiến trình con.

**Zalo có chặn .docx/.xlsx không? KHÔNG.** Cơ chế chặn là `restricted_ext_file` -
danh sách cấm do server Zalo trả về. Đo thật: `.exe` bị chặn ngay
(`'File extension "exe" is not allowed'`), `.docx`/`.xlsx` qua được cửa kiểm.

## Các phase

| Phase | Nội dung | Trạng thái |
|---|---|---|
| [01](phase-01-schema-va-gioi-han.md) | Schema tài liệu + giới hạn an toàn + env | Chưa làm |
| [02](phase-02-renderer-docx.md) | Renderer .docx (áp gotcha skill) | Chưa làm |
| [03](phase-03-renderer-xlsx.md) | Renderer .xlsx (áp quy ước skill) | Chưa làm |
| [04](phase-04-tool-va-tich-hop.md) | 2 tool + registry + gửi file + dashboard | Chưa làm |
| [05](phase-05-test-va-tai-lieu.md) | Test đọc-ngược-file + docs | Chưa làm |

## Phụ thuộc

- Phase 02, 03 độc lập nhau, đều cần Phase 01 xong trước.
- Phase 04 cần cả 02 và 03.
- Phase 05 chạy cùng lúc với mọi phase (test viết ngay khi có renderer), chốt ở cuối.

## Định nghĩa hoàn thành

- Gửi tin "làm báo giá 3 món gửi file Word" -> nhận được `.docx` mở lên đẹp.
- Gửi tin "xuất Excel bảng đó" -> nhận `.xlsx` có formula thật, mở Excel tính lại được.
- Tool tắt được per account ở trang Tools; không có sidecar/dep nào phải cài thêm ngoài 2 npm package.
- `pnpm typecheck` sạch, test pass, không file nào vượt ~200 dòng.
