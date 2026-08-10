# Phase 02 - Worker chịu độc

**Ưu tiên:** cao. Phase 01 làm bom khó dựng hơn; phase này làm hậu quả không còn
là mất cả tiến trình.
**Trạng thái:** chưa làm. **Cần:** phase 01.

## Bối cảnh

- Nghiên cứu: [`reports/nghien-cuu-injection-worker-rag.md`](reports/nghien-cuu-injection-worker-rag.md)
  mục "Câu hỏi 2". Đọc trước khi viết code.
- File: `src/knowledge/kb-ingest-worker.ts`, `src/index.ts`,
  `src/knowledge/kb-source-queries.ts`, `src/server/routes/kb-routes.ts`.
- Mẫu bộ đếm bền sẵn có: cột `delivery_attempts` trong `src/scheduler/` - đọc code
  thật rồi tái dùng cho nhất quán.
- Mẫu vòng nền: `src/scheduler/scheduler-loop.ts`.

## Lỗi phải đóng

| Mã | Lỗi |
|---|---|
| C2 | `src/index.ts:75` khởi động worker TRƯỚC `startDashboardServer()` (:77), và cả chuỗi không có `await` thật nào -> nguồn độc treo tiến trình thì không vào được dashboard để xóa nó |
| C3 | `goNguonKetLucKhoiDong` nạp lại nguồn độc mỗi lần khởi động, không có bộ đếm lần thử. Nguồn NÉM lỗi thì bị cách ly; nguồn GIẾT tiến trình thì thử lại vô hạn |
| I4 | DELETE xen vào lúc worker đang `await` để lại đoạn + hàng FTS mồ côi VĨNH VIỄN, không đường dọn |
| I5 | Snapshot worker kéo TOÀN VĂN mọi nguồn đang chờ vào RAM cùng lúc (đo: 8 nguồn x 5 triệu ký tự = +30 MB một lần gọi) |
| I6 | "Xử lý lại" bấm trúng lúc `dang_xu_ly` bị nuốt lặng lẽ; lượt đang chạy ghi đè trạng thái cuối |
| I7 | Tài liệu trích ra rỗng được đánh dấu "Sẵn sàng, 0 đoạn" mà không nói gì (phase 01 đã làm extractor NÉM; phase này lo phần worker và giao diện trạng thái) |
| I8 | `giaNguonChoXuLy` nằm NGOÀI `try` - ném ở đó thì cả vòng quét bỏ dở |

## Nhận định then chốt

**Trích xuất chạy trong `node:worker_threads`, luồng chính GHI DB.** Đo được
`worker.terminate()` cắt được vòng lặp CPU đồng bộ trong 2,2 ms - đây là cách duy
nhất có thật để dừng code đồng bộ đang quay. `child_process.fork` tốn 53,5 MB nên
loại. Boot worker 30 ms, chấp nhận được.

**Đặt timeout cho code ĐỒNG BỘ trên cùng luồng là KHÔNG LÀM ĐƯỢC.** Đây là lý do
bắt buộc phải có worker, không phải sở thích kiến trúc. Nói thẳng điều này trong
comment để người sau không thử lại.

**Worker CHỈ trích xuất và cắt đoạn.** Nó KHÔNG mở DB. Bất biến "một connection
SQLite cho cả process" phải giữ nguyên - luồng chính nhận đoạn đã cắt rồi ghi.
Truyền buffer vào worker bằng transferable ArrayBuffer.

**Bộ đếm lần thử phải tăng TRONG chính câu UPDATE giành nguồn.** Nguồn giết tiến
trình không bao giờ chạy được code "sau khi hỏng" - nên nếu tăng đếm ở nhánh
catch thì nó vô dụng đúng với ca cần nhất. Trần **2** lần.

**Người dùng đã chốt: KHÔNG chặn worker khi có lượt agent đang chạy.** Chấp nhận
bot chậm đi lúc trích xuất. Đừng thêm cơ chế nhường.

## File

