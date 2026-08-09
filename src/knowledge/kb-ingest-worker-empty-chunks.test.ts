import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Tách riêng khỏi kb-ingest-worker.test.ts (đã sát trần 200 dòng): ca "trích
 * xuất ra CHỮ nhưng CẮT ĐOẠN ra rỗng" (I7) - ba hình dạng khác nhau đều phải
 * ra "hong" với câu tiếng Việt đọc được, KHÔNG được lọt thành "san_sang, 0
 * đoạn" (nguồn tưởng sẵn sàng nhưng kb_search không bao giờ trả gì).
 *
 * Cả ba hình dạng đều đi qua doc-text-extract.ts MÀ KHÔNG NÉM (chữ không rỗng
 * hoặc không rỗng theo nghĩa extractor kiểm) - chỉ catThanhDoan() (chunk-text.ts)
 * mới thấy 0 đoạn. Test này chốt BẤT BIẾN "đoạn rỗng luôn bị chặn", không chỉ
 * MỘT input cụ thể - ba hình dạng lấy đúng từ báo cáo rà soát, mỗi hình dạng
 * thất bại vì một lý do khác nhau trong catThanhDoan().
 */

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

describe("kb-ingest-worker - tài liệu trích ra rỗng (0 đoạn) bị đánh hong, không lọt thành san_sang (I7)", () => {
  it('nội dung gõ tay CHỈ có heading, không thân bài ("# Chính sách bảo hành") -> hong', async () => {
    const n = store.taoNguon({ ten: "chỉ tiêu đề", loai: "text", noiDungGoc: "# Chính sách bảo hành" });
    await worker.xuLyMotVong();
    const sau = store.layNguon(n.id)!;
    assert.equal(sau.trangThai, "hong", "chữ trích ra KHÔNG rỗng nhưng cắt đoạn ra 0 - phải bị chặn, không lọt qua");
    assert.match(sau.loi, /không có nội dung để cắt đoạn/i);
  });

  it("file .txt RỖNG -> hong, không phải san_sang 0 đoạn", async () => {
    const n = store.taoNguon({
      ten: "txt rỗng",
      loai: "file",
      dinhDang: "txt",
      duongDan: fileStore.luuFile("rong", "txt", Buffer.from("")),
    });
    await worker.xuLyMotVong();
    const sau = store.layNguon(n.id)!;
    assert.equal(sau.trangThai, "hong");
    assert.match(sau.loi, /không có nội dung để cắt đoạn/i);
  });

  it('nội dung gõ tay TOÀN heading, không mục nào có thân ("# A\\n\\n## B\\n\\n### C") -> hong', async () => {
    const n = store.taoNguon({ ten: "toàn tiêu đề", loai: "text", noiDungGoc: "# A\n\n## B\n\n### C" });
    await worker.xuLyMotVong();
    const sau = store.layNguon(n.id)!;
    assert.equal(sau.trangThai, "hong");
    assert.match(sau.loi, /không có nội dung để cắt đoạn/i);
  });

  it("nội dung CÓ thân bài thật thì vẫn san_sang bình thường - phép chặn không quá tay", async () => {
    // Đối chứng: đảm bảo nhánh chặn ở trên không vô tình chặn luôn ca hợp lệ.
    const n = store.taoNguon({ ten: "có thân bài", loai: "text", noiDungGoc: "# Bảo hành\n\n12 tháng kể từ ngày mua" });
    await worker.xuLyMotVong();
    const sau = store.layNguon(n.id)!;
    assert.equal(sau.trangThai, "san_sang");
    assert.ok(sau.soDoan > 0);
  });
});
