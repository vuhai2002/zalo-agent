import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, describe, it } from "node:test";

/**
 * Chốt boot RIÊNG cho `KB_EXTRACT_TIMEOUT_MS` (cuối `env.ts`) - sàn Zod của
 * biến này bị hạ xuống 100ms (thấp hơn hẳn sàn thật 5000ms) CHỈ để test set
 * qua `process.env` né qua DB (xem comment tại schema, phase 02 đợt sửa Kho
 * tri thức). Thiếu chốt RIÊNG này thì sàn Zod thấp trở thành hàng rào boot
 * DUY NHẤT cho `.env` THẬT: ai gõ nhầm "600" với ý "600 giây" (hoặc "1000")
 * vẫn boot êm re, rồi MỌI tài liệu quá hạn và bị đổ oan là "tài liệu độc"
 * trong khi gốc rễ là một dòng `.env`.
 *
 * PHẢI chạy TIẾN TRÌNH CON - cùng lý do với `env-toi-thieu.test.ts`: `env.ts`
 * parse `process.env` MỘT LẦN lúc import rồi đông cứng, sửa `process.env`
 * trong test hiện tại là vô tác dụng.
 */

const goc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const thuMucTam: string[] = [];

after(() => {
  for (const d of thuMucTam) fs.rmSync(d, { recursive: true, force: true });
});

function chayVoiEnv(them: Record<string, string> = {}): string {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-timeout-guard-"));
  thuMucTam.push(dataDir);

  const nap = `const nap = (p) => import(pathToFileURL(${JSON.stringify(goc)} + "/" + p).href);`;
  const script =
    `import { pathToFileURL } from "node:url";\n${nap}\n` +
    `process.loadEnvFile = () => {};\n` +
    `await nap("src/config/env.ts");\n` +
    `console.log("BOOT_OK");\n`;

  const file = path.join(dataDir, "thu.mjs");
  fs.writeFileSync(file, script, "utf-8");

  const r = spawnSync(process.execPath, ["--import", "tsx", file], {
    // env DỰNG TỪ ĐẦU, không kế thừa process.env của test - kế thừa là kéo
    // theo NODE_ENV=test có sẵn của chính test runner, làm mọi ca "không phải
    // test" biến mất.
    env: {
      PATH: process.env.PATH ?? "",
      SystemRoot: process.env.SystemRoot ?? "",
      CREDENTIALS_ENCRYPTION_KEY: "0".repeat(64),
      DATA_DIR: dataDir,
      LOG_LEVEL: "error",
      LOG_FILE_ENABLED: "false",
      ...them,
    },
    encoding: "utf-8",
    timeout: 120_000,
  });

  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}

describe("chốt boot cho KB_EXTRACT_TIMEOUT_MS - sàn Zod thấp KHÔNG được là hàng rào duy nhất cho .env thật", () => {
  it('NODE_ENV=development + KB_EXTRACT_TIMEOUT_MS="600" (nhầm giây thành ms) -> CHẾT lúc boot, câu lỗi chỉ đúng biến', () => {
    const ra = chayVoiEnv({ NODE_ENV: "development", KB_EXTRACT_TIMEOUT_MS: "600" });
    assert.ok(!ra.includes("BOOT_OK"), `phải chặn boot với 600ms ở NODE_ENV=development:\n${ra}`);
    assert.match(ra, /KB_EXTRACT_TIMEOUT_MS/, `câu lỗi phải chỉ đúng biến gây lỗi:\n${ra}`);
  });

  it("KHÔNG đặt NODE_ENV (mặc định 'development' theo schema) + 1000ms -> vẫn chặn, không lọt qua vì thiếu biến", () => {
    const ra = chayVoiEnv({ KB_EXTRACT_TIMEOUT_MS: "1000" });
    assert.ok(!ra.includes("BOOT_OK"), `NODE_ENV mặc định PHẢI khác 'test' nên vẫn phải chặn:\n${ra}`);
  });

  it("NODE_ENV=test + KB_EXTRACT_TIMEOUT_MS=300 -> boot bình thường - đúng seam test cần giữ nguyên", () => {
    const ra = chayVoiEnv({ NODE_ENV: "test", KB_EXTRACT_TIMEOUT_MS: "300" });
    assert.match(ra, /BOOT_OK/, `chốt mới không được phá seam test đã dùng cho kb-ingest-worker-real-timeout-branch.test.ts:\n${ra}`);
  });

  it("đúng sàn 5000ms (biên dưới) ở NODE_ENV=development -> boot bình thường, không chặn oan", () => {
    const ra = chayVoiEnv({ NODE_ENV: "development", KB_EXTRACT_TIMEOUT_MS: "5000" });
    assert.match(ra, /BOOT_OK/, `5000ms đúng bằng sàn không được bị chặn (off-by-one):\n${ra}`);
  });

  it("không đặt KB_EXTRACT_TIMEOUT_MS (mặc định 60000ms) -> boot bình thường - ca người dùng thường gặp nhất", () => {
    const ra = chayVoiEnv({ NODE_ENV: "production" });
    assert.match(ra, /BOOT_OK/, `giá trị mặc định của schema không được tự chặn boot:\n${ra}`);
  });
});

/** Giữ import cho gọn lint - pathToFileURL dùng trong script con dạng chuỗi */
void pathToFileURL;
