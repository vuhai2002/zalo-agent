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

/** Nội dung chunk hiện có của một nguồn, đọc trực tiếp qua DB - không cần biết id đoạn */
function noiDungDoanCuaNguon(sourceId: string): string[] {
  const rows = database.db
    .prepare("SELECT noi_dung FROM kb_chunks WHERE source_id = ? ORDER BY thu_tu")
    .all(sourceId) as { noi_dung: string }[];
  return rows.map((r) => r.noi_dung);
}

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
    worker.goNguonKetDauTick();
    assert.equal(store.layNguon(n.id)!.trangThai, "cho_xu_ly");
  });

  it("goNguonKetDauTick KHÔNG đụng nguồn đang ở trạng thái khác", () => {
    const sanSang = store.taoNguon({ ten: "a", loai: "text", noiDungGoc: "x" });
    store.datTrangThai(sanSang.id, "san_sang", { soDoan: 1 });
    worker.goNguonKetDauTick();
    assert.equal(store.layNguon(sanSang.id)!.trangThai, "san_sang");
  });
});

describe("kb-ingest-worker - đoạn mồ côi lúc DELETE xen vào giữa khi đang xử lý (I4)", () => {
  it("worker KHÔNG ghi đoạn cho nguồn đã bị xóa giữa chừng", async () => {
    // Cửa sổ thật: worker đang await trích xuất (spawn worker thread thật, có
    // await THẬT), route DELETE chen vào TRƯỚC khi kết quả trích xuất về.
    const n = store.taoNguon({ ten: "x", loai: "text", noiDungGoc: "abc" });
    const chay = worker.xuLyMotVong();
    store.xoaNguon(n.id);
    await chay;
    assert.equal(
      database.db.prepare("SELECT COUNT(*) AS n FROM kb_chunks").get()!.n,
      0,
      "nguồn bị xóa giữa chừng thì KHÔNG được ghi đoạn - đoạn ghi xong sẽ mồ côi vĩnh viễn",
    );
  });
});

describe("kb-ingest-worker - lỗi lúc giành nguồn KHÔNG làm cả vòng quét bỏ dở (I8)", () => {
  it("giaNguonChoXuLy ném lỗi cho MỘT nguồn: nguồn đó được đánh hong, nguồn còn lại vẫn xử lý bình thường", async () => {
    const khoeManh = store.taoNguon({ ten: "khỏe mạnh", loai: "text", noiDungGoc: "# Tiêu đề\n\nabc" });
    const loi = store.taoNguon({ ten: "sẽ lỗi lúc giành", loai: "text", noiDungGoc: "def" });

    // Trigger CHỈ chặn đúng bước GIÀNH (chuyển sang dang_xu_ly) của MỘT nguồn
    // cụ thể - không đụng gì tới nguồn còn lại, và không đụng tới chính câu
    // ghi "hong" (đặt trang_thai='hong', không phải 'dang_xu_ly') mà catch của
    // xuLyMotNguon dùng để phục hồi. Mô phỏng ĐÚNG ca I8 mô tả: một lỗi SQL
    // THẬT xảy ra tại chính bước giaNguonChoXuLy (trước khi sửa I8, hàm này
    // nằm NGOÀI try trong xuLyMotNguon nên lỗi ở đó thoát thẳng ra khỏi
    // `await xuLyMotNguon(n)` trong vòng for của xuLyMotVong, làm cả vòng bỏ
    // dở - nguồn xử lý SAU không bao giờ được xét tới).
    database.db.exec(`
      CREATE TRIGGER gia_lap_loi_gianh BEFORE UPDATE OF trang_thai ON kb_sources
      WHEN NEW.trang_thai = 'dang_xu_ly' AND NEW.id = '${loi.id}'
      BEGIN SELECT RAISE(ABORT, 'gia lap loi gianh nguon'); END;
    `);
    try {
      await assert.doesNotReject(
        () => worker.xuLyMotVong(),
        "lỗi giành MỘT nguồn không được làm cả vòng bỏ dở (rejection thoát ra ngoài xuLyMotVong)",
      );
    } finally {
      database.db.exec(`DROP TRIGGER gia_lap_loi_gianh`);
    }

    assert.equal(
      store.layNguon(khoeManh.id)!.trangThai,
      "san_sang",
      "nguồn khỏe mạnh phải được xử lý bình thường, không bị nguồn lỗi kéo theo dù xử lý SAU nó",
    );
    assert.equal(
      store.layNguon(loi.id)!.trangThai,
      "hong",
      "nguồn lỗi giành phải được đánh hong (không kẹt mãi cho_xu_ly, không phải rejection thoát ra ngoài)",
    );
  });
});

