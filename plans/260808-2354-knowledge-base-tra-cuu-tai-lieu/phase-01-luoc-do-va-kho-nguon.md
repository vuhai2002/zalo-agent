# Phase 01 - Lược đồ và kho nguồn

**Ưu tiên:** cao nhất, mọi phase sau đều dựng trên đây.
**Trạng thái:** XONG.

## Bối cảnh

- Nghiên cứu: [`reports/nghien-cuu-kb-va-thong-so-chuan.md`](reports/nghien-cuu-kb-va-thong-so-chuan.md)
- Mẫu migration: `src/conversation/database.ts` (chạy ở MODULE SCOPE)
- Mẫu xóa nhiều bảng trong một giao dịch: `src/conversation/wipe-thread-context.ts`
- Mẫu store: `src/conversation/memory-store.ts`

## Nhận định then chốt

**Lược đồ dựng ĐỦ 4 bảng ngay phase này, kể cả bảng ảo FTS5** dù phase 03 mới
truy vấn nó. Lý do: `xoaNguon` phải dọn sạch cả 4 nơi, mà bất biến "xóa không
để lại mồ côi" là thứ phải có test ngay từ đầu. Tách bảng FTS sang phase sau
nghĩa là phase 01 có một test xóa KHÔNG đầy đủ, rồi không ai nhớ quay lại siết.

**Không dùng FOREIGN KEY.** `database.ts` không bật `PRAGMA foreign_keys`, nên
khai `REFERENCES ... ON DELETE CASCADE` sẽ là một lời hứa suông mà đọc code lại
tưởng có hiệu lực. Xóa tường minh trong một giao dịch, có test đếm.

**Hàm bỏ dấu thuộc phase này, không để sang phase 02.** Cột `phang` là cột được
FTS5 index, và nó phải chứa chữ ĐÃ bỏ dấu ngay từ dòng đầu tiên ghi vào. Nếu
phase 01 ghi tạm chữ còn dấu rồi phase 02 mới sửa lại, mọi dòng phase 01 tạo ra
sẽ nằm sai định dạng mà không có gì phát hiện - bảng FTS không báo lỗi, chỉ là
tìm không ra.

**FTS5 dạng thường, `rowid` gán bằng `kb_chunks.id`.** Cân nhắc `content=''`
(contentless, tiết kiệm nửa dung lượng) nhưng loại: xóa phải gửi lệnh đặc biệt
`INSERT INTO fts(fts,rowid,...) VALUES('delete',...)`, dễ quên và hỏng câm.
Kho tri thức vài MB thì nhân đôi phần chữ đã bỏ dấu là không đáng kể.

## Yêu cầu

- Ba bảng thật + một bảng ảo FTS5.
- CRUD nguồn, lưu đoạn, gán nguồn cho agent.
- Agent **chưa gán nguồn nào thì không đọc được gì** (mặc định ĐÓNG).
- Xóa nguồn dọn sạch cả 4 nơi trong một giao dịch.

## File

**Tạo:**
- `src/shared/bo-dau-tieng-viet.ts` - bỏ dấu, dùng cho cột `phang` và cho câu hỏi ở phase 03
- `src/knowledge/kb-schema.ts` - câu lệnh tạo bảng, gọi từ `database.ts`
- `src/knowledge/kb-source-store.ts` - CRUD nguồn + trạng thái
- `src/knowledge/kb-chunk-store.ts` - lưu/xóa đoạn, giữ FTS đồng bộ
- `src/knowledge/kb-agent-binding.ts` - gán nguồn cho agent
- `src/shared/bo-dau-tieng-viet.test.ts`
- `src/knowledge/kb-source-store.test.ts`
- `src/knowledge/kb-chunk-store.test.ts`
- `src/knowledge/kb-agent-binding.test.ts`

**Sửa:**
- `src/conversation/database.ts` - gọi `taoBangKnowledgeBase(db)` trong `runMigrations()`

## Giao diện

**Produces** (phase sau dùng):

