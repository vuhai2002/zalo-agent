import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Import TĨNH của `run-eval.ts` không được mở SQLite.
 *
 * Import tĩnh chạy TRƯỚC `setupTestEnv()` (nó nằm trong `dungEvalEnv`), nên module
 * nào trong đó kéo theo `database.ts` là mở DB THẬT ở `./data` - mọi lần eval ghi
 * account, tin nhắn, trace vào DB dev và chạy migration lên đó. Đã xảy ra thật:
 * `kenh-ca-nhan` (qua send-reply-in-parts -> history-store -> database.ts) nằm ở
 * đầu file, và không gì đỏ vì eval vẫn chạy bình thường.
 *
 * Đọc đúng các dòng import tĩnh của `run-eval.ts`, nạp chúng trong một tiến
 * trình riêng với DATA_DIR trỏ vào thư mục trống, rồi kiểm thư mục vẫn trống.
 * Không import chính `run-eval.ts` vì nó gọi `main()` ngay khi nạp.
 */
describe("run-eval - import tĩnh không chạm DB", () => {
  it("nạp mọi import tĩnh của run-eval.ts xong, DATA_DIR vẫn không có file DB nào", () => {
    const thuMucEvals = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
    const nguon = fs.readFileSync(path.join(thuMucEvals, "run-eval.ts"), "utf8");
    // Chỉ lấy ĐƯỜNG DẪN rồi viết lại thành `import "x";` thuần: chép nguyên dòng
    // `import { a } from "x"` vào file tạm thì tsx/esbuild BỎ import không dùng
    // tới và không nạp module nào - phép đo xanh rỗng (đã đo: phá mà vẫn xanh).
    const duongDan = nguon
      .split(/\r?\n/)
      .filter((d) => /^import\s/.test(d) && !/^import\s+type\s/.test(d))
      .map((d) => /from\s+"([^"]+)"/.exec(d)?.[1])
      .filter((x): x is string => Boolean(x));
    assert.ok(duongDan.length >= 5, `chỉ đọc được ${duongDan.length} dòng import - phép đo không chạy thật`);

    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "zalo-agent-eval-import-"));
    const modTam = path.join(thuMucEvals, `.tmp-static-imports-${process.pid}.ts`);
    fs.writeFileSync(modTam, duongDan.map((d) => `import ${JSON.stringify(d)};`).join("\n") + "\n");
    try {
      const kq = spawnSync(process.execPath, ["--import", "tsx", modTam], {
        env: { ...process.env, DATA_DIR: dataDir, LOG_FILE_ENABLED: "false", NODE_ENV: "test" },
        encoding: "utf8",
        timeout: 60_000,
      });
      assert.equal(kq.status, 0, `nạp import tĩnh hỏng: ${kq.stderr?.slice(0, 500)}`);
      assert.deepEqual(fs.readdirSync(dataDir), [], "import tĩnh đã mở SQLite trước setupTestEnv");
    } finally {
      fs.rmSync(modTam, { force: true });
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
