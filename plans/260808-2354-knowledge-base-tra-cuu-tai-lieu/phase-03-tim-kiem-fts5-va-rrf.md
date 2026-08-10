# Phase 03 - Tìm kiếm FTS5 và hợp nhất RRF

**Ưu tiên:** cao. Đây là chỗ quyết định bot trả lời đúng hay sai.
**Trạng thái:** XONG. **Cần:** phase 01, 02.

## Bối cảnh

- Bảng ảo `kb_chunks_fts` đã tạo ở phase 01.
- `boDauTiengViet` đã có ở phase 01 (`src/shared/bo-dau-tieng-viet.ts`) - cột
  `phang` đã bỏ dấu, nên CÂU HỎI cũng phải bỏ dấu trước khi dựng `MATCH`.
- Chuẩn ngành: RRF `k=60` là mặc định của Elasticsearch/OpenSearch/Qdrant;
  kho 100-300 trang thì khuyến nghị `k=10..20`.

## Nhận định then chốt

**Dựng RRF ngay từ đợt này dù chỉ có MỘT bộ xếp hạng.** RRF nhận N danh sách đã
xếp hạng và trộn theo THỨ HẠNG. Một danh sách thì nó là hàm đồng nhất - không
tốn gì. Đợt sau thêm vector chỉ là truyền thêm một danh sách. Nếu đợt này làm
trọng số cứng trên điểm thì đợt sau phải đập đi, và còn phải tự chuẩn hóa hai
thang điểm không so được với nhau (bm25 ra số ÂM, cosine ra 0-1).

Công thức:

```
diem(doan) = tong theo tung danh sach cua  1 / (k + hang)
```

`hang` đếm từ 1. `k` nhỏ thì kết quả top càng có trọng lượng.

**Chế độ OR, không phải AND.** FTS5 mặc định AND mọi từ - đo thật: "phi ship
noi thanh" không khớp gì vì "ship" không có trong tài liệu. Đổi sang
`"tu1" OR "tu2" ...` rồi để `bm25()` xếp hạng thì 3/4 câu hỏi mẫu ra đúng hạng 1.
> **Đính chính:** đo lại ra **4/4**, không phải 3/4 - xem `docs/project-roadmap.md`
> mục 'Ca "mấy giờ đóng cửa" - đo lại ra 4/4 hạng 1, không phải 3/4 như bản đầu'.

**Bọc mỗi từ trong dấu nháy kép.** Câu hỏi của khách chứa `-`, `*`, `"`, `(` là
cú pháp riêng của FTS5 - không bọc thì `MATCH` ném lỗi cú pháp và tool chết.
Đây là đường đi của chữ do NGƯỜI LẠ gõ.

**Lọc theo nguồn NGAY TRONG SQL, không lọc sau.** Lấy top-50 rồi lọc còn 3 là
mất kết quả đúng nằm ở hạng 51. Truyền danh sách `source_id` vào `WHERE`.

## File

**Tạo:**
- `src/knowledge/kb-fts-query.ts` - dựng truy vấn MATCH an toàn, chạy bm25
- `src/knowledge/hop-nhat-rrf.ts` - RRF thuần, không biết gì về SQLite
- `src/knowledge/kb-search.ts` - ghép: nguồn cho phép -> bm25 -> RRF -> đoạn
- test cho cả ba

## Giao diện

```ts
// hop-nhat-rrf.ts  (module THUẦN, không chạm DB)
export type DanhSachXepHang<T> = T[];
export function hopNhatRrf<T>(ds: DanhSachXepHang<T>[], khoaCua: (x: T) => string, k: number): { item: T; diem: number }[];

// kb-fts-query.ts
export function dungTruyVanFts(cauHoi: string): string;  // "" khi không còn từ nào dùng được
export function timTheoTuKhoa(cauHoi: string, sourceIds: string[], soLuong: number): { chunkId: number }[];

// kb-search.ts
export type KetQuaKb = { sourceId: string; tenNguon: string; tieuDe: string; noiDung: string; diem: number };
export function timTrongKhoTriThuc(p: { cauHoi: string; agentId: string; soLuong?: number }): KetQuaKb[];
```

## Tham số vào trang Cấu hình

| Key | Mặc định | Min-Max | Nhãn |
|---|---|---|---|
| `KB_TOP_K` | 5 | 1-20 | Số đoạn trả về mỗi lần tra |
| `KB_RRF_K` | 20 | 5-100 | Hằng số RRF |

`KB_RRF_K = 20` chứ không phải 60: chuẩn 60 dành cho corpus cỡ TREC hàng nghìn
tài liệu; kho 100-300 trang thì khuyến nghị 10-20.