describe("kb-ingest-worker - hai vòng chồng lấn không được xử lý trùng", () => {
  it("vòng A giữ snapshot cũ không được ghi đè nguồn mà vòng B đã xử lý xong trong lúc A còn dở", async () => {
    // Y tạo TRƯỚC, X tạo SAU - rồi ép created_at để LUÔN chắc chắn X đứng ĐẦU
    // snapshot của danhSachNguon() (ORDER BY created_at DESC), Y đứng SAU. Cần
    // thứ tự này để vòng A còn "kẹt" ở X (await thật bên trong docChuTuFile,
    // dù rồi sẽ hỏng) trong lúc ta giả lập vòng B đã xử lý xong Y.
    const y = store.taoNguon({ ten: "y", loai: "text", noiDungGoc: "# Giờ làm việc\n\n8h - 21h" });
    const x = store.taoNguon({
      ten: "x",
      loai: "file",
      dinhDang: "pdf",
      duongDan: fileStore.luuFile("cham", "pdf", Buffer.from("khong phai pdf that")),
    });
    database.db.prepare("UPDATE kb_sources SET created_at = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", y.id);
    database.db.prepare("UPDATE kb_sources SET created_at = ? WHERE id = ?").run("2020-01-01T00:00:00.001Z", x.id);

    // Vòng A: KHÔNG await - hàm async chạy đồng bộ tới điểm await THẬT đầu
    // tiên (bên trong docChuTuFile khi xử lý x) rồi mới trả quyền điều khiển
    // lại đây. Nghĩa là khi dòng này chạy xong, x đã được GIÀNH (dang_xu_ly),
    // nhưng y thì CHƯA - vòng A còn chưa kịp chạm tới y trong snapshot của nó.
    const luotA = worker.xuLyMotVong();

    // Giả lập vòng B: đã giành, xử lý XONG y - CODE ĐỒNG BỘ nên chắc chắn chạy
    // trước khi luotA (đang suspend ở await bên trong x) được tiếp tục, JS
    // không bao giờ xen ngang một hàm async đang treo cho tới khi ngăn xếp
    // đồng bộ hiện tại rỗng.
    const chunkStore = await import("./kb-chunk-store.js");
    chunkStore.luuDoan(y.id, [{ thuTu: 0, tieuDe: "", noiDung: "đã xử lý bởi lượt B" }]);
    store.datTrangThai(y.id, "san_sang", { soDoan: 1 });

    await luotA;

    // Vòng A cuối cùng cũng chạm tới y (từ snapshot CŨ, lúc y còn cho_xu_ly).
    // Nếu giành lại được (UPDATE vô điều kiện) thì nó ghi đè bằng bản CẮT LẠI
    // của chính nó ("Giờ làm việc" / "8h - 21h" - nội dung gốc của y), xóa mất
    // đoạn "đã xử lý bởi lượt B". Đo NỘI DUNG, không chỉ đếm số đoạn: cả hai
    // nhánh đều ra đúng 1 đoạn nên đếm số là khẳng định vacuous.
    assert.deepEqual(
      noiDungDoanCuaNguon(y.id),
      ["đã xử lý bởi lượt B"],
      "vòng A giành lại và xử lý CHỒNG lên y dù vòng B đã xong - đúng race brief mô tả",
    );
    assert.equal(store.layNguon(y.id)!.trangThai, "san_sang");
  });
});
