# Nghiên cứu: kho tri thức cho bot + thông số chuẩn của ngành

Ngày 08/08/2026. Đọc code thật của repo tham khảo, đo thật trên `node:sqlite`,
tra chuẩn ngoài cho phần mà không repo nào làm.

## 1. goclaw - Knowledge Vault

Nguồn: `docs/24-knowledge-vault.md` (556 dòng), `internal/vault/`, migration
`000038`, `000042`, `000043`, `000046`, `000048`, `000055`.

### Đáng học: mô hình phân quyền nguồn

| Cột | Vai trò |
|---|---|
| `tenant_id` | cách ly nhiều khách hàng |
| `agent_id` | không gian riêng của từng agent |
| `scope` | `personal` / `team` / `shared` / `custom` |

Luật đọc của agent: **doc của chính nó CỘNG doc `shared`**; trong ngữ cảnh team
thì thêm doc của team đó. Migration `000055` có `CHECK constraint`
(`vault_documents_scope_consistency`) ép bất biến scope x quyền sở hữu ngay ở
tầng DB thay vì tin vào code tầng trên.

### KHÔNG nên học: không cắt đoạn

`vault_documents` có **một** cột `embedding vector(1536)` cho **cả tài liệu**.
Grep `chunk` khắp `internal/` chỉ ra chỗ nén hội thoại (`loop_compact.go`),
không dính gì tới vault.

FTS của họ (migration `000042`) chỉ index:

```sql
to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(path,'') || ' ' || coalesce(summary,''))
```

`summary` là do LLM sinh (`UpdateSummaryAndReembed`). Họ tự ghi ở mục
Limitations: *"No full-text indexing on document content - Only title+path FTS;
content requires embeddings"*.

Hệ quả: PDF 50 trang thành MỘT vector của bản tóm tắt. Hỏi "phí ship nội thành
bao nhiêu" thì hoặc trúng cả tài liệu hoặc trượt cả tài liệu - không có đường
lấy đúng đoạn. **Không dùng được cho chăm sóc khách hàng.**

### Thông số cứng của họ

| Thông số | Giá trị | Nơi khai |
|---|---|---|
| Trọng số fan-out | vault 0.4 / episodic 0.3 / KG 0.3 | `DefaultSearchWeights()` trong `search.go` |
| `MaxResults` | 10 | `search.go`, lấy `maxResults * 2` mỗi nguồn rồi khử trùng |
| `RelevanceThreshold` | 0.3 | `RetrieverConfig` |
| `MaxL0Items` | 5 | `RetrieverConfig` |
| Debounce đồng bộ file | 500ms | `VaultSyncWorker` |
| Chỉ mục vector | HNSW, `m=16`, `ef_construction=64` | migration `000038` |

### Cách nạp: TOOL, không tự nhét

Hai tool: `vault_search` (tìm) và `vault_link` (nối tài liệu). Mục Limitations
ghi rõ: *"Vault docs do not auto-embed in system prompt - Must be retrieved via
agent tools"*.

## 2. Hermes - không có kho tài liệu

Chỉ có `MemoryProvider` cắm ngoài (`agent/memory_manager.py`), và **chỉ cho
đúng một** provider ngoài tại một thời điểm - lý do ghi trong docstring:
*"prevents tool schema bloat and conflicting memory backends"*.

Cơ chế: `prefetch_all(user_message)` trước lượt, `sync_all(user_msg, response)`
sau lượt, `build_system_prompt()` cho phần mô tả.

Đây là **bộ nhớ hội thoại**, không phải kho tài liệu upload.

### Hai trường phái nạp ngữ cảnh

| | goclaw | Hermes |
|---|---|---|
| Cách nạp | agent gọi tool | tự nhét trước lượt (`prefetch_all`) |
| Tốn token | chỉ khi cần | mọi lượt |
| Tốn bước | thêm 1 step | không |
| Prompt cache | giữ được | vỡ (đầu prompt đổi theo câu hỏi) |

**Chọn trường phái goclaw.** Lý do quyết định là prompt cache: repo này đã đầu
tư vào khóa phiên cache (`cache-session-id.ts`), tự nhét kết quả tìm kiếm vào
đầu prompt là phá chính khoản đầu tư đó, và tốn token cả những lượt người ta
chỉ chào hỏi.