`KB_MAX_RESULT_CHARS` thuộc phase 04 - nó là trần cho KẾT QUẢ TOOL, không phải
tham số của tầng tìm kiếm.

## Các bước

- [ ] **B1: RRF thuần (test trước, không chạm DB)**

```ts
it("một danh sách: RRF giữ nguyên thứ tự", () => {
  const r = hopNhatRrf([["a", "b", "c"]], (x) => x, 20);
  assert.deepEqual(r.map((x) => x.item), ["a", "b", "c"]);
});

it("mục xuất hiện ở CẢ HAI danh sách được đẩy lên trên", () => {
  //  x: hạng 2 và hạng 1  ->  1/22 + 1/21
  //  a: hạng 1, vắng mặt danh sách hai  ->  1/21
  const r = hopNhatRrf([["a", "x"], ["x", "b"]], (v) => v, 20);
  assert.equal(r[0]!.item, "x", "có mặt ở hai nguồn phải thắng hạng-1-một-nguồn");
});

it("k nhỏ làm top có trọng lượng hơn", () => {
  const nho = hopNhatRrf([["a"], ["b"]], (v) => v, 1)[0]!.diem;
  const lon = hopNhatRrf([["a"], ["b"]], (v) => v, 100)[0]!.diem;
  assert.ok(nho > lon);
});

it("danh sách rỗng không làm hỏng gì", () => {
  assert.deepEqual(hopNhatRrf([[], ["a"]], (v) => v, 20).map((x) => x.item), ["a"]);
});
```

- [ ] **B2: Dựng truy vấn MATCH an toàn**

```ts
it("bọc từng từ trong nháy kép và nối bằng OR", () => {
  assert.equal(dungTruyVanFts("phí ship nội thành"), '"phi" OR "ship" OR "noi" OR "thanh"');
});

it("ký tự cú pháp FTS5 trong câu hỏi KHÔNG làm ném lỗi", () => {
  // Chữ của người lạ đi thẳng vào đây - "-", "*", '"', "(" đều là cú pháp FTS5
  for (const cau of ['giá "combo" bao nhiêu', "shop ơi - còn hàng *không*", "a( b) c"]) {
    assert.doesNotThrow(() => database.db.prepare("SELECT rowid FROM kb_chunks_fts WHERE phang MATCH ?").all(dungTruyVanFts(cau)));
  }
});

it("câu hỏi không còn từ nào dùng được thì trả rỗng, KHÔNG dựng MATCH rỗng", () => {
  assert.equal(dungTruyVanFts("!!! ??? ..."), "");
});
```

- [ ] **B3: bm25 trên dữ liệu tiếng Việt thật**

