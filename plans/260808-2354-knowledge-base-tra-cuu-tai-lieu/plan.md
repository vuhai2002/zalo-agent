# Kho tri thức: bot tra cứu tài liệu do người vận hành nạp lên

> **Cho người thực thi:** dùng `superpowers:subagent-driven-development` để làm
> từng phase. Mỗi phase là một commit riêng, có phá code kiểm chốt và một lượt
> subagent rà soát trước khi sang phase sau.

**Mục tiêu:** người vận hành nạp tài liệu lên dashboard (upload file hoặc gõ
tay), bot tra được nội dung đó khi khách hỏi. Nhiều nguồn, mỗi agent chỉ đọc
được nguồn nào đã bật cho nó.

**Kiến trúc:** nguồn -> cắt đoạn -> FTS5 (bm25) -> hợp nhất bằng RRF -> tool
`kb_search`. Cắt đoạn chứ không index cả tài liệu (goclaw index cả tài liệu và
tự ghi đó là hạn chế). Hợp nhất bằng RRF trên THỨ HẠNG chứ không trọng số cứng
trên điểm - để đợt sau thêm lớp vector chỉ là truyền thêm một danh sách.

**Công nghệ:** `node:sqlite` (đã có sẵn FTS5, không thêm dependency), `unpdf`
cho PDF, `read-zip-entry.ts` tự viết sẵn trong repo cho docx/xlsx, Hono cho
route, React cho tab dashboard. Một dependency mới duy nhất: `unpdf`.

**Nghiên cứu nền:** [`reports/nghien-cuu-kb-va-thong-so-chuan.md`](reports/nghien-cuu-kb-va-thong-so-chuan.md)

## Ràng buộc toàn cục

- File code < 200 dòng, kebab-case, tên tự mô tả. Markdown miễn.
- Chuỗi tiếng Việt GIỮ dấu; dấu câu ASCII.
- Env var mới: khai Zod trong `src/config/env.ts` kèm `.default()`. Tham số
  chỉnh nóng thì vào `src/config/tuning-definitions.ts` (tự hiện trên dashboard),
  KHÔNG thêm vào `.env.example`.
- Tool KHÔNG ném lỗi ra agent loop - mọi nhánh hỏng bọc `ketQuaLoi(...)`.
- Test chạm DB: gọi `setupTestEnv()` TRƯỚC rồi mới `await import()` động.
- File nguồn là LF (đã chốt ở `.gitattributes`).
- Mọi ghi đĩa nằm trong `dataDir` - container chạy `read_only: true`.
- `pnpm typecheck` và `pnpm test` phải xanh trước khi báo xong phase.

## Các phase

| # | Phase | Giao được gì | Trạng thái |
|---|---|---|---|
| 01 | [Lược đồ và kho nguồn](phase-01-luoc-do-va-kho-nguon.md) | 3 bảng thật + 1 bảng ảo FTS5, bỏ dấu, store CRUD, xóa sạch không bỏ mồ côi | Xong (1821dce) |
| 02 | [Đọc file và cắt đoạn](phase-02-doc-file-va-cat-doan.md) | 5 định dạng -> chữ thuần -> đoạn | Xong (cc8ce3b) |
| 03 | [Tìm kiếm FTS5 + RRF](phase-03-tim-kiem-fts5-va-rrf.md) | bỏ dấu, truy vấn MATCH an toàn, bm25, hợp nhất RRF | Xong (c283a18) |
| 04 | [Tool kb_search](phase-04-tool-kb-search.md) | tool + lọc theo agent + luật persona | Xong (2600eec) |
| 05 | [API và tab dashboard](phase-05-api-va-tab-dashboard.md) | upload, gõ tay, gán nguồn cho agent | Xong (169229d) |

Sau phase 05: cập nhật `docs/project-roadmap.md`, `CHANGELOG.md`, số test ở
`README.md`.

## Phụ thuộc giữa các phase

```
01 (bảng + store)
 |
 +-- 02 (đọc file + cắt đoạn)  ---> cần store để lưu đoạn
 |
 +-- 03 (tìm kiếm)             ---> cần đoạn đã lưu
      |
      +-- 04 (tool)            ---> cần hàm tìm kiếm
           |
           +-- 05 (dashboard)  ---> cần cả CRUD lẫn trạng thái xử lý
```

Phase 02 và 03 đều phụ thuộc 01 nhưng không phụ thuộc nhau - làm tuần tự cho
gọn, không cần song song.

## Ngoài phạm vi đợt này

- **Lớp vector/embedding.** RRF đã chừa sẵn chỗ; chỉ làm sau khi chạy thật và
  đo được tỉ lệ trượt. Đo nền: tìm theo từ khóa đúng 3/4 câu hỏi mẫu.
- **Đồng bộ thư mục tự động** (kiểu `VaultSyncWorker` của goclaw). Nguồn ở đây
  do người vận hành nạp qua dashboard, không có thư mục nào để theo dõi.
- **Liên kết giữa tài liệu** (`vault_links`, wikilink). Chưa có nhu cầu.
- **Phân quyền nhiều khách hàng** (`tenant_id`). Dashboard chỉ có một chủ; việc
  tách "agent nào đọc nguồn nào" đã đủ cho nhu cầu hiện tại.
- **Trần số nguồn / tổng dung lượng kho.** Chưa có số liệu thật để đặt ngưỡng;
  trần theo TỪNG FILE ở phase 05 đã chặn ca hỏng rõ ràng nhất.

## Rủi ro đã biết

| Rủi ro | Cách chặn |
|---|---|
| Cắt đoạn giữa câu làm mất nghĩa | Cắt theo ranh giới đoạn văn/tiêu đề, không cắt cứng theo số ký tự - phase 02 |
| Nội dung KB rò chỉ thị vào prompt | Bọc thẻ `<noi_dung_ngoai>` như web_fetch đang làm - phase 04 |
| Kết quả tool ăn hết cửa sổ token | Trần ký tự cho kết quả, đặt ở trang Cấu hình - phase 04 |
| Xóa nguồn bỏ lại dữ liệu mồ côi | Xóa trong một giao dịch, có test đếm cả 4 nơi - phase 01 |
| File upload phá đĩa hoặc thoát thư mục | Trần dung lượng + `sanitizeSegment` như `media-store.ts` - phase 05 |
