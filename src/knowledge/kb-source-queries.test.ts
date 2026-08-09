import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let store: typeof import("./kb-source-store.js");
let queries: typeof import("./kb-source-queries.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  store = await import("./kb-source-store.js");
  queries = await import("./kb-source-queries.js");
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
});

describe("giaNguonChoXuLy - bộ đếm lần thử (C3)", () => {
  it("bộ đếm tăng NGAY LÚC GIÀNH, không phải lúc hỏng - chưa xử lý gì mà đếm phải đã tăng", () => {
    const n = store.taoNguon({ ten: "x", loai: "text", noiDungGoc: "abc" });
    const daGianh = queries.giaNguonChoXuLy(n.id, 2);
    assert.equal(daGianh, true);
    assert.equal(store.layNguon(n.id)!.soLanThu, 1, "chưa xử lý gì mà đếm phải đã tăng");
  });

  it("mỗi lần giành lại (sau khi trả về cho_xu_ly) đếm tăng thêm 1", () => {
    const n = store.taoNguon({ ten: "x", loai: "text", noiDungGoc: "abc" });
    queries.giaNguonChoXuLy(n.id, 5);
    store.datTrangThai(n.id, "cho_xu_ly"); // mô phỏng goNguonKetLucKhoiDong() trả về chờ xử lý lại
    queries.giaNguonChoXuLy(n.id, 5);
    assert.equal(store.layNguon(n.id)!.soLanThu, 2);
  });

  it("giành nguồn KHÔNG ở cho_xu_ly thất bại, KHÔNG tăng đếm", () => {
    const n = store.taoNguon({ ten: "x", loai: "text", noiDungGoc: "abc" });
    store.datTrangThai(n.id, "san_sang", { soDoan: 1 });
    const daGianh = queries.giaNguonChoXuLy(n.id, 2);
    assert.equal(daGianh, false);
    assert.equal(store.layNguon(n.id)!.soLanThu, 0, "giành thất bại thì không được tăng đếm");
  });

  it("nguồn đã chạm trần (so_lan_thu >= tranLanThu) không giành được nữa dù đang cho_xu_ly", () => {
    const n = store.taoNguon({ ten: "x", loai: "text", noiDungGoc: "abc" });
    queries.giaNguonChoXuLy(n.id, 1); // đưa so_lan_thu lên 1, đúng trần 1
    store.datTrangThai(n.id, "cho_xu_ly"); // vẫn còn cho_xu_ly (mô phỏng ca hiếm nguồn chưa kịp bị goNguonKetLucKhoiDong xử lý)
    const daGianh = queries.giaNguonChoXuLy(n.id, 1);
    assert.equal(daGianh, false, "so_lan_thu đã bằng trần thì không được giành thêm");
  });
});

describe("layNguonTheoTrangThai - danh sách chờ KHÔNG kéo toàn văn (I5)", () => {
  it("danh sách nguồn chờ KHÔNG kéo noi_dung_goc", () => {
    store.taoNguon({ ten: "to", loai: "text", noiDungGoc: "x".repeat(5_000_000) });
    const ds = queries.layNguonTheoTrangThai("cho_xu_ly");
    assert.equal(ds.length, 1);
    assert.equal("noiDungGoc" in ds[0]!, false, "kéo toàn văn mọi nguồn chờ vào RAM cùng lúc");
  });

  it("vẫn trả đúng các trường metadata khác (không chỉ bỏ noiDungGoc mà bỏ luôn field khác)", () => {
    const n = store.taoNguon({ ten: "co-du-lieu", loai: "text", noiDungGoc: "abc" });
    const [row] = queries.layNguonTheoTrangThai("cho_xu_ly");
    assert.equal(row!.id, n.id);
    assert.equal(row!.ten, "co-du-lieu");
    assert.equal(row!.soLanThu, 0);
  });

  it("chỉ trả nguồn ĐÚNG trạng thái được hỏi, không lẫn trạng thái khác", () => {
    store.taoNguon({ ten: "cho", loai: "text", noiDungGoc: "a" });
    const xong = store.taoNguon({ ten: "xong", loai: "text", noiDungGoc: "b" });
    store.datTrangThai(xong.id, "san_sang", { soDoan: 1 });
    const ds = queries.layNguonTheoTrangThai("cho_xu_ly");
    assert.equal(ds.length, 1);
    assert.equal(ds[0]!.ten, "cho");
  });
});
