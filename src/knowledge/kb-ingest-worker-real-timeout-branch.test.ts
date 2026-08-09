import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * File RIÊNG (không gộp vào kb-ingest-worker.test.ts) vì cần một env override
 * mà các file test khác không được phép có: hạ KB_EXTRACT_TIMEOUT_MS xuống
 * dưới sàn thật 5000ms (min ở tuning-definitions.ts) để dựng được MỘT LẦN QUÁ
 * HẠN THẬT qua worker.xuLyMotVong() - không mô phỏng tay như
 * kb-ingest-worker-attempt-limit.test.ts (file đó đặt thẳng trang_thai qua
 * giaNguonChoXuLy() + gọi goNguonKetDauTick(), không đi qua
 * trichXuatTachLuong()/worker thread thật).
 *
 * Seam controller đã duyệt (xem comment tại env.ts:KB_EXTRACT_TIMEOUT_MS):
 * sàn Zod hạ xuống 100ms trong khi sàn THẬT cho người vận hành (dashboard)
 * vẫn giữ nguyên 5000ms ở tuning-definitions.ts - hai nơi tách biệt vì
 * getTuning() chỉ kẹp theo tuning-definitions.ts khi CÓ dòng đè trong DB,
 * không có dòng đè thì trả thẳng giá trị env. `setupTestEnv()` ghi thẳng vào
 * process.env (không qua DB) nên né được sàn 5000ms mà dashboard không né
 * được.
 *
 * Mục đích: chứng minh nhánh "worker bị buộc dừng giữ NGUYÊN dang_xu_ly,
 * KHÔNG bị đánh hong ngay" (catch LoiTrichXuatBiNgatGiuaChung trong
 * kb-ingest-worker.ts) THẬT SỰ được chạy tới - đổi nhánh đó thành
 * `datTrangThai(..., "hong")` thì TOÀN BỘ test khác của phase vẫn xanh (đã
 * xác nhận bằng phép phá, xem báo cáo phase), CHỈ test này lật.
 */

let dataDir: string;
let store: typeof import("./kb-source-store.js");
let fileStore: typeof import("./kb-file-store.js");
let worker: typeof import("./kb-ingest-worker.js");
let database: typeof import("../conversation/database.js");
let fixture: typeof import("./kb-slow-docx-test-fixture.js");

before(async () => {
  // 300ms: thấp hơn hẳn thời gian trích xuất thật của bomQuayCpuDocx() (đo
  // phase trước: ~900ms-1,3s), nên chắc chắn quá hạn - không phải một ngưỡng
  // mong manh dễ flaky.
  dataDir = setupTestEnv({ KB_EXTRACT_TIMEOUT_MS: "300" });
  store = await import("./kb-source-store.js");
  fileStore = await import("./kb-file-store.js");
  worker = await import("./kb-ingest-worker.js");
  database = await import("../conversation/database.js");
  fixture = await import("./kb-slow-docx-test-fixture.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

describe("kb-ingest-worker - nhánh worker bị terminate() vì quá hạn giữ NGUYÊN dang_xu_ly (đường thật, Important 4)", () => {
  it("nguồn làm worker quá KB_EXTRACT_TIMEOUT_MS thật sự (không mô phỏng) GIỮ NGUYÊN dang_xu_ly, không bị đánh hong ngay", async () => {
    const n = store.taoNguon({
      ten: "chậm thật",
      loai: "file",
      dinhDang: "docx",
      duongDan: fileStore.luuFile("cham-that", "docx", fixture.bomQuayCpuDocx()),
    });

    await worker.xuLyMotVong();

    const sau = store.layNguon(n.id)!;
    assert.equal(
      sau.trangThai,
      "dang_xu_ly",
      "worker bị terminate() vì quá hạn KHÔNG BIẾT tài liệu hỏng thật hay chỉ máy chậm - phải để nguyên dang_xu_ly cho goNguonKetDauTick() (chạy định kỳ mỗi tick qua chayMotVongAnToan() lúc vận hành thật) xét lại, không được đánh hong ngay như lỗi nội dung thường (file rác, định dạng lạ)",
    );
    assert.equal(sau.soLanThu, 1, "đã giành đúng 1 lần trước khi bị buộc dừng");
    assert.equal(sau.soDoan, 0, "chưa hề ghi đoạn nào - worker bị cắt giữa chừng");
  });
});
