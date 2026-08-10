# Phase 05 - API và tab dashboard

**Ưu tiên:** cao. Không có phase này thì không ai nạp được tài liệu.
**Trạng thái:** XONG. **Cần:** phase 01-04.

## Bối cảnh

- Mẫu route: `src/server/routes/memory-routes.ts` (ngắn), `schedule-routes.ts` (đủ CRUD)
- Đăng ký route: `src/server/dashboard-server.ts` (`app.route("/api/...", ...)`)
- Mẫu trang: `web/src/pages/memory-page.tsx`, `schedule-page.tsx`
- Nav: `web/src/layout/sidebar-nav.tsx` (nhóm "Dữ liệu" đang có Memory)
- Route web: `web/src/app.tsx`
- Ghi file an toàn: `src/conversation/media-store.ts` (`sanitizeSegment`)
- Gán theo agent: mẫu `disabledTools` ở `web/src/pages/agent-tools-section.tsx`

## Nhận định then chốt

**Xử lý nguồn phải CHẠY NỀN, không chặn request upload.** `node:sqlite` chạy
đồng bộ trong tiến trình một luồng - đọc PDF 200 trang rồi ghi 300 đoạn ngay
trong handler là chặn cả bot: không nhận tin, không chạy lượt nào. Upload xong
trả `202` với trạng thái `cho_xu_ly`, xử lý ở tick sau, dashboard hỏi lại.

**Trần dung lượng phải chặn ở TẦNG ĐỌC, không phải sau khi đọc xong.** Đọc hết
100MB vào RAM rồi mới báo "quá lớn" là đã muộn.

**Tên file người dùng đặt KHÔNG được dùng làm đường dẫn.** Lưu theo `id` sinh
ra, tên gốc chỉ để hiển thị. `media-store.ts` đã có `sanitizeSegment` nhưng
cách chắc hơn là không lấy tên người dùng vào đường dẫn chút nào.

**Xóa nguồn phải xóa CẢ FILE trên đĩa.** Phase 01 dọn 4 nơi trong DB; file thì
route phải tự lo, không thì `dataDir/kb/` phình mãi.

## File

**Tạo:**
- `src/server/routes/kb-routes.ts` - CRUD nguồn, upload, gán agent
- `src/knowledge/kb-file-store.ts` - ghi/xóa file trong `dataDir/kb/`
- `src/knowledge/kb-ingest-worker.ts` - vòng xử lý nguồn `cho_xu_ly`
- `src/server/routes/kb-routes.test.ts`
- `src/knowledge/kb-ingest-worker.test.ts`
- `web/src/pages/knowledge-page.tsx`
- `web/src/pages/kb-source-row.tsx`
- `web/src/pages/kb-add-source-modal.tsx`

**Sửa:**
- `src/server/dashboard-server.ts` - `app.route("/api/kb", kbRoutes)`
- `src/index.ts` - khởi động `kb-ingest-worker`
- `web/src/app.tsx` - `<Route path="/knowledge" ...>`
- `web/src/layout/sidebar-nav.tsx` - thêm vào nhóm "Dữ liệu"
- `web/src/pages/agent-tools-section.tsx` hoặc trang agent - phần chọn nguồn

## Giao diện

**Consumes:** `taoNguon` / `layNguon` / `danhSachNguon` / `datTrangThai` /
`xoaNguon` (phase 01), `luuDoan` (phase 01), `docChuTuFile` + `catThanhDoan`
(phase 02), `nguonCuaAgent` + `datNguonChoAgent` (phase 01).

**Produces:**

```ts
// kb-file-store.ts - đường dẫn trả về là TƯƠNG ĐỐI so với dataDir
export function luuFile(sourceId: string, dinhDang: string, buf: Buffer): string;
export function xoaFile(duongDanTuongDoi: string): void;

// kb-ingest-worker.ts
/** Xử lý mọi nguồn đang `cho_xu_ly`; một nguồn hỏng không dừng vòng. */
export function xuLyMotVong(): Promise<void>;
/** Gọi một lần lúc boot: mọi `dang_xu_ly` sót lại từ lần chạy trước về `cho_xu_ly`. */
export function goNguonKetLucKhoiDong(): void;
export function batDauWorker(): () => void;  // trả hàm dừng, mẫu `scheduler-loop.ts`

// kb-routes.ts
export const kbRoutes: Hono;
```

