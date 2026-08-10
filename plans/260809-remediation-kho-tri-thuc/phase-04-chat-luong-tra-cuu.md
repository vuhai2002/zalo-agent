# Phase 04 - Chất lượng tra cứu

**Ưu tiên:** cao. Hiện tra đúng TÊN TÀI LIỆU ra rỗng, và `KB_TOP_K` là nút bấm
không tác dụng.
**Trạng thái:** chưa làm. **Cần:** phase 01, 02 (cần vòng nạp ổn định để đo lại).

## Bối cảnh

- Nghiên cứu: [`reports/nghien-cuu-injection-worker-rag.md`](reports/nghien-cuu-injection-worker-rag.md)
  mục "Câu hỏi 3" và "Câu hỏi 4". Đọc trước khi viết code.
- File: `src/knowledge/chunk-text.ts`, `kb-search.ts`, `kb-fts-query.ts`,
  `src/agent/tools/kb-search-tool.ts`, `src/config/tuning-definitions.ts`,
  `src/config/runtime-tuning-settings.ts`, `src/config/env.ts`.
- Mẫu ràng buộc chéo sẵn có: `LUAT_CHEO` ở `runtime-tuning-settings.ts:100-158`.
- Mẫu đóng gói theo ngân sách: `src/agent/trim-context-to-budget.ts:19-22` đã
  viết thành luật đúng điều phase này cần.

## Lỗi phải đóng

| Mã | Lỗi | Số đo |
|---|---|---|
| I1 | `chunk-text.ts:133` `if (!than) continue;` -> tiêu đề H1 KHÔNG BAO GIỜ vào chỉ mục khi dưới nó là H2. Tên nguồn cũng không được index | tra "chính sách đổi trả" trả **0 dòng** |
| I2 | `KB_TOP_K` là nút không tác dụng; kết quả bị cắt giữa từ | topK=5 và topK=20 cho chuỗi **giống hệt từng byte**, chỉ 3 đoạn tới model |
| I3 | Hai nguồn nội dung y hệt chiếm 2 slot top-k | với top-k thực tế chỉ 2-3 đoạn thì trùng lặp ăn hết chỗ |

## Người dùng đã chốt

Ngân sách **rộng rãi**: `KB_MAX_RESULT_CHARS = 8000`, `KB_TOP_K = 5`,
`KB_CHUNK_CHARS = 1200`.

## Nhận định then chốt

**Breadcrumb `H1 > H2 > H3` + tên nguồn vào cột `phang`.** Một cột, không phải ba
cột có trọng số - đo được lợi ích của ba cột là KHÔNG CÓ, mà phải DROP/CREATE lại
bảng ảo (tức mất toàn bộ chỉ mục của người dùng đang chạy).

**KHÔNG làm Contextual Retrieval** (dùng LLM sinh câu ngữ cảnh cho từng đoạn).
Anthropic tự nói kho dưới 200k token thì đừng dùng - đúng quy mô dự án này.

**Ràng buộc chéo bắt buộc:**

```
KB_MAX_RESULT_CHARS >= KB_TOP_K * (KB_CHUNK_CHARS + 60) + 500
```

`60` là chỗ cho nhãn `[Nguồn: ...]` mỗi đoạn, `500` là phần vỏ (thẻ bọc + ba dòng
dặn dò). Thiếu luật này thì mặc định hiện tại đã tự mâu thuẫn.

**Cắt: bỏ hẳn đoạn không vừa, ĐÓNG GÓI TRƯỚC rồi BỌC SAU.** Hiện đang bọc trước
rồi cắt cả khối đã bọc, nên trần bao gồm luôn phần vỏ và không cách nào chừa chỗ
cho nó. Cắt giữa đoạn cho model một mẩu câu cụt - vô dụng mà vẫn tốn token.

**Khử trùng phải LẤY DƯ TRƯỚC.** `timTheoTuKhoa` hiện `LIMIT soLuong` ngay trong
SQL, nên khử trùng sau đó sẽ thiếu kết quả. Lấy dư (ví dụ `soLuong * 3`) rồi khử
rồi mới cắt về `soLuong`.

## File

**Sửa:**
- `src/knowledge/chunk-text.ts` - breadcrumb thay vì tiêu đề gần nhất; heading
  không có thân bài vẫn phải đi vào ngữ cảnh của đoạn sau
- `src/knowledge/kb-chunk-store.ts` - ghép tên nguồn + breadcrumb vào `phang`
- `src/knowledge/kb-fts-query.ts` - lấy dư cho khử trùng
- `src/knowledge/kb-search.ts` - khử trùng theo hash `phang`
- `src/agent/tools/kb-search-tool.ts` - đóng gói trước, bọc sau, bỏ đoạn không vừa
- `src/config/tuning-definitions.ts` + `env.ts` - mặc định mới
- `src/config/runtime-tuning-settings.ts` - thêm `LUAT_CHEO` cho nhóm `kb`

## Các bước

- [ ] **B1: Test đỏ trước - tra đúng TÊN TÀI LIỆU phải ra**

