# Phase 07 - Tài liệu và các mục nhỏ

**Ưu tiên:** trung bình. Dự án này coi tài liệu nói sai là lỗi nặng - đã có BỐN
chỗ bị bắt qua hai vòng rà soát.
**Trạng thái:** chưa làm. **Cần:** tất cả các phase trước (số liệu phải khớp trạng
thái cuối).

## Bối cảnh

- File: `README.md`, `README.en.md`, `CHANGELOG.md`, `docs/project-roadmap.md`,
  `docs/system-architecture.md`, `docs/deployment-guide.md`,
  `docs/vps-setup-checklist.md`, `CLAUDE.md`, và 7 file trong
  `plans/260808-2354-knowledge-base-tra-cuu-tai-lieu/`.
- Danh sách gốc: [`danh-sach-phai-sua.md`](danh-sach-phai-sua.md).

## Việc chính: rà lại TOÀN BỘ danh sách

Trước khi làm gì khác, mở `danh-sach-phai-sua.md` và đi qua từng mục trong cả ba
nhóm (5 Critical, 23 Important, 18 Minor). Với mỗi mục, ghi vào report một trong
ba:

- **ĐÃ SỬA** ở phase nào, commit nào
- **CÒN LẠI, làm ở phase này**
- **HOÃN**, kèm lý do và đã ghi vào roadmap chưa

Sáu phase trước chạy liên tiếp nên đây là chốt duy nhất bắt được mục bị trôi.
Không được bỏ qua bước này.

## Lỗi tài liệu phải đóng

| Mã | Chỗ | Lỗi |
|---|---|---|
| I22 | `docs/project-roadmap.md:3914` | "126 test mới (1661 -> 1787), phase 05 +39" trong khi README CÙNG COMMIT ghi 1793 |
| I23 | `plans/260808-.../plan.md:68`, `phase-03:32,128,209`, `reports/...:123` | vẫn ghi "3/4" và "TRƯỢT" trong khi code khẳng định 4/4 |

Cộng các mục Minor về tài liệu:

- `CHANGELOG.md:20-21` "kiểm magic bytes, không tin đuôi tên" - KHÔNG đúng cho
  txt/md (chúng không có chữ ký cố định). Comment trong code trung thực hơn tài liệu.
- README vi/en: cây thư mục `src/` thiếu hẳn `knowledge/` (15+ file).
- `kb-ingest-worker.ts` comment dẫn nguồn số đo là `.superpowers/...` - thư mục
  không được git theo dõi, người clone không kiểm chứng được. Chép số vào comment
  hoặc vào roadmap.
- Số đo chặn nhịp bot phụ thuộc SỐ ĐOẠN chứ không phải SỐ BYTE (đo: 20MB tài liệu
  thường 1629 ms; 20MB dày tiêu đề 15161 ms). Roadmap và CHANGELOG đang diễn đạt
  thuần theo MB.
- `docs/system-architecture.md` chưa có MỘT CHỮ nào về Kho tri thức, trong khi
  README giới thiệu file đó là "thiết kế và lý do từng quyết định kỹ thuật".
- `docs/deployment-guide.md:140-142` và `docs/vps-setup-checklist.md:95-97` liệt
  kê thư mục dữ liệu còn thiếu `kb/`.
- `plans/260808-.../phase-05:76` mô tả bước 1 là `datTrangThai(...)`; code dùng
  `giaNguonChoXuLy`. Code tốt hơn plan nhưng plan đã đánh "XONG" mà không cập nhật.

## Các mục nhỏ về code

Làm nếu rẻ, hoãn nếu không - ghi rõ lựa chọn:

- `index.ts` TDZ: `shutdown()` tham chiếu `const stopKbIngestWorker` khai sau.
  (Phase 02 có thể đã sửa lúc đảo thứ tự - kiểm lại.)
- `tuning-group-icon.tsx` nhóm `kb` trùng icon với nhóm `documents`.
- `agent-kb-sources-section.tsx` ba cách gọi cho một thao tác (tick / gạt / bật tắt).
- `GET /api/kb/sources` trả cả `duongDan` dù giao diện không dùng.
- `POST /sources/text` và `/reindex` dội nguyên `noiDungGoc` về client.
- File .zip đổi tên thành .docx báo `Không tìm thấy "word/document.xml"` - câu của
  lập trình viên, đổi thành câu người vận hành đọc được.
- `db-transaction.ts` chữ ký không chặn callback `async`.
- `prompt-leak-markers.ts` - tài liệu KB chứa `TIEU_DE_QUY_TAC_AN_TOAN` làm CHẶN
  cả câu trả lời, bot im lặng không ai hiểu vì sao. Cần ít nhất một dòng log.
- Trang TẠO agent không truyền `agentId` nên rơi vào quy ước `id === ""` ->
  `coNguonNao()`; kho có nguồn thì trang tạo hiện `kb_search` "dùng được" dù agent
  mới chắc chắn chưa gán gì.

