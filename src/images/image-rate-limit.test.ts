import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let rateLimit: typeof import("./image-rate-limit.js");

before(async () => {
  // Hai trần đặt LỆCH nhau: cắm nhầm biến env là test đổ ngay
  dataDir = setupTestEnv({ IMAGE_GEN_MAX_PER_HOUR: "2", DOCUMENT_MAX_PER_HOUR: "9" });
  rateLimit = await import("./image-rate-limit.js");
});

after(async () => {
  // Đọc cấu hình chỉnh-nóng nên module này mở SQLite - không đóng thì
  // Windows chặn xóa thư mục tạm (EPERM)
  (await import("../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(() => rateLimit.resetImageRateLimit());

describe("checkImageRateLimit", () => {
  it("đọc trần từ IMAGE_GEN_MAX_PER_HOUR chứ không phải trần của tool tạo file", () => {
    assert.equal(rateLimit.checkImageRateLimit("acc:t1").ok, true);
    assert.equal(rateLimit.checkImageRateLimit("acc:t1").ok, true);
    const blocked = rateLimit.checkImageRateLimit("acc:t1");
    assert.equal(blocked.ok, false, "trần là 2 (IMAGE_GEN), không phải 9 (DOCUMENT)");
    assert.match(blocked.ok === false ? blocked.reason : "", /trần 2/);
  });

  it("câu báo nói rõ phải chờ bao lâu và gợi ý mô tả bằng lời", () => {
    const t0 = Date.now();
    rateLimit.checkImageRateLimit("acc:t1", t0);
    rateLimit.checkImageRateLimit("acc:t1", t0 + 60_000);
    const blocked = rateLimit.checkImageRateLimit("acc:t1", t0 + 20 * 60_000);
    const reason = blocked.ok === false ? blocked.reason : "";
    assert.match(reason, /khoảng 40 phút/);
    assert.match(reason, /mô tả/i, "chạm trần thì bot vẫn giúp được bằng lời");
  });

  it("đếm riêng từng thread", () => {
    rateLimit.checkImageRateLimit("acc:t1");
    rateLimit.checkImageRateLimit("acc:t1");
    assert.equal(rateLimit.checkImageRateLimit("acc:t1").ok, false);
    assert.equal(rateLimit.checkImageRateLimit("acc:t2").ok, true);
  });
});