```ts
it("tra bằng chính tiêu đề H1 của tài liệu ra đúng đoạn", () => {
  // Ca đã đo hỏng: "# Chính sách đổi trả\n\n## Điều kiện\n\n..." -> tra
  // "chính sách đổi trả" trả về 0 dòng, vì H1 không có thân bài nên bị bỏ và
  // tieuDeHienTai bị H2 ghi đè trước khi kịp dùng.
  napQuaWorker("Chính sách", "# Chính sách đổi trả\n\n## Điều kiện\n\nHàng còn nguyên tem.\n\n## Thời hạn\n\nTrong vòng 7 ngày.");
  const kq = timTrongKhoTriThuc({ cauHoi: "chính sách đổi trả", agentId: AGENT });
  assert.ok(kq.length > 0, "tra đúng tên tài liệu mà ra rỗng");
});

it("tra bằng TÊN NGUỒN ra đúng đoạn", () => {
  napQuaWorker("Bảng giá quán", "Cà phê 25.000đ.");
  const kq = timTrongKhoTriThuc({ cauHoi: "bảng giá quán", agentId: AGENT });
  assert.ok(kq.length > 0);
});

it("breadcrumb giữ cả ba cấp, không chỉ cấp gần nhất", () => {
  const d = catThanhDoan("# Chính sách\n\n## Đổi trả\n\n### Điều kiện\n\nCòn nguyên tem.", MAC_DINH);
  const doan = d.find((x) => x.noiDung.includes("nguyên tem"))!;
  assert.match(doan.tieuDe, /Chính sách.*Đổi trả.*Điều kiện/);
});
```

Test này phải đi qua ĐƯỜNG NẠP THẬT (`catThanhDoan` -> `luuDoan`), không nạp
fixture bằng `luuDoan` trực tiếp. Đường nối phase 02 <-> phase 03 chưa có test nào
phủ, và đó chính là lý do lỗi này lọt qua hai vòng rà soát.

- [ ] **B2: Test đỏ trước - `KB_TOP_K` phải có tác dụng**

```ts
it("tăng KB_TOP_K làm model thấy NHIỀU đoạn hơn", async () => {
  napNhieuDoan(8);
  tuning.setTuning("KB_TOP_K", 2);
  const it_ = await chay(ctx, { cau_hoi: "bảo hành" });
  tuning.setTuning("KB_TOP_K", 5);
  const nhieu = await chay(ctx, { cau_hoi: "bảo hành" });
  assert.ok(demNhan(nhieu) > demNhan(it_), `topK=2 ra ${demNhan(it_)} đoạn, topK=5 ra ${demNhan(nhieu)} - không đổi`);
});

it("không đoạn nào bị cắt giữa chừng - vừa thì lấy nguyên, không vừa thì bỏ hẳn", async () => {
  tuning.setTuning("KB_MAX_RESULT_CHARS", 2000);
  const kq = await chay(ctx, { cau_hoi: "bảo hành" });
  for (const doan of tachDoan(kq)) {
    assert.ok(doanNguyenVen(doan), `đoạn bị cắt cụt: ${JSON.stringify(doan.slice(-40))}`);
  }
});

it("phần vỏ và ba dòng dặn dò LUÔN nguyên vẹn kể cả ở trần nhỏ nhất", async () => {
  tuning.setTuning("KB_MAX_RESULT_CHARS", 500);
  const kq = await chay(ctx, { cau_hoi: "bảo hành" });
  assert.match(kq, /DỮ LIỆU/);   // câu dặn model coi đây là dữ liệu
  assert.match(kq, new RegExp(`</${THE_NOI_DUNG_NGOAI}[^>]*>$`));
});
```

- [ ] **B3: Test đỏ trước - ràng buộc chéo chặn tổ hợp vô nghĩa**

```ts
it("dashboard từ chối tổ hợp mà trần nhỏ hơn tổng đoạn sẽ lấy", () => {
  const loi = validateTuning({ KB_TOP_K: 20, KB_CHUNK_CHARS: 1600, KB_MAX_RESULT_CHARS: 4000 });
  assert.ok(loi.length > 0, "tổ hợp này làm 17/20 đoạn bị vứt lặng lẽ mà không ai báo");
});

it("mặc định của chính repo THỎA ràng buộc", () => {
  // Bất biến chống hồi quy: mặc định tự mâu thuẫn chính là lỗi gốc của I2.
  assert.deepEqual(validateTuning({
    KB_TOP_K: MAC_DINH.KB_TOP_K,
    KB_CHUNK_CHARS: MAC_DINH.KB_CHUNK_CHARS,
    KB_MAX_RESULT_CHARS: MAC_DINH.KB_MAX_RESULT_CHARS,
  }), []);
});
```

Test thứ hai là bất biến quan trọng nhất của phase: nó bắt được đúng lớp lỗi đã
xảy ra, và bắt được cả trong tương lai khi ai đó đổi một mặc định mà quên cái kia.

- [ ] **B4: Test đỏ trước - khử trùng không làm thiếu kết quả**