## 3. Đo thật trên `node:sqlite`

### FTS5 có sẵn

```js
db.exec("CREATE VIRTUAL TABLE t USING fts5(noi_dung, tokenize='unicode61')");
// bm25() và snippet() đều chạy
```

Không phải thêm dependency nào.

### Tiếng Việt: `remove_diacritics 2` KHÔNG đủ

Đo: tokenizer `unicode61 remove_diacritics 2` vẫn không cho "doi tra" khớp
"đổi trả". Lý do: `đ` (U+0111) là **chữ cái riêng** có gạch ngang, không phải
dấu phụ tổ hợp - Unicode không coi đó là diacritic.

**Cách chữa đã đo được:** lưu thêm một cột "phẳng" đã bỏ dấu, index FTS trên
cột đó, và bỏ dấu cả câu hỏi trước khi tìm.

```js
const boDau = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
```

Sau khi bỏ dấu: "doi tra" -> trúng "Chính sách đổi trả". Repo đã có sẵn hàm
tương đương ở `web/src/shared/fold-for-search.ts` và `slugify-vietnamese.ts`
(cả hai đều ở phía web, cần một bản dùng chung ở `src/shared/`).

### Chất lượng tìm theo từ khóa - 4 câu hỏi kiểu khách hàng thật

Chế độ OR mọi từ (`"tu1" OR "tu2" ...`) rồi xếp hạng bằng `bm25()`:

| Câu hỏi | Kết quả |
|---|---|
| "phi ship noi thanh bao nhieu" | đúng, hạng 1 |
| "bảo hành bao lâu vậy shop" | đúng, hạng 1 |
| "đổi trả được không" | đúng, hạng 1 |
| "mấy giờ đóng cửa" | **TRƯỢT** |

Ca trượt đáng ghi: "đồng" (tiền) bỏ dấu thành "dong", trùng "đóng" bỏ dấu cũng
là "dong", nên đoạn phí vận chuyển bị đẩy lên trên đoạn giờ làm việc. Đây là
điểm yếu cố hữu của tìm theo từ khóa và là lý do lớp vector đáng có ở đợt sau.

> **Đính chính (không sửa lại bảng trên - đây là số đo TẠI THỜI ĐIỂM nghiên
> cứu này):** đo lại trên fixture thật của `kb-search.test.ts` cho ra **4/4**
> câu hỏi đúng hạng 1, kể cả "mấy giờ đóng cửa" - đoạn "Giờ làm việc" khớp BA
> từ khác nhau sau khi bỏ dấu ("gio", "dong" từ "đóng", "cua") nên thắng đoạn
> "Phí vận chuyển" (chỉ khớp một từ "dong" từ "đồng"). Va chạm bỏ dấu
> "đóng"/"đồng" vẫn là rủi ro CÓ THẬT về nguyên tắc, chỉ là CHƯA kích hoạt trên
> bộ 4 đoạn hiện có. Xem `docs/project-roadmap.md` mục 'Ca "mấy giờ đóng
> cửa"...' cho số đo đầy đủ và lý do thắng/thua.

### Embedding khả thi mà không đổi nhà cung cấp

9router có sẵn tầng embeddings: `open-sse/handlers/embeddingsCore.js` cộng các
provider Gemini, OpenAI, Jina, Mistral, Fireworks, Nebius, GitHub.

SQLite không có kiểu vector, nhưng **không cần pgvector**: lưu vector dạng BLOB
(`Float32Array`) rồi tính cosine trong JS. Vài nghìn đoạn x 1536 chiều là mili
giây - không đáng kể so với một lượt gọi model.

### Đọc file: đã có sẵn hơn tưởng

| Định dạng | Công cụ | Trạng thái |
|---|---|---|
| `.txt` / `.md` | - | không cần gì |
| `.docx` | `src/shared/read-zip-entry.ts` | **đã có**, đang chạy thật trong test |
| `.xlsx` | `src/shared/read-zip-entry.ts` | **đã có** |
| `.html` | `src/shared/html-to-text.ts` | **đã có** |
| `.pdf` | `unpdf` | phải thêm |

`.docx` và `.xlsx` đều là zip chứa XML, mà repo đã tự viết bộ đọc zip đi qua
central directory.