Một vòng `xuLyMotVong` làm đúng chuỗi này cho TỪNG nguồn `cho_xu_ly`:

1. `datTrangThai(id, "dang_xu_ly")` - giành nguồn trước, để vòng sau không nhặt lại.
2. Lấy chữ: `loai === "text"` thì dùng thẳng `noiDungGoc`; `loai === "file"` thì
   đọc `duongDan` rồi `docChuTuFile(buf, dinhDang)`.
3. `catThanhDoan(chu, thamSo)` -> `luuDoan(id, doan)`.
4. `datTrangThai(id, "san_sang", { soDoan })`, hoặc `"hong"` kèm `loi` nếu bước
   2 hay 3 ném. Try/catch bọc TỪNG nguồn, không bọc cả vòng.

> **Đính chính:** bước 1 ở đợt SỬA lỗi sau đó đổi từ `datTrangThai(id,
> "dang_xu_ly")` (UPDATE vô điều kiện) sang `giaNguonChoXuLy(id, tranLanThu)`
> (so sánh-rồi-đổi NGUYÊN TỬ trong một câu UPDATE, kèm tăng `so_lan_thu`) -
> UPDATE vô điều kiện cho phép hai vòng xử lý chồng lấn thời gian thật giành
> LẠI được nguồn nhau đã xử lý xong, gây xử lý trùng. Code hiện tại đúng hơn
> bản mô tả ở đây; xem `src/knowledge/kb-source-queries.ts#giaNguonChoXuLy` và
> mục "Kho tri thức" ở `docs/system-architecture.md`. Đoạn trên giữ nguyên làm
> bản ghi lịch sử của thiết kế ban đầu.

Xóa nguồn ở route phải theo đúng thứ tự: `layNguon(id)` lấy `duongDan` TRƯỚC,
rồi `xoaNguon(id)`, rồi `xoaFile(duongDan)`. Xóa dòng DB trước mà chưa cầm
`duongDan` là mất luôn đường tìm tới file.

## API

| Method | Đường dẫn | Việc |
|---|---|---|
| `GET` | `/api/kb/sources` | Danh sách nguồn kèm trạng thái, số đoạn |
| `POST` | `/api/kb/sources/text` | Tạo nguồn gõ tay: `{ ten, noiDung }` |
| `POST` | `/api/kb/sources/file` | Upload multipart, trả `202` |
| `DELETE` | `/api/kb/sources/:id` | Xóa nguồn + file trên đĩa |
| `POST` | `/api/kb/sources/:id/reindex` | Đặt lại `cho_xu_ly` để xử lý lại |
| `GET` | `/api/kb/agents/:agentId/sources` | Nguồn đã bật cho agent |
| `PUT` | `/api/kb/agents/:agentId/sources` | Đặt lại danh sách: `{ sourceIds }` |

Hono đọc multipart bằng `await c.req.parseBody()`. Kiểm chữ ký thật của file
(magic bytes) chứ không tin đuôi tên: PDF phải bắt đầu `%PDF`, docx/xlsx phải
bắt đầu `PK`.

## Tham số vào trang Cấu hình

| Key | Mặc định | Min-Max | Nhãn |
|---|---|---|---|
| `KB_MAX_FILE_MB` | 20 | 1-100 | Dung lượng tối đa mỗi file |

## Các bước

- [ ] **B1: Ghi file an toàn (test trước)**

