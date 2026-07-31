import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let overviewStats: typeof import("./overview-stats.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  overviewStats = await import("./overview-stats.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

/** Chèn thẳng qua db để ép được created_at, mô phỏng tin gửi ở một mốc cụ thể */
function insertMessageAt(accountId: string, createdAt: string): void {
  database.db
    .prepare(
      `INSERT INTO messages (account_id, thread_id, role, content, created_at) VALUES (?, ?, 'user', 'nội dung', ?)`,
    )
    .run(accountId, "t-1", createdAt);
}

// Kịch bản đúng bug đã vá (mục 11 thiết kế scheduler): xem dashboard lúc
// trước 07:00 sáng giờ VN, "Tin hôm nay" phải khớp đếm tay theo ngày VN - đo
// bằng mốc cố định thay vì phụ thuộc giờ chạy test thật để không rơi vào loại
// "test xanh vô nghĩa" (chỉ đúng tình cờ vì test chạy giữa trưa).
describe("getAccountStats - messagesToday theo mốc ràng buộc (ngày VN)", () => {
  it("tin lúc 02:00 sáng giờ VN vẫn tính là 'hôm nay' khi mốc đầu ngày là đúng ngày VN đó", () => {
    // 19:00Z 30/07 = 02:00 31/07 giờ VN
    insertMessageAt("acc-boundary-1", "2026-07-30T19:00:00.000Z");

    // Mốc đầu ngày VN 31/07 = 17:00Z 30/07 (đúng giá trị startOfDayUtc trả ra,
    // đã kiểm ở zone-time.test.ts) - route thật tính bằng startOfDayUtc(tz).
    const startOfVn31 = "2026-07-30T17:00:00.000Z";
    const stats = overviewStats.getAccountStats("acc-boundary-1", startOfVn31);
    assert.equal(stats.messagesToday, 1);
  });

  it("tin lúc 23:00 tối hôm trước giờ VN KHÔNG tính là 'hôm nay'", () => {
    // 16:00Z 30/07 = 23:00 30/07 giờ VN - trước mốc đầu ngày VN 31/07 1 tiếng
    insertMessageAt("acc-boundary-2", "2026-07-30T16:00:00.000Z");

    const startOfVn31 = "2026-07-30T17:00:00.000Z";
    const stats = overviewStats.getAccountStats("acc-boundary-2", startOfVn31);
    assert.equal(stats.messagesToday, 0);
  });

  it("messagesTotal đếm mọi tin, messagesToday chỉ đếm tin sau mốc truyền vào", () => {
    insertMessageAt("acc-3", "2026-07-30T19:00:00.000Z"); // hôm nay (VN)
    insertMessageAt("acc-3", "2020-01-01T00:00:00.000Z"); // tin rất cũ

    const stats = overviewStats.getAccountStats("acc-3", "2026-07-30T17:00:00.000Z");
    assert.equal(stats.messagesTotal, 2);
    assert.equal(stats.messagesToday, 1);
  });

  it("account chưa có tin nào trả về 0, không lỗi", () => {
    const stats = overviewStats.getAccountStats("acc-trong", "2026-07-30T17:00:00.000Z");
    assert.deepEqual(stats, {
      threads: 0,
      contacts: 0,
      memories: 0,
      messagesTotal: 0,
      messagesToday: 0,
    });
  });
});