```ts
// bo-dau-tieng-viet.ts
export function boDauTiengViet(s: string): string;

// kb-source-store.ts
export type TrangThaiNguon = "cho_xu_ly" | "dang_xu_ly" | "san_sang" | "hong";
export type LoaiNguon = "file" | "text";
export type KbSource = {
  id: string; ten: string; loai: LoaiNguon; dinhDang: string;
  duongDan: string; noiDungGoc: string;
  trangThai: TrangThaiNguon; loi: string; soDoan: number; soByte: number;
  createdAt: string; updatedAt: string;
};
export function taoNguon(p: { ten: string; loai: LoaiNguon; dinhDang?: string; duongDan?: string; noiDungGoc?: string; soByte?: number }): KbSource;
export function layNguon(id: string): KbSource | null;
export function danhSachNguon(): KbSource[];
export function datTrangThai(id: string, trangThai: TrangThaiNguon, p?: { loi?: string; soDoan?: number }): void;
export function xoaNguon(id: string): { soDoanDaXoa: number };

// kb-chunk-store.ts
export type DoanMoi = { thuTu: number; tieuDe: string; noiDung: string };
export function luuDoan(sourceId: string, doan: DoanMoi[]): void;
export function demDoan(sourceId: string): number;
/**
 * Tra ngược đoạn từ id, ĐÃ JOIN sang `kb_sources` để lấy tên nguồn.
 * Phase 03 cần `tenNguon` để model dẫn nguồn cho khách - join ở đây chứ không
 * bắt caller tự join, tránh hai nơi cùng biết cách nối bảng.
 * Trả về theo ĐÚNG thứ tự của `ids` truyền vào (thứ tự do RRF quyết), không
 * theo thứ tự SQL trả về.
 */
export function layDoanTheoId(ids: number[]): { id: number; sourceId: string; tenNguon: string; tieuDe: string; noiDung: string }[];

// kb-agent-binding.ts
export function nguonCuaAgent(agentId: string): string[];
export function datNguonChoAgent(agentId: string, sourceIds: string[]): void;
```

## Lược đồ

```sql
CREATE TABLE IF NOT EXISTS kb_sources (
  id           TEXT PRIMARY KEY,
  ten          TEXT NOT NULL,
  loai         TEXT NOT NULL CHECK (loai IN ('file', 'text')),
  dinh_dang    TEXT NOT NULL DEFAULT '',
  duong_dan    TEXT NOT NULL DEFAULT '',
  noi_dung_goc TEXT NOT NULL DEFAULT '',
  trang_thai   TEXT NOT NULL DEFAULT 'cho_xu_ly'
               CHECK (trang_thai IN ('cho_xu_ly', 'dang_xu_ly', 'san_sang', 'hong')),
  loi          TEXT NOT NULL DEFAULT '',
  so_doan      INTEGER NOT NULL DEFAULT 0,
  so_byte      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS kb_chunks (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  thu_tu    INTEGER NOT NULL,
  tieu_de   TEXT NOT NULL DEFAULT '',
  noi_dung  TEXT NOT NULL,
  phang     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_source ON kb_chunks (source_id);

-- Bảng ảo: chỉ index cột đã BỎ DẤU. Câu hỏi cũng bỏ dấu trước khi tìm.
-- `remove_diacritics 2` của SQLite không xử lý được chữ `đ` (U+0111 là chữ cái
-- có gạch ngang, không phải dấu phụ tổ hợp) - đã đo.
CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5(
  phang,
  tokenize = 'unicode61'
);

CREATE TABLE IF NOT EXISTS agent_kb_sources (
  agent_id  TEXT NOT NULL,
  source_id TEXT NOT NULL,
  PRIMARY KEY (agent_id, source_id)
);
```

`kb_chunks_fts.rowid` gán bằng `kb_chunks.id` khi chèn, để `bm25()` trả về rowid
là tra ngược được đoạn.

## Các bước

- [ ] **B0: Bỏ dấu tiếng Việt (test trước, không chạm DB)**

`src/shared/bo-dau-tieng-viet.test.ts`:

```ts
it("bỏ dấu thanh, dấu mũ và chữ đ", () => {
  assert.equal(boDauTiengViet("Chính sách đổi trả"), "Chinh sach doi tra");
  assert.equal(boDauTiengViet("ĐƯỢC"), "DUOC");
});

it("giữ nguyên chữ và số không dấu", () => {
  assert.equal(boDauTiengViet("Bao hanh 12 thang"), "Bao hanh 12 thang");
});
```