```ts
it("lưu theo id sinh ra, KHÔNG dùng tên người dùng đặt làm đường dẫn", () => {
  const p = fileStore.luuFile("src-1", "pdf", Buffer.from("%PDF-x"));
  assert.match(p, /^kb\/src-1\.pdf$/);
});

it("tên file kiểu vượt thư mục không tạo được file ngoài dataDir", () => {
  const p = fileStore.luuFile("../../../etc/passwd", "txt", Buffer.from("x"));
  assert.ok(!p.includes(".."), `đường dẫn thoát ra: ${p}`);
});

it("xóa nguồn thì file trên đĩa cũng mất", () => {
  const p = fileStore.luuFile("src-2", "txt", Buffer.from("x"));
  fileStore.xoaFile(p);
  assert.equal(fs.existsSync(path.join(dataDir, p)), false);
});
```

- [ ] **B2: Vòng xử lý nền**

```ts
it("nguồn cho_xu_ly được cắt đoạn rồi chuyển sang san_sang", async () => {
  const n = store.taoNguon({ ten: "x", loai: "text", noiDungGoc: "# Bảo hành\n\n12 tháng." });
  await worker.xuLyMotVong();
  const sau = store.layNguon(n.id)!;
  assert.equal(sau.trangThai, "san_sang");
  assert.ok(sau.soDoan > 0);
});

it("file hỏng thì trạng thái hong kèm câu tiếng Việt đọc được, KHÔNG kẹt ở dang_xu_ly", async () => {
  const n = store.taoNguon({ ten: "hỏng", loai: "file", dinhDang: "pdf", duongDan: fileStore.luuFile("h", "pdf", Buffer.from("khong phai pdf")) });
  await worker.xuLyMotVong();
  const sau = store.layNguon(n.id)!;
  assert.equal(sau.trangThai, "hong");
  assert.match(sau.loi, /không đọc được/i);
});

it("một nguồn hỏng KHÔNG chặn các nguồn còn lại trong cùng vòng", async () => {
  const hong = store.taoNguon({ ten: "hỏng", loai: "file", dinhDang: "pdf", duongDan: fileStore.luuFile("h2", "pdf", Buffer.from("rac")) });
  const tot = store.taoNguon({ ten: "tốt", loai: "text", noiDungGoc: "# Giá\n\n25.000đ" });

  await worker.xuLyMotVong();

  assert.equal(store.layNguon(hong.id)!.trangThai, "hong");
  assert.equal(store.layNguon(tot.id)!.trangThai, "san_sang", "một nguồn hỏng không được kéo cả vòng chết theo");
});

it("nguồn kẹt ở dang_xu_ly từ lần chạy trước được đặt lại lúc khởi động", () => {
  // Worker chết giữa chừng (process bị giết) thì nguồn nằm mãi ở `dang_xu_ly`
  // và không lần nào xử lý lại - phải tự gỡ lúc boot
  const n = store.taoNguon({ ten: "kẹt", loai: "text", noiDungGoc: "x" });
  store.datTrangThai(n.id, "dang_xu_ly");
  worker.goNguonKetLucKhoiDong();
  assert.equal(store.layNguon(n.id)!.trangThai, "cho_xu_ly");
});
```

- [ ] **B3: Route CRUD + upload**

Lấy phiên đăng nhập theo đúng nếp `src/server/routes/tuning-routes.test.ts`:
đăng nhập một lần ở `before`, giữ chuỗi cookie trong biến dùng chung cả file.
Multipart dựng bằng `FormData` + `File` sẵn có của Node 24 - **không tự đặt
`content-type`**, để `fetch` tự sinh boundary.