## Các bước

- [ ] **B1: Rà toàn bộ `danh-sach-phai-sua.md`, ghi bảng ba cột vào report**

- [ ] **B2: Đếm lại MỌI con số bằng máy, không chép**

```bash
pnpm test 2>&1 | tail -8          # số test thật
```

Đếm số công cụ từ `TOOL_KEYS`, số tham số từ `TUNING_DEFS`, số file và số dòng
`.ts`/`.tsx` (loại `*.test.*`). Ghi lệnh đã dùng vào report để người sau đếm lại
được.

- [ ] **B3: Đồng bộ README vi và en**

Hai file phải khớp nhau từng con số. Vòng rà soát đã bắt ca `README.en.md` không
được đụng dòng nào trong khi bản tiếng Việt đã cập nhật - lệch 225 test.

- [ ] **B4: Sửa roadmap, CHANGELOG, và 4 chỗ "3/4 TRƯỢT" trong plan cũ**

Với plan cũ: thêm dòng đính chính TẠI CHỖ trỏ sang roadmap, KHÔNG viết lại phần
nghiên cứu gốc - nó là bản ghi lịch sử của thời điểm đó.

- [ ] **B5: Viết mục Kho tri thức cho `docs/system-architecture.md`**

Theo đúng định dạng các mục sẵn có trong file. Nội dung tối thiểu: 3 bảng + 1 bảng
ảo FTS5, worker thread trích xuất và lý do bắt buộc phải có nó, thư mục `kb/` trên
đĩa, đường đi từ upload tới câu trả lời, và các trần đã đặt kèm căn cứ.

- [ ] **B6: Cập nhật `CLAUDE.md` mục "Quyết định đã chốt"**

Những quyết định của đợt này đáng ghi vì chúng đắt để tìm lại:
- Đọc OOXML bằng SAX theo luồng, KHÔNG regex bắt cặp thẻ (kèm số đo 38 giây).
- Trích xuất chạy trong worker thread vì timeout cho code đồng bộ cùng luồng là
  không làm được; `terminate()` cắt được vòng lặp CPU trong 2,2 ms.
- Ranh giới nội dung ngoài dùng nonce; KHÔNG lọc `\p{Cf}` toàn cục vì nó phá emoji
  ghép, cờ, tiếng Ba Tư.
- Bộ đếm lần thử tăng TRONG câu UPDATE giành nguồn, không ở nhánh catch.
- Ràng buộc chéo ngân sách tra kho.

Viết ngắn, mỗi mục một tới hai câu, nêu LÝ DO chứ không chỉ nêu việc.

- [ ] **B7: Cập nhật `deployment-guide.md` và `vps-setup-checklist.md`**

Thư mục dữ liệu giờ có `kb/`. Backup `tar` vẫn bao trọn nên không hỏng, chỉ là
liệt kê thiếu.

- [ ] **B8: Ghi các mục HOÃN vào roadmap**

Mục "Việc còn treo của Kho tri thức" đã có từ đợt trước - cập nhật nó, xóa mục nào
đã sửa ở đợt này, thêm mục mới. Vòng rà soát trước đã kiểm 12/12 mục còn đúng;
giữ mức chính xác đó.

Ba mục nghiên cứu đề nghị tách việc riêng, phải có trong roadmap:
- Ngày tháng xlsx (số serial + numFmt).
- Cascade heading nhiều cấp cho docx.
- Kiểm `read-zip-entry.ts` có chống bom chồng lấn entry (Fifield) chưa.
- Bộ eval 20-30 cặp trên tài liệu thật (người dùng đã chốt để sau).

- [ ] **B9: `pnpm typecheck` + `pnpm test`, cập nhật con số cuối cùng**

- [ ] **B10: Commit**

```
docs(kb): đồng bộ số liệu hai README, viết mục kiến trúc, cập nhật việc còn treo
```

## Định nghĩa hoàn thành

- Mọi mục trong `danh-sach-phai-sua.md` có một trong ba nhãn, không mục nào trống.
- Mọi con số trong tài liệu đếm được bằng máy và khớp trạng thái cuối.
- README vi và en khớp nhau.
- `system-architecture.md` có mục Kho tri thức.
- `CLAUDE.md` ghi các quyết định đắt của đợt này kèm lý do.
- Roadmap phản ánh đúng việc còn treo.

## Rủi ro

| Rủi ro | Chặn thế nào |
|---|---|
| Sửa số ở một README quên README kia | B3 làm cả hai cùng lúc, có bảng đối chiếu trong report |
| Con số đổi lại sau khi commit phase này | Phase 07 là phase CUỐI; nếu còn phase sau thì dời B2/B3 xuống |
| Ghi roadmap mục đã sửa rồi | B8 kiểm từng mục với code thật, không chép danh sách cũ |

## Bước tiếp

Sau phase 07: vòng rà soát toàn nhánh lần ba trước khi hỏi người dùng có push không.
