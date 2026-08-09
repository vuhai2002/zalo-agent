import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let store: typeof import("./kb-source-store.js");
let chunkStore: typeof import("./kb-chunk-store.js");
let database: typeof import("../conversation/database.js");
let donDoanMoCoiMod: typeof import("./don-doan-mo-coi.js");
let worker: typeof import("./kb-ingest-worker.js");

before(async () => {
  dataDir = setupTestEnv();
  store = await import("./kb-source-store.js");
  chunkStore = await import("./kb-chunk-store.js");
  database = await import("../conversation/database.js");
  donDoanMoCoiMod = await import("./don-doan-mo-coi.js");
  worker = await import("./kb-ingest-worker.js");
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

function dem(sql: string): number {
  return (database.db.prepare(sql).get() as { n: number }).n;
}

describe("donDoanMoCoi - dọn đoạn/hàng FTS không còn nguồn (I4)", () => {
  it("đoạn của nguồn đã bị xóa được dọn, kể cả hàng FTS không có đường dọn nào khác", () => {
    const n = store.taoNguon({ ten: "x", loai: "text", noiDungGoc: "abc" });
    chunkStore.luuDoan(n.id, [{ thuTu: 0, tieuDe: "", noiDung: "nội dung" }]);
    // Mô phỏng ĐÚNG ca đã đo: xóa thẳng dòng kb_sources mà KHÔNG đi qua
    // xoaNguon() (route DELETE bình thường đã tự dọn 4 bảng trong 1 giao dịch -
    // ca cần dọn ở đây là ca xoaNguon() chạy XONG rồi worker MỚI ghi đoạn, nên
    // dựng lại bằng cách xóa thẳng dòng DB để không phụ thuộc thứ tự thời gian).
    database.db.prepare(`DELETE FROM kb_sources WHERE id = ?`).run(n.id);

    const ket = donDoanMoCoiMod.donDoanMoCoi();

    assert.equal(ket.soDoan, 1);
    assert.equal(dem("SELECT COUNT(*) AS n FROM kb_chunks"), 0);
    assert.equal(dem("SELECT COUNT(*) AS n FROM kb_chunks_fts"), 0, "hàng FTS mồ côi là thứ không có đường dọn nào khác");
  });

  it("KHÔNG đụng đoạn của nguồn còn tồn tại", () => {
    const con = store.taoNguon({ ten: "còn", loai: "text", noiDungGoc: "abc" });
    chunkStore.luuDoan(con.id, [{ thuTu: 0, tieuDe: "", noiDung: "còn nguyên" }]);

    const ket = donDoanMoCoiMod.donDoanMoCoi();

    assert.equal(ket.soDoan, 0);
    assert.equal(chunkStore.demDoan(con.id), 1);
  });

  it("không có gì mồ côi thì trả về 0, không lỗi", () => {
    const ket = donDoanMoCoiMod.donDoanMoCoi();
    assert.deepEqual(ket, { soDoan: 0, soHangFts: 0 });
  });
});

describe("donDoanMoCoi được nối vào boot của batDauWorker", () => {
  it("gọi batDauWorker() dọn luôn đoạn mồ côi có sẵn từ trước, không cần gọi donDoanMoCoi() tay", () => {
    // Test NÀY khác test unit ở trên: nó gọi ĐÚNG cái người vận hành thật sự
    // chạy lúc khởi động (batDauWorker), không gọi thẳng donDoanMoCoi() - nếu
    // chỉ test đơn vị thì sabotage "bỏ donDoanMoCoi() khỏi boot" không làm test
    // nào đỏ, vì không test nào từng đi qua đường boot cả.
    const n = store.taoNguon({ ten: "mồ côi trước khi boot", loai: "text", noiDungGoc: "abc" });
    chunkStore.luuDoan(n.id, [{ thuTu: 0, tieuDe: "", noiDung: "sẽ mồ côi" }]);
    database.db.prepare(`DELETE FROM kb_sources WHERE id = ?`).run(n.id);

    const dung = worker.batDauWorker();
    dung();

    assert.equal(dem("SELECT COUNT(*) AS n FROM kb_chunks"), 0);
  });
});
