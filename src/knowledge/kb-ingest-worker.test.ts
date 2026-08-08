import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let store: typeof import("./kb-source-store.js");
let fileStore: typeof import("./kb-file-store.js");
let worker: typeof import("./kb-ingest-worker.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  store = await import("./kb-source-store.js");
  fileStore = await import("./kb-file-store.js");
  worker = await import("./kb-ingest-worker.js");
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

describe("kb-ingest-worker - xử lý nguồn cho_xu_ly", () => {
  it("nguồn cho_xu_ly được cắt đoạn rồi chuyển sang san_sang", async () => {
    const n = store.taoNguon({ ten: "x", loai: "text", noiDungGoc: "# Bảo hành\n\n12 tháng." });
    await worker.xuLyMotVong();
    const sau = store.layNguon(n.id)!;
    assert.equal(sau.trangThai, "san_sang");
    assert.ok(sau.soDoan > 0);
  });

  it("file hỏng thì trạng thái hong kèm câu tiếng Việt đọc được, KHÔNG kẹt ở dang_xu_ly", async () => {
    const n = store.taoNguon({
      ten: "hỏng",
      loai: "file",
      dinhDang: "pdf",
      duongDan: fileStore.luuFile("h", "pdf", Buffer.from("khong phai pdf")),
    });
    await worker.xuLyMotVong();
    const sau = store.layNguon(n.id)!;
    assert.equal(sau.trangThai, "hong");
    assert.match(sau.loi, /không đọc được/i);
  });

  it("một nguồn hỏng KHÔNG chặn các nguồn còn lại trong cùng vòng", async () => {
    const hong = store.taoNguon({
      ten: "hỏng",
      loai: "file",
      dinhDang: "pdf",
      duongDan: fileStore.luuFile("h2", "pdf", Buffer.from("rac")),
    });
    const tot = store.taoNguon({ ten: "tốt", loai: "text", noiDungGoc: "# Giá\n\n25.000đ" });

    await worker.xuLyMotVong();

    assert.equal(store.layNguon(hong.id)!.trangThai, "hong");
    assert.equal(
      store.layNguon(tot.id)!.trangThai,
      "san_sang",
      "một nguồn hỏng không được kéo cả vòng chết theo",
    );
  });

  it("nguồn không nằm ở cho_xu_ly thì KHÔNG bị đụng vào (san_sang giữ nguyên)", async () => {
    const n = store.taoNguon({ ten: "đã xong", loai: "text", noiDungGoc: "abc" });
    store.datTrangThai(n.id, "san_sang", { soDoan: 3 });
    await worker.xuLyMotVong();
    const sau = store.layNguon(n.id)!;
    assert.equal(sau.trangThai, "san_sang");
    assert.equal(sau.soDoan, 3);
  });

  it("nguồn kẹt ở dang_xu_ly từ lần chạy trước được đặt lại lúc khởi động", () => {
    // Worker chết giữa chừng (process bị giết) thì nguồn nằm mãi ở `dang_xu_ly`
    // và không lần nào xử lý lại - phải tự gỡ lúc boot
    const n = store.taoNguon({ ten: "kẹt", loai: "text", noiDungGoc: "x" });
    store.datTrangThai(n.id, "dang_xu_ly");
    worker.goNguonKetLucKhoiDong();
    assert.equal(store.layNguon(n.id)!.trangThai, "cho_xu_ly");
  });

  it("goNguonKetLucKhoiDong KHÔNG đụng nguồn đang ở trạng thái khác", () => {
    const sanSang = store.taoNguon({ ten: "a", loai: "text", noiDungGoc: "x" });
    store.datTrangThai(sanSang.id, "san_sang", { soDoan: 1 });
    worker.goNguonKetLucKhoiDong();
    assert.equal(store.layNguon(sanSang.id)!.trangThai, "san_sang");
  });
});
