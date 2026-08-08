import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let store: typeof import("./kb-source-store.js");
let chunkStore: typeof import("./kb-chunk-store.js");
let binding: typeof import("./kb-agent-binding.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  store = await import("./kb-source-store.js");
  chunkStore = await import("./kb-chunk-store.js");
  binding = await import("./kb-agent-binding.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

// Đếm COUNT(*) không lọc theo id trong nhiều test bên dưới (đúng như brief) -
// phải dọn sạch 4 bảng của Kho tri thức TRƯỚC mỗi test, không thì kết quả tạo
// ở test trước lẫn vào phép đếm của test sau.
beforeEach(() => {
  for (const t of ["kb_sources", "kb_chunks", "kb_chunks_fts", "agent_kb_sources"]) {
    database.db.exec(`DELETE FROM ${t}`);
  }
});

describe("kb-source-store - tạo và đọc nguồn", () => {
  it("tạo nguồn rồi đọc lại thấy đúng, trạng thái mặc định là chờ xử lý", () => {
    const n = store.taoNguon({
      ten: "Chính sách đổi trả",
      loai: "text",
      noiDungGoc: "Đổi trả trong 7 ngày.",
    });
    const doc = store.layNguon(n.id)!;
    assert.equal(doc.ten, "Chính sách đổi trả");
    assert.equal(doc.trangThai, "cho_xu_ly");
    assert.equal(doc.soDoan, 0);
  });

  it("đọc nguồn không tồn tại trả về null", () => {
    assert.equal(store.layNguon("khong-ton-tai"), null);
  });

  it("danh sách nguồn thấy nguồn vừa tạo", () => {
    const n = store.taoNguon({ ten: "Nguồn liệt kê", loai: "text", noiDungGoc: "x" });
    const list = store.danhSachNguon();
    assert.ok(list.some((s) => s.id === n.id));
  });

  it("đặt trạng thái cập nhật đúng cột", () => {
    const n = store.taoNguon({ ten: "Đặt trạng thái", loai: "file", dinhDang: "pdf" });
    store.datTrangThai(n.id, "hong", { loi: "Không đọc được file" });
    const doc = store.layNguon(n.id)!;
    assert.equal(doc.trangThai, "hong");
    assert.equal(doc.loi, "Không đọc được file");
  });
});

describe("kb-source-store - xóa sạch, bất biến quan trọng nhất của phase", () => {
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

  it("xóa nguồn trả về đúng số đoạn đã xóa", () => {
    const n = store.taoNguon({ ten: "đếm đoạn", loai: "text", noiDungGoc: "abc" });
    chunkStore.luuDoan(n.id, [
      { thuTu: 0, tieuDe: "", noiDung: "đoạn 1" },
      { thuTu: 1, tieuDe: "", noiDung: "đoạn 2" },
    ]);
    const ketQua = store.xoaNguon(n.id);
    assert.equal(ketQua.soDoanDaXoa, 2);
  });

  it("xóa nguồn KHÔNG đụng nguồn khác", () => {
    const a = store.taoNguon({ ten: "a", loai: "text", noiDungGoc: "1" });
    const b = store.taoNguon({ ten: "b", loai: "text", noiDungGoc: "2" });
    chunkStore.luuDoan(a.id, [{ thuTu: 0, tieuDe: "", noiDung: "của a" }]);
    chunkStore.luuDoan(b.id, [{ thuTu: 0, tieuDe: "", noiDung: "của b" }]);
    store.xoaNguon(a.id);
    assert.equal(chunkStore.demDoan(b.id), 1);
  });
});