**Tạo:**
- `src/knowledge/kb-extract-worker.ts` - thân worker thread: nhận buffer + định
  dạng, trả chữ đã trích và đoạn đã cắt
- `src/knowledge/chay-trich-xuat-tach-luong.ts` - phía luồng chính: spawn, gửi,
  chờ, `terminate()` khi quá hạn
- `src/knowledge/don-doan-mo-coi.ts` - dọn đoạn/hàng FTS không còn nguồn
- test cho cả ba

**Sửa:**
- `src/knowledge/kb-schema.ts` - thêm cột `so_lan_thu INTEGER NOT NULL DEFAULT 0`
- `src/knowledge/kb-source-queries.ts` - `giaNguonChoXuLy` tăng đếm; danh sách
  chờ KHÔNG kéo toàn văn
- `src/knowledge/kb-ingest-worker.ts` - gọi worker thread, `try` bao đúng chỗ
- `src/index.ts` - đảo thứ tự, khai `let` cho hàm dừng
- `src/server/routes/kb-routes.ts` - reindex xử lý ca đang chạy
- `web/src/pages/kb-source-row.tsx` - hiện số lần thử khi `hong`

## Giao diện

```ts
// chay-trich-xuat-tach-luong.ts
export type KetQuaTrichXuat = { chu: string; doan: DoanMoi[] };
/**
 * Chạy trích xuất + cắt đoạn trong worker thread. Quá `hanMs` thì `terminate()`
 * và ném lỗi tiếng Việt đọc được. Đây là cách DUY NHẤT dừng được code đồng bộ
 * đang quay CPU - không có cách nào làm việc đó trên cùng luồng.
 */
export function trichXuatTachLuong(p: {
  buf: Buffer; dinhDang: DinhDangKb; thamSoCat: ThamSoCat; hanMs: number;
}): Promise<KetQuaTrichXuat>;

// don-doan-mo-coi.ts
/** Gọi một lần lúc boot. Trả số dòng đã dọn để ghi log. */
export function donDoanMoCoi(): { soDoan: number; soHangFts: number };

// kb-source-queries.ts (sửa)
/** Tăng `so_lan_thu` TRONG chính câu UPDATE giành nguồn. */
export function giaNguonChoXuLy(id: string, tranLanThu: number): boolean;
```

## Tham số mới

| Key | Mặc định | Min-Max | Nhãn |
|---|---|---|---|
| `KB_EXTRACT_TIMEOUT_MS` | 60000 | 5000-600000 | Trần thời gian trích xuất một tài liệu |
| `KB_MAX_INGEST_ATTEMPTS` | 2 | 1-5 | Số lần thử lại một nguồn trước khi bỏ hẳn |

## Các bước

- [ ] **B1: Test đỏ trước - nguồn độc bị bỏ sau đúng N lần, không thử vô hạn**

```ts
it("nguồn làm worker quá hạn bị đánh hong sau đúng KB_MAX_INGEST_ATTEMPTS lần", async () => {
  tuning.setTuning("KB_MAX_INGEST_ATTEMPTS", 2);
  const n = store.taoNguon({ ten: "độc", loai: "file", dinhDang: "docx", duongDan: fileStore.luuFile("d", "docx", bomTreo()) });

  await worker.xuLyMotVong();
  worker.goNguonKetLucKhoiDong();
  await worker.xuLyMotVong();
  worker.goNguonKetLucKhoiDong();
  await worker.xuLyMotVong();   // lần 3 KHÔNG được chạy nữa

  const sau = store.layNguon(n.id)!;
  assert.equal(sau.trangThai, "hong");
  assert.match(sau.loi, /đã thử 2 lần/i);
});

it("bộ đếm tăng NGAY LÚC GIÀNH, không phải lúc hỏng", () => {
  // Nguồn giết tiến trình không bao giờ chạy được code "sau khi hỏng" - tăng ở
  // nhánh catch là vô dụng đúng với ca cần nhất.
  const n = store.taoNguon({ ten: "x", loai: "text", noiDungGoc: "abc" });
  giaNguonChoXuLy(n.id, 2);
  assert.equal(store.layNguon(n.id)!.soLanThu, 1, "chưa xử lý gì mà đếm phải đã tăng");
});
```

