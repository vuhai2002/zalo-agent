import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let rateLimit: typeof import("./document-rate-limit.js");

before(async () => {
  dataDir = setupTestEnv({ DOCUMENT_MAX_PER_HOUR: "3" });
  rateLimit = await import("./document-rate-limit.js");
});

after(async () => {
  // Đọc cấu hình chỉnh-nóng nên module này mở SQLite - không đóng thì
  // Windows chặn xóa thư mục tạm (EPERM)
  (await import("../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(() => rateLimit.resetDocumentRateLimit());

const HOUR = 60 * 60 * 1000;

describe("checkDocumentRateLimit", () => {
  it("cho tạo tới đúng trần rồi mới chặn", () => {
    for (let i = 1; i <= 3; i++) {
      assert.deepEqual(rateLimit.checkDocumentRateLimit("acc:t1"), { ok: true }, `lần ${i}`);
    }
    const blocked = rateLimit.checkDocumentRateLimit("acc:t1");
    assert.equal(blocked.ok, false);
    assert.match(blocked.ok === false ? blocked.reason : "", /trần 3/);
  });

  it("đếm riêng từng thread - thread này đầy không ảnh hưởng thread khác", () => {
    for (let i = 0; i < 3; i++) rateLimit.checkDocumentRateLimit("acc:t1");
    assert.equal(rateLimit.checkDocumentRateLimit("acc:t1").ok, false);
    assert.equal(rateLimit.checkDocumentRateLimit("acc:t2").ok, true, "thread khác vẫn tạo được");
  });

  it("qua cửa sổ 1 giờ thì được tạo tiếp", () => {
    const start = Date.now();
    for (let i = 0; i < 3; i++) rateLimit.checkDocumentRateLimit("acc:t1", start);
    assert.equal(rateLimit.checkDocumentRateLimit("acc:t1", start).ok, false);
    // Nhích qua mốc 1 giờ
    assert.equal(rateLimit.checkDocumentRateLimit("acc:t1", start + HOUR + 1).ok, true);
  });

  it("thông báo nói rõ còn bao nhiêu phút nữa", () => {
    const start = Date.now();
    for (let i = 0; i < 3; i++) rateLimit.checkDocumentRateLimit("acc:t1", start);
    // 20 phút sau lần đầu -> còn ~40 phút
    const blocked = rateLimit.checkDocumentRateLimit("acc:t1", start + 20 * 60_000);
    assert.equal(blocked.ok, false);
    assert.match(blocked.ok === false ? blocked.reason : "", /khoảng 40 phút/);
  });

  it("cửa sổ trượt: lần cũ hết hạn thì có thêm suất, không phải chờ hết cả giờ", () => {
    const t0 = Date.now();
    rateLimit.checkDocumentRateLimit("acc:t1", t0);
    rateLimit.checkDocumentRateLimit("acc:t1", t0 + 30 * 60_000);
    rateLimit.checkDocumentRateLimit("acc:t1", t0 + 40 * 60_000);
    assert.equal(rateLimit.checkDocumentRateLimit("acc:t1", t0 + 50 * 60_000).ok, false);
    // Sau khi lần đầu (t0) rơi khỏi cửa sổ thì còn 2 lần -> được thêm 1 suất
    assert.equal(rateLimit.checkDocumentRateLimit("acc:t1", t0 + HOUR + 1000).ok, true);
  });

  it("thread nguội bị dọn khỏi bộ nhớ (hồi quy rò rỉ Map)", () => {
    const t0 = Date.now();
    for (let i = 0; i < 500; i++) rateLimit.checkDocumentRateLimit(`acc:cu-${i}`, t0);
    // Một thread mới sau 1 giờ: lượt kiểm này phải dọn sạch 500 thread cũ
    rateLimit.checkDocumentRateLimit("acc:moi", t0 + HOUR + 1000);
    // Thread cũ giờ như chưa từng tạo file -> lại được đủ 3 suất
    for (let i = 1; i <= 3; i++) {
      assert.equal(
        rateLimit.checkDocumentRateLimit("acc:cu-0", t0 + HOUR + 2000).ok,
        true,
        `suất ${i} sau khi dọn`,
      );
    }
  });
});