```ts
let cookie: string;

before(async () => {
  const login = await app.request("/api/login", {
    method: "POST",
    body: JSON.stringify({ password: env.DASHBOARD_PASSWORD }),
    headers: { "content-type": "application/json" },
  });
  cookie = login.headers.get("set-cookie")!.split(";")[0]!;
});

function formFile(ten: string, buf: Buffer): FormData {
  const fd = new FormData();
  fd.append("ten", ten);
  fd.append("file", new File([buf], ten));
  return fd;
}
const guiJson = (duong: string, method: string, than: unknown) =>
  app.request(duong, { method, body: JSON.stringify(than), headers: { cookie, "content-type": "application/json" } });

it("upload trả 202 và trạng thái cho_xu_ly - KHÔNG chặn request để xử lý", async () => {
  const res = await app.request("/api/kb/sources/file", { method: "POST", body: formFile("gia.txt", Buffer.from("Bảng giá")), headers: { cookie } });
  assert.equal(res.status, 202);
  assert.equal(store.danhSachNguon()[0]!.trangThai, "cho_xu_ly");
});

it("file quá trần bị từ chối bằng 413, KHÔNG ghi gì xuống đĩa", async () => {
  tuning.setTuning("KB_MAX_FILE_MB", 1);
  const qua = Buffer.alloc(2 * 1024 * 1024, 0x61);
  const res = await app.request("/api/kb/sources/file", { method: "POST", body: formFile("to.txt", qua), headers: { cookie } });
  assert.equal(res.status, 413);
  assert.equal(store.danhSachNguon().length, 0);
  assert.equal(fs.readdirSync(path.join(dataDir, "kb")).length, 0);
});

it("đuôi .pdf nhưng nội dung không phải PDF bị từ chối 400", async () => {
  // Tin đuôi tên là mở đường cho file BẤT KỲ nằm trong dataDir
  const res = await app.request("/api/kb/sources/file", { method: "POST", body: formFile("gia.pdf", Buffer.from("PK\x03\x04 day la zip")), headers: { cookie } });
  assert.equal(res.status, 400);
});

it("gõ tay nội dung tạo được nguồn loai='text', không cần file nào", async () => {
  const res = await guiJson("/api/kb/sources/text", "POST", { ten: "Giờ làm việc", noiDung: "8h - 21h mỗi ngày" });
  assert.equal(res.status, 201);
  const n = store.danhSachNguon()[0]!;
  assert.equal(n.loai, "text");
  assert.equal(n.trangThai, "cho_xu_ly");
  assert.equal(n.duongDan, "", "nguồn gõ tay không được sinh file trên đĩa");
});

it("gõ tay với nội dung rỗng bị từ chối 400", async () => {
  const res = await guiJson("/api/kb/sources/text", "POST", { ten: "trống", noiDung: "   " });
  assert.equal(res.status, 400);
});

it("mọi route KB đều đòi đăng nhập", async () => {
  const duong = [["GET", "/api/kb/sources"], ["POST", "/api/kb/sources/text"], ["DELETE", "/api/kb/sources/x"],
                 ["GET", "/api/kb/agents/a/sources"], ["PUT", "/api/kb/agents/a/sources"]] as const;
  for (const [m, p] of duong) {
    assert.equal((await app.request(p, { method: m })).status, 401, `${m} ${p} không đòi đăng nhập`);
  }
});
```

- [ ] **B4: Route gán nguồn cho agent**

```ts
it("PUT thay thế toàn bộ danh sách", async () => {
  await guiJson("/api/kb/agents/a1/sources", "PUT", { sourceIds: [n1.id, n2.id] });
  await guiJson("/api/kb/agents/a1/sources", "PUT", { sourceIds: [n2.id] });
  assert.deepEqual(binding.nguonCuaAgent("a1"), [n2.id]);
});

it("gán nguồn KHÔNG tồn tại bị từ chối 400", async () => {
  // Không chặn ở đây thì bảng gán tích lũy id rác, và trang agent hiện ô tick
  // trỏ vào hư không
  const res = await guiJson("/api/kb/agents/a1/sources", "PUT", { sourceIds: ["khong-co"] });
  assert.equal(res.status, 400);
});
```

- [ ] **B5: Xóa nguồn dọn cả file**

```ts
it("DELETE xóa cả dòng DB lẫn file trên đĩa", async () => {
  const duongDan = fileStore.luuFile("src-del", "txt", Buffer.from("x"));
  const n = store.taoNguon({ ten: "xóa thử", loai: "file", dinhDang: "txt", duongDan });
  const tuyetDoi = path.join(dataDir, duongDan);
  assert.equal(fs.existsSync(tuyetDoi), true, "chưa xóa mà file đã không có thì test vô nghĩa");

  const res = await app.request(`/api/kb/sources/${n.id}`, { method: "DELETE", headers: { cookie } });

  assert.equal(res.status, 200);
  assert.equal(store.layNguon(n.id), null);
  assert.equal(fs.existsSync(tuyetDoi), false, "dòng DB mất nhưng file còn nằm lại - đĩa phình mãi");
});
```