Chữ `đ` phải xử lý RIÊNG bằng phép thay chuỗi - `normalize("NFD")` không tách
nó vì U+0111 là chữ cái có gạch ngang, không phải dấu phụ tổ hợp. Đã đo:

```ts
// U+0300-U+036F: dấu phụ tổ hợp. Viết bằng mã thay vì dán ký tự tổ hợp trần
// vào file nguồn - dán vào thì editor hiển thị dính liền ký tự đứng trước.
const DAU_PHU_TO_HOP = /[\u0300-\u036f]/g;

export function boDauTiengViet(s: string): string {
  return s.normalize("NFD").replace(DAU_PHU_TO_HOP, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}
```

- [ ] **B1: Viết test lược đồ + tạo nguồn (đỏ)**

`src/knowledge/kb-source-store.test.ts`:

```ts
it("tạo nguồn rồi đọc lại thấy đúng, trạng thái mặc định là chờ xử lý", () => {
  const n = store.taoNguon({ ten: "Chính sách đổi trả", loai: "text", noiDungGoc: "Đổi trả trong 7 ngày." });
  const doc = store.layNguon(n.id)!;
  assert.equal(doc.ten, "Chính sách đổi trả");
  assert.equal(doc.trangThai, "cho_xu_ly");
  assert.equal(doc.soDoan, 0);
});
```

- [ ] **B2: Chạy test, xác nhận đỏ vì chưa có module**

`pnpm exec tsx --test src/knowledge/kb-source-store.test.ts`

- [ ] **B3: Viết `kb-schema.ts` + `kb-source-store.ts` tối thiểu, nối vào `database.ts`**

- [ ] **B4: Chạy test, xác nhận xanh**

- [ ] **B5: Test đoạn + FTS đồng bộ (đỏ trước, xanh sau)**

```ts
it("lưu đoạn thì hàng FTS mang đúng rowid của đoạn", () => {
  chunkStore.luuDoan(id, [{ thuTu: 0, tieuDe: "", noiDung: "Bảo hành 12 tháng" }]);
  const row = database.db.prepare("SELECT rowid FROM kb_chunks_fts").get() as { rowid: number };
  const doan = database.db.prepare("SELECT id FROM kb_chunks").get() as { id: number };
  assert.equal(row.rowid, doan.id, "rowid lệch là tra ngược ra nhầm đoạn");
});

it("lưu đoạn lần hai THAY THẾ lần đầu, không cộng dồn", () => {
  chunkStore.luuDoan(id, [{ thuTu: 0, tieuDe: "", noiDung: "bản cũ" }]);
  chunkStore.luuDoan(id, [{ thuTu: 0, tieuDe: "", noiDung: "bản mới" }]);
  assert.equal(chunkStore.demDoan(id), 1);
});

it("cột phang chứa chữ đã bỏ dấu, noi_dung giữ nguyên dấu", () => {
  // `phang` là cột FTS5 index; còn dấu thì phase 03 tìm mãi không ra mà không
  // có gì báo lỗi
  chunkStore.luuDoan(id, [{ thuTu: 0, tieuDe: "", noiDung: "Bảo hành 12 tháng" }]);
  const r = database.db.prepare("SELECT phang, noi_dung FROM kb_chunks").get() as { phang: string; noi_dung: string };
  assert.equal(r.phang, "Bao hanh 12 thang");
  assert.equal(r.noi_dung, "Bảo hành 12 tháng", "bản gửi cho model phải còn dấu");
});

it("tiêu đề cũng vào cột phang - khách hỏi bằng chữ trong tiêu đề phải tìm ra", () => {
  chunkStore.luuDoan(id, [{ thuTu: 0, tieuDe: "Chính sách đổi trả", noiDung: "Trong vòng 7 ngày" }]);
  const r = database.db.prepare("SELECT phang FROM kb_chunks").get() as { phang: string };
  assert.match(r.phang, /Chinh sach doi tra/);
});
```

- [ ] **B6: Test XÓA SẠCH - bất biến quan trọng nhất của phase**