- [ ] **B2: Test đỏ trước - worker quá hạn bị giết, luồng chính sống**

```ts
it("trích xuất quá hạn thì worker bị terminate và ném lỗi, luồng chính KHÔNG treo", async () => {
  const nhipTruoc: number[] = [];
  const dem = setInterval(() => nhipTruoc.push(Date.now()), 10);
  await assert.rejects(
    () => trichXuatTachLuong({ buf: bomQuayCpu(), dinhDang: "docx", thamSoCat: MAC_DINH, hanMs: 300 }),
    /quá thời gian/i,
  );
  clearInterval(dem);
  assert.ok(nhipTruoc.length >= 10, `luồng chính chỉ chạy được ${nhipTruoc.length} nhịp - vẫn bị khoá`);
});
```

Đây là test QUAN TRỌNG NHẤT của phase. Nó đo đúng thứ bị hỏng: luồng chính có
sống không. Khẳng định theo SỐ NHỊP chạy được chứ không theo thời gian tổng.

- [ ] **B3: Test đỏ trước - dashboard mở được TRƯỚC worker**

```ts
it("startDashboardServer chạy TRƯỚC khi worker bắt đầu", () => {
  // Không mô phỏng: đọc thứ tự dòng trong src/index.ts. Nguồn độc treo tiến
  // trình thì đây là thứ quyết định người vận hành có xóa được nó không.
  const src = fs.readFileSync("src/index.ts", "utf-8");
  assert.ok(src.indexOf("startDashboardServer()") < src.indexOf("batDauKbIngestWorker()"),
    "worker khởi động trước dashboard - nguồn độc treo máy thì không vào được để xóa");
});
```

Test đọc thứ tự dòng nguồn là bất đắc dĩ nhưng đúng chỗ: đây là một bất biến về
THỨ TỰ KHỞI ĐỘNG, không có hành vi runtime nào quan sát được nó rẻ hơn.

- [ ] **B4: Test đỏ trước - đoạn mồ côi được dọn**

```ts
it("đoạn của nguồn đã bị xóa được dọn lúc khởi động", () => {
  const n = store.taoNguon({ ten: "x", loai: "text", noiDungGoc: "abc" });
  chunkStore.luuDoan(n.id, [{ thuTu: 0, tieuDe: "", noiDung: "nội dung" }]);
  database.db.exec(`DELETE FROM kb_sources WHERE id = '${n.id}'`);  // mô phỏng đúng ca đã đo

  const ket = donDoanMoCoi();

  assert.equal(ket.soDoan, 1);
  assert.equal(dem("SELECT COUNT(*) AS n FROM kb_chunks"), 0);
  assert.equal(dem("SELECT COUNT(*) AS n FROM kb_chunks_fts"), 0, "hàng FTS mồ côi là thứ không có đường dọn nào khác");
});

it("worker KHÔNG ghi đoạn cho nguồn đã bị xóa giữa chừng", async () => {
  // Cửa sổ thật: worker đang await trích xuất, route DELETE chen vào
  const n = store.taoNguon({ ten: "x", loai: "text", noiDungGoc: "abc" });
  const chay = worker.xuLyMotVong();
  store.xoaNguon(n.id);
  await chay;
  assert.equal(dem("SELECT COUNT(*) AS n FROM kb_chunks"), 0);
});
```

- [ ] **B5: Test đỏ trước - danh sách chờ không kéo toàn văn**

```ts
it("danh sách nguồn chờ KHÔNG kéo noi_dung_goc", () => {
  store.taoNguon({ ten: "to", loai: "text", noiDungGoc: "x".repeat(5_000_000) });
  const ds = layNguonTheoTrangThai("cho_xu_ly");
  assert.equal("noiDungGoc" in ds[0]!, false, "kéo toàn văn mọi nguồn chờ vào RAM cùng lúc");
});
```