```ts
it("hai nguồn nội dung y hệt chỉ chiếm MỘT slot", () => {
  napQuaWorker("Nguồn A", "Cà phê 25.000đ.");
  napQuaWorker("Nguồn B", "Cà phê 25.000đ.");
  const kq = timTrongKhoTriThuc({ cauHoi: "cà phê", agentId: AGENT, soLuong: 5 });
  assert.equal(kq.length, 1);
});

it("khử trùng KHÔNG làm thiếu: vẫn đủ soLuong đoạn khác nhau", () => {
  // LIMIT soLuong nằm ngay trong SQL nên khử sau đó sẽ thiếu - phải lấy dư trước.
  napQuaWorker("Nguồn A", "Cà phê 25.000đ.");
  napQuaWorker("Nguồn B", "Cà phê 25.000đ.");
  for (let i = 0; i < 5; i++) napQuaWorker(`Khác ${i}`, `Cà phê loại ${i} giá ${i}0.000đ.`);
  const kq = timTrongKhoTriThuc({ cauHoi: "cà phê", agentId: AGENT, soLuong: 5 });
  assert.equal(kq.length, 5, "khử trùng xong bị hụt vì lấy đúng soLuong rồi mới khử");
});
```

- [ ] **B5: Đổi mặc định và thêm `LUAT_CHEO`**

`KB_MAX_RESULT_CHARS` 4000 -> **8000**, `KB_CHUNK_CHARS` 1600 -> **1200**,
`KB_TOP_K` giữ **5**. Sửa cả `env.ts` và `tuning-definitions.ts`, giữ min/max hợp lý.

Thêm luật vào `LUAT_CHEO` theo đúng hình dạng sẵn có (`keys` + `check` trả câu
tiếng Việt hoặc `null`).

- [ ] **B6: `pnpm typecheck` + `pnpm test`**

Đổi `KB_CHUNK_CHARS` làm số đoạn của fixture đổi theo - kiểm xem test nào của
phase trước phụ thuộc con số cũ.

- [ ] **B7: Phá code kiểm 7 chốt**

| Phá gì | Test phải đỏ | Đường code được chạy |
|---|---|---|
| Quay lại `if (!than) continue;` bỏ heading không thân bài | "tra bằng chính tiêu đề H1" | nhánh heading rỗng |
| Chỉ giữ tiêu đề gần nhất thay vì breadcrumb | "breadcrumb giữ cả ba cấp" | nối chuỗi cấp |
| Bỏ tên nguồn khỏi `phang` | "tra bằng TÊN NGUỒN" | chỗ ghép lúc lưu |
| Bọc trước rồi cắt cả khối | "phần vỏ và ba dòng dặn dò nguyên vẹn" | thứ tự đóng gói |
| Cắt giữa đoạn thay vì bỏ hẳn | "không đoạn nào bị cắt giữa chừng" | vòng đóng gói |
| Bỏ `LUAT_CHEO` của nhóm kb | "dashboard từ chối tổ hợp vô nghĩa" | mảng luật |
| Khử trùng SAU khi đã `LIMIT soLuong` | "khử trùng KHÔNG làm thiếu" | hệ số lấy dư |

- [ ] **B8: Đo lại 4 câu hỏi mẫu và ghi số vào report**

Chạy lại bộ 4 câu hỏi trong `kb-search.test.ts` sau khi đổi `KB_CHUNK_CHARS`.
Nếu thứ hạng đổi, ghi số thật vào report - ĐỪNG tự siết hay nới khẳng định, báo
lại để controller phán.

- [ ] **B9: Commit**

```
fix(kb): breadcrumb tiêu đề vào chỉ mục, ràng buộc chéo ngân sách tra cứu
```

## Định nghĩa hoàn thành

- Tra bằng tiêu đề H1 và bằng tên nguồn đều ra kết quả.
- `KB_TOP_K` thật sự đổi số đoạn model thấy.
- Không đoạn nào bị cắt giữa chừng; phần vỏ luôn nguyên vẹn.
- Mặc định của repo THỎA ràng buộc chéo, có test bất biến canh.
- Khử trùng hoạt động mà không làm thiếu kết quả.
- 7/7 phép phá đỏ đúng chỗ, mỗi phép ghi đường code được chạy.

## Rủi ro

| Rủi ro | Chặn thế nào |
|---|---|
| Ghép tên nguồn vào `phang` làm nhiễu bm25 | Đo lại 4 câu hỏi mẫu ở B8; nếu tệ đi thì báo số, đừng tự chỉnh |
| Đổi `KB_CHUNK_CHARS` phá test của phase trước | B6 chạy full suite; sửa test phụ thuộc con số cũ |
| Đổi mặc định làm DB người dùng đang chạy lệch | `getTuning` tự rơi về mặc định khi giá trị ngoài khoảng - không cần migration |
| Breadcrumb làm `phang` phình to | Ghi số đo cỡ chỉ mục trước/sau vào report |

## Bước tiếp

Phase 05 chống lạm dụng API và sửa test hụt thứ tám.