- [ ] **B6: Trang dashboard**

Trang `/knowledge` trong nhóm "Dữ liệu" của nav:
- Bảng nguồn: tên, loại, định dạng, **trạng thái** (chờ / đang xử lý / sẵn sàng / hỏng kèm lý do), số đoạn, dung lượng, ngày.
- Nút "Thêm nguồn" mở modal hai tab: **Tải file lên** và **Gõ nội dung**.
- Nút xử lý lại cho nguồn `hong`.
- Nút xóa có hộp xác nhận (mẫu `confirm-dialog.tsx`).
- Trang agent: khối chọn nguồn, mặc định không tick gì, kèm câu "Agent chỉ đọc được nguồn đã tick".

Theo `web/src/shared/ui-bits.tsx` và mẫu `memory-page.tsx`. Chuẩn UI của repo:
tự kiểm responsive, control tự dựng, con trỏ đúng trạng thái trước khi báo xong.

- [ ] **B7: `pnpm typecheck` (cả `-p web`) + `pnpm test`**

- [ ] **B8: Phá code kiểm 6 chốt**

| Phá gì | Test phải đỏ |
|---|---|
| Bỏ kiểm trần dung lượng | "file quá trần bị 413" |
| Tin đuôi tên thay vì magic bytes | "đuôi .pdf nhưng nội dung không phải" |
| Dùng tên người dùng làm đường dẫn | "không tạo được file ngoài dataDir" |
| Xử lý đồng bộ trong handler | "upload trả 202" |
| DELETE không xóa file | "xóa cả dòng DB lẫn file" |
| Bỏ middleware auth khỏi route KB | "mọi route KB đều đòi đăng nhập" |

- [ ] **B9: Cập nhật tài liệu**

- `docs/project-roadmap.md`: mục V3.15 - đối chiếu goclaw/Hermes, thông số
  chuẩn đã tra, ca "mấy giờ đóng cửa" trượt làm mốc cho đợt vector.
- `CHANGELOG.md`: mục "Thêm".
- `README.md`: số test.
- `CLAUDE.md`: một dòng ở "Quyết định đã chốt" - nạp bằng tool chứ không tự
  nhét (lý do prompt cache), và mặc định agent không đọc được nguồn nào.

- [ ] **B10: Commit**

```
feat(kb): tab kho tri thức - nạp file, gõ tay, gán nguồn cho agent
```

## Định nghĩa hoàn thành

- Nạp được cả 5 định dạng qua dashboard, gõ tay cũng được.
- Upload không chặn bot; trạng thái hiện đúng, nguồn hỏng nói rõ lý do.
- Gán nguồn cho agent chạy, mặc định không tick gì.
- Xóa dọn sạch DB lẫn đĩa.
- 6/6 phép phá đỏ đúng chỗ.

## Rủi ro

| Rủi ro | Chặn thế nào |
|---|---|
| Xử lý đồng bộ chặn cả bot | Chạy nền, upload trả 202 |
| File độc / vượt thư mục | Lưu theo id sinh ra, kiểm magic bytes, trần dung lượng |
| Nguồn kẹt mãi ở `dang_xu_ly` khi worker chết giữa chừng | Lúc khởi động, đặt lại mọi `dang_xu_ly` về `cho_xu_ly` |
| Đĩa đầy vì file mồ côi | DELETE xóa cả file, có test |

## Bước tiếp

Sau phase này chạy thật vài hôm, đo tỉ lệ tra trượt. Đủ nhiều thì mở đợt vector
- RRF đã chừa sẵn chỗ, chỉ là truyền thêm một danh sách đã xếp hạng.