### Chưa có

Đường upload file lên dashboard. Grep cả `src/server` lẫn `web/src`: không có
multipart nào.

## 4. Thông số chuẩn ngoài ngành

Vì không repo tham khảo nào làm RAG cấp đoạn, phần này tra ngoài.

| Thông số | Chuẩn | Ghi chú |
|---|---|---|
| Cỡ đoạn | 400-512 token | FAQ: 200-400. Tài liệu kỹ thuật cần giữ trọn quy trình: 600-1200 |
| Chồng lấn | 10-20% | Nghiên cứu 1/2026 (SPLADE + Mistral-8B trên Natural Questions) đo được chồng lấn **không có lợi ích rõ rệt**, chỉ tăng chi phí index |
| Hợp nhất | **RRF**, `k=60` | Mặc định của Elasticsearch, OpenSearch, Qdrant |
| RRF kho nhỏ | **`k=10..20`** | Khuyến nghị riêng cho kho 100-300 trang |
| Lai vs chỉ vector | recall@10 **91% so với 78%** | Lai tốn thêm ~6ms, 1.4x dung lượng |
| Chiến lược cắt | recursive character splitting | Giữ nguyên bảng/khối mã/tiêu đề tăng độ chính xác 40%+ với nội dung có cấu trúc |

### RRF hơn trọng số cứng ở đâu

RRF làm việc trên **THỨ HẠNG**, không trên điểm:

```
diem(doan) = tong cua  1 / (k + hang_trong_moi_danh_sach)
```

Nghĩa là không phải chuẩn hóa hai thang điểm vốn không so được với nhau - bm25
ra số âm, cosine ra 0-1. Cách của goclaw (chuẩn hóa max về 1 rồi nhân trọng số)
phải tự lo chuyện đó và dễ lệch khi phân bố điểm đổi.

**Quan trọng cho việc chia đợt:** RRF nhận N danh sách đã xếp hạng. Đợt 1 chỉ
có một danh sách thì nó là hàm đồng nhất; đợt 2 thêm vector chỉ là **truyền
thêm một danh sách**. Nếu đợt 1 làm trọng số cứng thì đợt 2 phải đập đi.

### Embedding cho tiếng Việt (cho đợt sau)

Gemini Embedding mạnh nhất về đa ngữ; BGE-M3 mạnh nhất cho tìm kiếm lai đa ngữ;
Qwen3-Embedding hỗ trợ 89 ngôn ngữ. Cả ba gọi được qua 9router.

## 5. Chọn thư viện PDF

| Thư viện | Đánh giá |
|---|---|
| **`unpdf`** | Hiện đại, TS-first, bọc pdfjs, chạy mọi runtime |
| `pdf-parse` | Đơn giản nhất nhưng bọc pdfjs bản cũ |
| `pdfjs-dist` | ~3MB, API phức tạp, chỉ cần khi phải render |

**Chọn `unpdf`.** Đã kiểm trên npm ngày 08/08/2026:

- Phiên bản `1.8.0`, sửa lần cuối `2026-07-24` - quá 24h của
  `minimumReleaseAge: 1440`, không bị pnpm chặn
- **Không có dependency runtime nào** (bundle sẵn pdfjs) - không mở thêm bề mặt
  chuỗi cung ứng
- Không có script `postinstall`/`prepare` - không phải thêm vào `allowBuilds`
- 2.1 MB giải nén

## 6. Kết luận cho thiết kế

| Quyết định | Theo ai | Lý do |
|---|---|---|
| Phân quyền nguồn theo agent, mặc định ĐÓNG | goclaw (có sửa) | goclaw mặc định thấy `shared`; ở đây mặc định không thấy gì, phải bật tường minh - cùng nếp `disabledTools` |
| Nạp bằng TOOL | goclaw | giữ prompt cache, không tốn token lượt chào hỏi |
| **Cắt đoạn** | không ai | goclaw không làm, mà đó là điều kiện cần cho chăm sóc khách hàng |
| **RRF thay trọng số cứng** | chuẩn ngoài | không phải chuẩn hóa thang điểm, và mở đường cho đợt vector |
| Cột phẳng bỏ dấu | tự đo | `remove_diacritics 2` không xử lý được `đ` |
