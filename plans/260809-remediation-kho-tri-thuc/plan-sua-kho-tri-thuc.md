# Sửa Kho tri thức sau vòng rà soát toàn nhánh lần 2

> **Cho người thực thi:** dùng `superpowers:subagent-driven-development`. Mỗi
> phase một commit riêng, có phá code kiểm chốt và một lượt subagent rà soát
> trước khi sang phase sau.

**Mục tiêu:** đóng 5 lỗi Critical và 23 lỗi Important mà ba lăng kính rà soát đã
đo được trên nhánh Kho tri thức, và làm đúng chuẩn theo hai bản nghiên cứu.

**Nhánh:** `main`, HEAD `853d260`, 15 commit chưa push. Đợt này nối tiếp lên đó.

**Danh sách đầy đủ:** [`danh-sach-phai-sua.md`](danh-sach-phai-sua.md) - 5 Critical,
23 Important, 18 Minor, kèm 2 lỗi của controller.

**Nghiên cứu nền:**
- [`reports/nghien-cuu-doc-ooxml-an-toan.md`](reports/nghien-cuu-doc-ooxml-an-toan.md) (1050 dòng)
- [`reports/nghien-cuu-injection-worker-rag.md`](reports/nghien-cuu-injection-worker-rag.md) (855 dòng)

## Ba quyết định người dùng đã chốt

| Việc | Chốt |
|---|---|
| Ngân sách tra kho | **Rộng rãi**: `KB_MAX_RESULT_CHARS=8000`, `KB_TOP_K=5`, `KB_CHUNK_CHARS=1200` |
| Worker tranh CPU với bot | **Không chặn gì** - chấp nhận bot chậm đi lúc trích xuất |
| Bộ eval chất lượng tra cứu | **Để sau**, khi đã có tài liệu thật trên dashboard |

## Quyết định kỹ thuật đã chốt (từ nghiên cứu)

- **Đọc OOXML bằng SAX + tự viết phần ngữ nghĩa**, giải nén THEO LUỒNG nạp chunk
  vào parser. Tự viết quét tuyến tính sai 5/5 ca biên (dấu `>` trong thuộc tính,
  comment, CDATA, thực thể, prefix khác); `htmlparser2` bậc hai theo độ sâu lồng
  thẻ; `mammoth` treo >200 giây trước file 1,7 KB; `exceljs` đọc tốn 949 MB RSS
  cho file 8,46 MB trong khi container chỉ có 768M.
- **Dependency mới: `saxes@6.0.0`** (ISC, xuất bản 2021-11-07, 1 dep runtime
  `xmlchars` MIT 0 dep, 164 KB, không native binding, types sẵn có). Chọn nó thay
  vì `sax@1.6.1` vì tự mang types và ở chế độ XML nghiêm ngặt - ta đang đọc XML,
  không phải HTML. `npm audit` sạch cả hai.
- **Ranh giới chống injection đổi sang nonce ngẫu nhiên mỗi lần gọi.** Đo được
  9/11 payload vô hình lọt bộ khử hiện tại; nonce là phương án duy nhất chặn cả
  11 mà không đụng một byte nội dung. KHÔNG lọc `\p{Cf}` toàn cục, KHÔNG NFKC lên
  nội dung - đo được nó phá emoji ZWJ, cờ vùng, tiếng Ba Tư, `½ ﬁ m²`, dấu câu
  tiếng Trung. KHÔNG áp datamarking (gấp đôi token, cản trích nguyên văn).
- **Không JSON-encode kết quả tool.** Nonce đã đủ; JSON-encode đổi hình dạng kết
  quả mà nhiều test đang khẳng định, lợi ích thêm không tương xứng.
- **Lọc dải Tags U+E0000-E007F ở tầng nạp.** Đây là dải "ASCII smuggling", không
  có chữ hợp lệ nào dùng nó ngoài cờ vùng con (Anh, Scotland, Wales) - không liên
  quan tới bot tiếng Việt.
- **Trích xuất chạy trong `node:worker_threads`, luồng chính ghi DB.** Đo được
  `worker.terminate()` CẮT ĐƯỢC vòng lặp CPU đồng bộ trong 2,2 ms; boot 30 ms;
  `child_process.fork` tốn 53,5 MB nên loại. Đặt timeout cho code đồng bộ trên
  cùng luồng thì KHÔNG làm được - đây là lý do bắt buộc phải có worker.
- **Breadcrumb `H1 > H2 > H3` + tên nguồn vào cột `phang`**, một cột thay vì ba
  cột có trọng số (đo được lợi ích ba cột là không có, mà phải DROP/CREATE lại
  bảng ảo). KHÔNG làm Contextual Retrieval - Anthropic tự nói kho dưới 200k token
  thì đừng dùng.

## Ràng buộc toàn cục

- File code < 200 dòng, kebab-case, tên tự mô tả. Markdown miễn.
- Chuỗi tiếng Việt GIỮ NGUYÊN DẤU - kể cả nhãn UI, thông báo lỗi, commit message.
  Chỉ dùng dấu câu ASCII.
