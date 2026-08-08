import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let store: typeof import("./kb-source-store.js");
let chunkStore: typeof import("./kb-chunk-store.js");
let database: typeof import("../conversation/database.js");
let id: string;

before(async () => {
  dataDir = setupTestEnv();
  store = await import("./kb-source-store.js");
  chunkStore = await import("./kb-chunk-store.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(() => {
  for (const t of ["kb_sources", "kb_chunks", "kb_chunks_fts", "agent_kb_sources"]) {
    database.db.exec(`DELETE FROM ${t}`);
  }
  id = store.taoNguon({ ten: "nguồn test", loai: "text", noiDungGoc: "x" }).id;
});

describe("kb-chunk-store - lưu đoạn giữ FTS đồng bộ", () => {
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
    const r = database.db.prepare("SELECT phang, noi_dung FROM kb_chunks").get() as {
      phang: string;
      noi_dung: string;
    };
    assert.equal(r.phang, "Bao hanh 12 thang");
    assert.equal(r.noi_dung, "Bảo hành 12 tháng", "bản gửi cho model phải còn dấu");
  });

  it("tiêu đề cũng vào cột phang - khách hỏi bằng chữ trong tiêu đề phải tìm ra", () => {
    chunkStore.luuDoan(id, [{ thuTu: 0, tieuDe: "Chính sách đổi trả", noiDung: "Trong vòng 7 ngày" }]);
    const r = database.db.prepare("SELECT phang FROM kb_chunks").get() as { phang: string };
    assert.match(r.phang, /Chinh sach doi tra/);
  });
});

describe("kb-chunk-store - demDoan", () => {
  it("nguồn chưa có đoạn nào đếm ra 0", () => {
    assert.equal(chunkStore.demDoan(id), 0);
  });

  it("đếm đúng số đoạn đã lưu", () => {
    chunkStore.luuDoan(id, [
      { thuTu: 0, tieuDe: "", noiDung: "đoạn 1" },
      { thuTu: 1, tieuDe: "", noiDung: "đoạn 2" },
      { thuTu: 2, tieuDe: "", noiDung: "đoạn 3" },
    ]);
    assert.equal(chunkStore.demDoan(id), 3);
  });
});

describe("kb-chunk-store - layDoanTheoId", () => {
  it("trả về đúng thứ tự của ids truyền vào, không theo thứ tự SQL", () => {
    chunkStore.luuDoan(id, [
      { thuTu: 0, tieuDe: "", noiDung: "đoạn A" },
      { thuTu: 1, tieuDe: "", noiDung: "đoạn B" },
      { thuTu: 2, tieuDe: "", noiDung: "đoạn C" },
    ]);
    const rows = database.db.prepare("SELECT id, noi_dung FROM kb_chunks ORDER BY id").all() as {
      id: number;
      noi_dung: string;
    }[];
    const [a, b, c] = rows;

    // Truyền vào theo thứ tự C, A, B - đảo hẳn thứ tự SQL trả về
    const ketQua = chunkStore.layDoanTheoId([c!.id, a!.id, b!.id]);
    assert.deepEqual(ketQua.map((r) => r.noiDung), ["đoạn C", "đoạn A", "đoạn B"]);
  });

  it("kèm tên nguồn qua JOIN", () => {
    chunkStore.luuDoan(id, [{ thuTu: 0, tieuDe: "", noiDung: "nội dung" }]);
    const doan = database.db.prepare("SELECT id FROM kb_chunks").get() as { id: number };
    const ketQua = chunkStore.layDoanTheoId([doan.id]);
    assert.equal(ketQua[0]!.tenNguon, "nguồn test");
  });

  it("id không tồn tại thì bị bỏ qua, không throw", () => {
    chunkStore.luuDoan(id, [{ thuTu: 0, tieuDe: "", noiDung: "nội dung" }]);
    const doan = database.db.prepare("SELECT id FROM kb_chunks").get() as { id: number };
    const ketQua = chunkStore.layDoanTheoId([999999, doan.id]);
    assert.equal(ketQua.length, 1);
    assert.equal(ketQua[0]!.id, doan.id);
  });

  it("mảng ids rỗng trả về mảng rỗng", () => {
    assert.deepEqual(chunkStore.layDoanTheoId([]), []);
  });
});
