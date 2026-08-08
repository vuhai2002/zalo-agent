import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * kb-file-store.ts không phụ thuộc DB, chỉ cần `dataDir` từ env - vẫn phải
 * `setupTestEnv()` trước rồi `import()` động, vì `env.ts` (mà module này import
 * gián tiếp qua `dataDir`) `process.exit(1)` khi thiếu biến bắt buộc.
 */

let dataDir: string;
let fileStore: typeof import("./kb-file-store.js");

before(async () => {
  dataDir = setupTestEnv();
  fileStore = await import("./kb-file-store.js");
});

after(() => {
  cleanupTestEnv(dataDir);
});

describe("kb-file-store - lưu/xóa file an toàn", () => {
  it("lưu theo id sinh ra, KHÔNG dùng tên người dùng đặt làm đường dẫn", () => {
    const p = fileStore.luuFile("src-1", "pdf", Buffer.from("%PDF-x"));
    assert.match(p, /^kb\/src-1\.pdf$/);
    assert.equal(fs.readFileSync(path.join(dataDir, p)).toString(), "%PDF-x");
  });

  it("tên file kiểu vượt thư mục không tạo được file ngoài dataDir", () => {
    const p = fileStore.luuFile("../../../etc/passwd", "txt", Buffer.from("x"));
    assert.ok(!p.includes(".."), `đường dẫn thoát ra: ${p}`);
    // File phải nằm ĐÚNG dưới dataDir/kb, không lọt ra ngoài
    const tuyetDoi = path.resolve(dataDir, p);
    assert.ok(tuyetDoi.startsWith(path.join(dataDir, "kb") + path.sep));
  });

  it("xóa nguồn thì file trên đĩa cũng mất", () => {
    const p = fileStore.luuFile("src-2", "txt", Buffer.from("x"));
    assert.equal(fs.existsSync(path.join(dataDir, p)), true, "chưa xóa mà file đã không có thì test vô nghĩa");
    fileStore.xoaFile(p);
    assert.equal(fs.existsSync(path.join(dataDir, p)), false);
  });

  it("xóa file không tồn tại không ném lỗi (idempotent)", () => {
    assert.doesNotThrow(() => fileStore.xoaFile("kb/khong-ton-tai.txt"));
  });

  it("xóa đường dẫn rỗng (nguồn gõ tay, chưa từng ghi file) không làm gì", () => {
    assert.doesNotThrow(() => fileStore.xoaFile(""));
  });
});