- [ ] **B6: Test đỏ trước - reindex lúc đang chạy không bị nuốt**

```ts
it("bấm Xử lý lại lúc nguồn đang dang_xu_ly trả 409, không nuốt lặng lẽ", async () => {
  const n = store.taoNguon({ ten: "x", loai: "text", noiDungGoc: "abc" });
  store.datTrangThai(n.id, "dang_xu_ly");
  const res = await app.request(`/api/kb/sources/${n.id}/reindex`, { method: "POST", headers: { cookie } });
  assert.equal(res.status, 409);
});
```

- [ ] **B7: Test đỏ trước - `giaNguonChoXuLy` ném thì vòng không bỏ dở**

```ts
it("lỗi lúc giành nguồn KHÔNG làm cả vòng quét bỏ dở", async () => {
  // giaNguonChoXuLy hiện nằm NGOÀI try - ném ở đó thì rejection thoát ra ngoài
  // và các nguồn còn lại trong vòng không được xử lý
});
```

- [ ] **B8: Viết code, chạy `pnpm typecheck` + `pnpm test`**

- [ ] **B9: Phá code kiểm 7 chốt**

| Phá gì | Test phải đỏ | Đường code được chạy |
|---|---|---|
| Tăng `so_lan_thu` ở nhánh catch thay vì trong UPDATE giành | "đếm tăng NGAY LÚC GIÀNH" | câu UPDATE |
| Bỏ trần lần thử | "bị đánh hong sau đúng N lần" | so sánh đếm với trần |
| Bỏ `terminate()`, chỉ chờ promise | "luồng chính KHÔNG treo" | nhánh quá hạn |
| Đảo lại thứ tự khởi động | "dashboard TRƯỚC worker" | đọc thứ tự dòng |
| Bỏ `donDoanMoCoi` khỏi boot | "đoạn của nguồn đã xóa được dọn" | hàm dọn |
| Bỏ kiểm nguồn còn tồn tại trước `luuDoan` | "KHÔNG ghi đoạn cho nguồn đã xóa" | nhánh kiểm |
| Reindex đặt `cho_xu_ly` vô điều kiện | "trả 409" | mệnh đề WHERE |

- [ ] **B10: Commit**

```
fix(kb): trích xuất trong worker thread, bộ đếm lần thử, dọn đoạn mồ côi
```

## Định nghĩa hoàn thành

- Nguồn làm treo bị bỏ sau đúng 2 lần, không thử vô hạn qua các lần khởi động.
- Worker quá hạn bị `terminate()`, luồng chính vẫn chạy nhịp bình thường.
- Dashboard mở được trước khi worker chạy việc nặng.
- Đoạn và hàng FTS mồ côi có đường dọn.
- Danh sách chờ không kéo toàn văn.
- Bất biến "một connection SQLite" giữ nguyên - worker không mở DB.
- 7/7 phép phá đỏ đúng chỗ, mỗi phép ghi rõ đường code được chạy.

## Rủi ro

| Rủi ro | Chặn thế nào |
|---|---|
| Worker thread không import được module TS lúc chạy `tsx` | Kiểm sớm ở B2; nếu vướng thì báo lại, đừng tự đổi sang `fork` (đã đo tốn 53,5 MB) |
| `terminate()` không cắt được ca cụ thể của ta | Đã đo cắt được vòng lặp CPU đồng bộ trong 2,2 ms; nếu ca thật khác thì báo số đo |
| Cột mới làm migration chạy trên DB thật của người dùng | `ALTER TABLE ... ADD COLUMN ... DEFAULT 0` idempotent; kiểm `database.ts` chạy ở module scope |
| Bot chậm hẳn khi worker quay CPU trên `cpus: "1"` | Người dùng đã chốt chấp nhận; ghi số đo vào report để biết mức thật |

## Bước tiếp

Phase 03 độc lập, làm được ngay.