Dựng 4 đoạn kiểu tài liệu chăm sóc khách hàng, rồi khẳng định 3 câu hỏi ra đúng
hạng 1. **Câu thứ tư ("mấy giờ đóng cửa") CỐ Ý không khẳng định hạng 1** - lúc
nghiên cứu đã đo là nó trượt vì "đồng" (tiền) và "đóng" bỏ dấu đều thành "dong",
nên đoạn phí vận chuyển chen lên trên. Ghi lại làm mốc cho đợt vector.
> **Đính chính:** controller đo lại giữa chừng và siết assertion của test lên
> đúng hạng 1 - CẢ 4/4 câu đều ra đúng hạng 1 trên fixture thật (đoạn "Giờ làm
> việc" khớp đa dạng 3 từ khác nhau nên thắng, xem `kb-search.test.ts`). Xem
> `docs/project-roadmap.md` mục 'Ca "mấy giờ đóng cửa"...' cho số đo đầy đủ.
> Đoạn trên giữ nguyên làm bản ghi lịch sử của dự đoán lúc lập kế hoạch.

Fixture:

```ts
const TAI_LIEU = [
  "# Phí vận chuyển\n\nNội thành 20.000 đồng, ngoại thành 35.000 đồng. Đơn trên 500.000 đồng được miễn phí ship.",
  "# Bảo hành\n\nBảo hành 12 tháng cho mọi sản phẩm. Đổi mới trong 30 ngày đầu nếu lỗi nhà sản xuất.",
  "# Chính sách đổi trả\n\nĐổi trả trong vòng 7 ngày kể từ ngày nhận hàng, sản phẩm còn nguyên tem.",
  "# Giờ làm việc\n\nCửa hàng mở cửa 8h00, đóng cửa 21h00 tất cả các ngày trong tuần.",
];
```

```ts
it("ba câu hỏi kiểu khách hàng ra đúng đoạn ở hạng 1", () => {
  for (const [cau, mong] of [
    ["phi ship noi thanh bao nhieu", "vận chuyển"],
    ["bảo hành bao lâu vậy shop", "Bảo hành"],
    ["đổi trả được không", "đổi trả"],
  ] as const) {
    const kq = timTrongKhoTriThuc({ cauHoi: cau, agentId: AGENT, soLuong: 1 });
    assert.match(kq[0]!.noiDung, new RegExp(mong), `câu "${cau}"`);
  }
});

it("MỐC ĐÃ BIẾT: câu hỏi giờ mở cửa chỉ vào được top 2, không chắc hạng 1", () => {
  // "đồng" (tiền) và "đóng" bỏ dấu đều ra "dong" nên đoạn phí ship chen lên
  // trên. Đây là điểm mù cố hữu của tìm theo từ khóa và là lý do đợt sau thêm
  // lớp vector. Khẳng định để LỎNG ở top 2 vì thứ hạng chính xác phụ thuộc
  // fixture; chạy thật thấy nó ổn định ở hạng 1 thì siết lại khẳng định.
  const kq = timTrongKhoTriThuc({ cauHoi: "mấy giờ đóng cửa", agentId: AGENT, soLuong: 2 });
  assert.ok(kq.some((x) => /Giờ làm việc/.test(x.noiDung)), "vẫn phải nằm trong top 2");
});
```

- [ ] **B4: Cách ly theo nguồn - bất biến an toàn**

```ts
it("chỉ tìm trong nguồn ĐÃ BẬT cho agent đó", () => {
  binding.datNguonChoAgent("agent-a", [nguonA.id]);
  const kq = timTrongKhoTriThuc({ cauHoi: "bảo hành", agentId: "agent-a" });
  assert.ok(kq.every((x) => x.sourceId === nguonA.id), "rò nguồn của agent khác");
});

it("agent chưa gán nguồn nào thì trả RỖNG, không phải trả tất cả", () => {
  assert.deepEqual(timTrongKhoTriThuc({ cauHoi: "bảo hành", agentId: "agent-chua-gan" }), []);
});

it("lọc nguồn nằm TRONG SQL, không lọc sau khi lấy top", () => {
  // Dựng 30 đoạn ở nguồn KHÔNG được bật, đều khớp câu hỏi, cộng 1 đoạn khớp ở
  // nguồn ĐƯỢC bật. Lọc sau khi lấy top-5 thì đoạn đúng bị đẩy ra ngoài.
  const kq = timTrongKhoTriThuc({ cauHoi: "bảo hành", agentId: "agent-a", soLuong: 5 });
  assert.equal(kq.length, 1);
  assert.equal(kq[0]!.sourceId, nguonA.id);
});
```

- [ ] **B5: `pnpm typecheck` + `pnpm test`**

- [ ] **B6: Phá code kiểm 6 chốt**

| Phá gì | Test phải đỏ |
|---|---|
| RRF cộng điểm thay vì cộng nghịch đảo hạng | "có mặt ở hai nguồn phải thắng" |
| `dungTruyVanFts` không bọc nháy kép | "ký tự cú pháp KHÔNG làm ném lỗi" |
| Dùng AND thay vì OR | "ba câu hỏi ra đúng hạng 1" |
| Bỏ `boDauTiengViet` khỏi câu hỏi | "ba câu hỏi ra đúng hạng 1" |
| Lọc nguồn SAU khi lấy top | "lọc nguồn nằm TRONG SQL" |
| `agentId` chưa gán trả mọi nguồn | "trả RỖNG, không phải tất cả" |

- [ ] **B7: Commit**

```
feat(kb): tìm kiếm FTS5 tiếng Việt và hợp nhất bằng RRF
```

## Định nghĩa hoàn thành

- RRF là module thuần, có test cho ca một danh sách và ca nhiều danh sách.
- 3/4 câu hỏi mẫu ra đúng hạng 1; ca trượt được ghi lại làm mốc.
  > **Đính chính:** đo lại ra 4/4 - xem `docs/project-roadmap.md` mục 'Ca "mấy
  > giờ đóng cửa"...'.
- Không có đường nào agent đọc được nguồn chưa bật.
- 6/6 phép phá đỏ đúng chỗ.

## Rủi ro

| Rủi ro | Chặn thế nào |
|---|---|
| Câu hỏi của người lạ làm `MATCH` ném lỗi cú pháp -> tool chết | B2 thử 3 chuỗi có ký tự cú pháp |
| Lọc nguồn sau khi lấy top -> mất kết quả đúng | B4 dựng 30 đoạn nhiễu |
| RRF viết nhầm thành cộng điểm | B1 dựng đúng ca phân biệt hai cách |

## Bước tiếp

Phase 04 bọc `timTrongKhoTriThuc` thành tool cho model.