- **Ghi commit message qua tool Write rồi `git commit -F file`** - heredoc trong
  Bash làm hỏng UTF-8, năm agent đã dính.
- Test chạm DB: `setupTestEnv()` TRƯỚC rồi mới `await import()` ĐỘNG.
- Tham số chỉnh nóng vào `src/config/tuning-definitions.ts` + Zod `src/config/env.ts`
  kèm `.default()`. KHÔNG thêm vào `.env.example` / `.env.production.example`.
- Tool KHÔNG ném lỗi ra agent loop - mọi nhánh hỏng bọc `ketQuaLoi(...)`.
- Mọi ghi đĩa trong `dataDir`; container `read_only: true`, RAM 768M, `cpus: "1"`.
- Dependency mới được phép: `saxes` (và `@types/*` nếu cần). Không gì khác.
- `pnpm typecheck` (cả `-p web`) và `pnpm test` phải xanh trước khi báo xong phase.

## Luật riêng cho đợt này

**Mỗi test sửa hoặc thêm phải chứng minh ĐƯỜNG CODE CẦN ĐO thật sự được chạy.**
Đợt trước có TÁM ca test hụt, trong đó ca cuối là một test đã được sửa KHẲNG ĐỊNH
mà không sửa ĐẦU VÀO, nên hàm cần đo không được gọi lần nào và controller duyệt
qua. Với mỗi phép phá: nói rõ đường code nào chạy, và vì sao khẳng định lật.

## Các phase

| # | Phase | Đóng lỗi | Trạng thái |
|---|---|---|---|
| 01 | [Đọc OOXML an toàn](phase-01-doc-ooxml-an-toan.md) | C1, D, E, I15, trần bộ nhớ C4 | chưa làm |
| 02 | [Worker chịu độc](phase-02-worker-chiu-doc.md) | C2, C3, I4, I5, I6, I7, I8 | chưa làm |
| 03 | [Ranh giới chống injection](phase-03-ranh-gioi-chong-injection.md) | C5, I12, I13, + `memory-prompt-block` | chưa làm |
| 04 | [Chất lượng tra cứu](phase-04-chat-luong-tra-cuu.md) | I1, I2, I3, ràng buộc chéo | chưa làm |
| 05 | [Chống lạm dụng API và test](phase-05-chong-lam-dung-va-test.md) | I9, I10, I11, I14, I16 | chưa làm |
| 06 | [Dashboard](phase-06-dashboard.md) | I17, I18, I19, I20, I21 | chưa làm |
| 07 | [Tài liệu và mục nhỏ](phase-07-tai-lieu-va-muc-nho.md) | I22, I23, 18 Minor | chưa làm |

## Phụ thuộc

```
01 (đọc OOXML)  ---> 02 cần bộ đọc mới để chạy trong worker
     |
     +--- 02 (worker)  ---> 04 cần vòng nạp ổn định để đo lại tra cứu
     |
03 (ranh giới)   ---> độc lập, làm lúc nào cũng được
     |
04 (tra cứu)     ---> 06 hiện đoạn đã cắt cần breadcrumb đã đúng
     |
05 (API + test)  ---> độc lập
     |
06 (dashboard)   ---> cần 04 xong
     |
07 (tài liệu)    ---> cuối cùng, số liệu phải khớp trạng thái cuối
```

## Ngoài phạm vi đợt này

- **Lớp vector/embedding.** Vẫn chờ bộ eval trên tài liệu thật (người dùng đã
  chốt để sau).
- **Sửa nội dung nguồn tại chỗ** (phase 06 chỉ thêm cảnh báo khi xóa và trang xem
  đoạn đã cắt; đường sửa tại chỗ ghi roadmap).
- **Ngày tháng xlsx** (số serial + numFmt) và **cascade heading nhiều cấp cho
  docx** - nghiên cứu đề nghị tách việc riêng.
- **Chống bom chồng lấn entry (Fifield)** - nghiên cứu chưa kiểm `read-zip-entry.ts`
  có chống chưa; ghi roadmap để kiểm riêng.

## Rủi ro của chính đợt sửa này

| Rủi ro | Cách chặn |
|---|---|
| Viết lại bộ đọc làm hỏng đường GHI docx/xlsx của bot | `read-zip-entry.ts` dùng chung; phase 01 phải chạy lại test của `render-docx`/`render-xlsx` |
| Nonce phá test đang khẳng định tên thẻ cố định | Phase 03 phải sửa cả test; đếm trước số test chạm `noi_dung_ngoai` |
| Worker thread làm `node:sqlite` mở hai connection | Worker CHỈ trích xuất và cắt đoạn, luồng chính ghi DB - bất biến một connection giữ nguyên |
| Đổi mặc định tuning làm eval sẵn có đỏ | Chạy `pnpm test` sau phase 04; `pnpm eval` gọi model thật nên chỉ chạy khi người dùng yêu cầu |
| Sửa 7 phase liên tiếp làm trôi mất mục | `danh-sach-phai-sua.md` là danh sách chốt; phase 07 phải rà lại từng mục |