```ts
it("xóa nguồn dọn sạch CẢ BỐN nơi, không để lại mồ côi", () => {
  const n = store.taoNguon({ ten: "x", loai: "text", noiDungGoc: "abc" });
  chunkStore.luuDoan(n.id, [{ thuTu: 0, tieuDe: "", noiDung: "nội dung abc" }]);
  binding.datNguonChoAgent("agent-1", [n.id]);

  store.xoaNguon(n.id);

  const dem = (sql: string) => (database.db.prepare(sql).get() as { n: number }).n;
  assert.equal(dem("SELECT COUNT(*) AS n FROM kb_sources"), 0, "nguồn");
  assert.equal(dem("SELECT COUNT(*) AS n FROM kb_chunks"), 0, "đoạn");
  assert.equal(dem("SELECT COUNT(*) AS n FROM kb_chunks_fts"), 0, "hàng FTS - dễ quên nhất");
  assert.equal(dem("SELECT COUNT(*) AS n FROM agent_kb_sources"), 0, "gán cho agent");
});

it("xóa nguồn KHÔNG đụng nguồn khác", () => {
  const a = store.taoNguon({ ten: "a", loai: "text", noiDungGoc: "1" });
  const b = store.taoNguon({ ten: "b", loai: "text", noiDungGoc: "2" });
  chunkStore.luuDoan(a.id, [{ thuTu: 0, tieuDe: "", noiDung: "của a" }]);
  chunkStore.luuDoan(b.id, [{ thuTu: 0, tieuDe: "", noiDung: "của b" }]);
  store.xoaNguon(a.id);
  assert.equal(chunkStore.demDoan(b.id), 1);
});
```

- [ ] **B7: Test mặc định ĐÓNG**

```ts
it("agent chưa gán nguồn nào thì đọc được RỖNG - mặc định đóng", () => {
  store.taoNguon({ ten: "công khai?", loai: "text", noiDungGoc: "x" });
  assert.deepEqual(binding.nguonCuaAgent("agent-moi"), []);
});

it("đặt lại danh sách là THAY THẾ, không cộng dồn", () => {
  binding.datNguonChoAgent("a1", [n1.id, n2.id]);
  binding.datNguonChoAgent("a1", [n2.id]);
  assert.deepEqual(binding.nguonCuaAgent("a1"), [n2.id]);
});
```

- [ ] **B8: `pnpm typecheck` + `pnpm test` toàn bộ**

- [ ] **B9: Phá code kiểm 6 chốt**

| Phá gì | Test phải đỏ |
|---|---|
| `boDauTiengViet` bỏ nhánh xử lý `đ` | "bỏ dấu thanh, dấu mũ và chữ đ" |
| `luuDoan` ghi thẳng `noiDung` vào `phang` (quên bỏ dấu) | "cột phang chứa chữ đã bỏ dấu" |
| `xoaNguon` bỏ dòng xóa `kb_chunks_fts` | "dọn sạch CẢ BỐN nơi" |
| `luuDoan` không xóa đoạn cũ trước khi ghi | "THAY THẾ lần đầu" |
| `nguonCuaAgent` trả mọi nguồn khi chưa gán | "mặc định đóng" |
| `datNguonChoAgent` cộng dồn thay vì thay thế | "THAY THẾ, không cộng dồn" |

- [ ] **B10: Commit**

```
feat(kb): lược đồ kho tri thức và kho nguồn
```

## Định nghĩa hoàn thành

- 4 bảng tạo được, `pnpm test` xanh.
- Xóa nguồn để lại 0 dòng ở cả 4 nơi, có test đếm từng nơi.
- Agent chưa gán đọc được rỗng.
- Cột `phang` bỏ dấu, `noi_dung` còn dấu.
- 6/6 phép phá đỏ đúng chỗ.

## Rủi ro

| Rủi ro | Chặn thế nào |
|---|---|
| Quên xóa hàng FTS -> tìm ra đoạn đã xóa, bot trả lời theo tài liệu không còn | Test B6 đếm thẳng `kb_chunks_fts` |
| `rowid` FTS lệch `kb_chunks.id` -> tra ngược ra nhầm đoạn | Test B5 so hai id |
| Migration chạy ở module scope, test import nhầm DB thật | Luật CLAUDE.md: `setupTestEnv()` trước, `await import()` sau |

## Bước tiếp

Phase 02 dùng `luuDoan` để ghi kết quả cắt đoạn.
