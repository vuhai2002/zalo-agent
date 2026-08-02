import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, describe, it } from "node:test";

/**
 * `.env` chỉ còn ĐÚNG MỘT biến bắt buộc: `CREDENTIALS_ENCRYPTION_KEY`.
 *
 * Mọi thứ khác cấu hình được trên dashboard, và dashboard ĐÈ `.env`. Bất biến
 * đi kèm: thiếu cấu hình LLM thì KHÔNG được chết lúc boot - phải vào được
 * dashboard mới nhập được, mà chết lúc boot thì chẳng có dashboard nào để vào.
 * Lỗi phải nổ ở lượt agent đầu tiên, kèm câu chỉ đúng chỗ cần nhập.
 *
 * PHẢI chạy TIẾN TRÌNH CON. `env.ts` parse `process.env` MỘT LẦN lúc import
 * rồi đông cứng, nên sửa `process.env` trong test là vô tác dụng - bản đầu của
 * file này làm vậy và cả 3 ca đều "Missing expected exception", tức là xanh-giả
 * theo chiều ngược lại (test đo một thứ không tồn tại). Muốn đo hành vi lúc
 * KHỞI ĐỘNG thì phải khởi động thật.
 *
 * Không có file này thì một lần siết schema cho "chặt chẽ" là khoá luôn người
 * vừa cài xong, và không test nào đỏ.
 */

const goc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const thuMucTam: string[] = [];

after(() => {
  for (const d of thuMucTam) fs.rmSync(d, { recursive: true, force: true });
});

/** Chạy một đoạn script trong tiến trình con với env DỰNG TỪ ĐẦU, không kế thừa */
function chayVoiEnvToiThieu(than: string, them: Record<string, string> = {}): string {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "env-toi-thieu-"));
  thuMucTam.push(dataDir);

  const file = path.join(dataDir, "thu.mjs");
  fs.writeFileSync(
    file,
    `import { pathToFileURL } from "node:url";\n` +
      `const nap = (p) => import(pathToFileURL(${JSON.stringify(goc)} + "/" + p).href);\n` +
      `process.loadEnvFile = () => {};\n` +
      than,
    "utf-8",
  );

  const r = spawnSync(process.execPath, ["--import", "tsx", file], {
    // env DỰNG TỪ ĐẦU: kế thừa process.env của test là kéo theo cả .env của máy
    // dev, và ca "chưa cấu hình gì" biến mất
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

describe("env tối thiểu - chỉ CREDENTIALS_ENCRYPTION_KEY là bắt buộc", () => {
  it("nạp được env.ts với ĐÚNG một biến, không process.exit", () => {
    const ra = chayVoiEnvToiThieu(
      `await nap("src/config/env.ts");\nconsole.log("NAP_OK");\n`,
    );
    assert.match(ra, /NAP_OK/, `env.ts chết với env tối thiểu:\n${ra}`);
    assert.ok(!ra.includes("không hợp lệ"), ra);
  });

  it("THIẾU khóa mã hóa thì vẫn chết lúc boot - nó không nằm trên dashboard được", () => {
    // Đối chứng: chứng minh ca trên không phải "schema đã bỏ kiểm hết"
    const ra = chayVoiEnvToiThieu(`await nap("src/config/env.ts");\nconsole.log("NAP_OK");\n`, {
      CREDENTIALS_ENCRYPTION_KEY: "",
    });
    assert.ok(!ra.includes("NAP_OK"), "thiếu khóa mã hóa PHẢI chặn boot");
    assert.match(ra, /CREDENTIALS_ENCRYPTION_KEY/);
  });
});

describe("thiếu cấu hình LLM thì báo ở LƯỢT AGENT, không chết lúc boot", () => {
  const thuLuot = (them: Record<string, string> = {}) =>
    chayVoiEnvToiThieu(
      `const { resolveLanguageModel } = await nap("src/agent/llm-provider.ts");\n` +
        `const { getAgentForAccount } = await nap("src/config/agent-store.ts");\n` +
        `console.log("BOOT_OK");\n` +
        `try { resolveLanguageModel(getAgentForAccount("x")); console.log("KHONG_NEM"); }\n` +
        `catch (e) { console.log("LOI:" + e.message); }\n`,
      them,
    );

  it("chưa cấu hình gì: boot xong, lượt đầu báo lỗi chỉ thẳng vào trang Providers", () => {
    const ra = thuLuot();
    assert.match(ra, /BOOT_OK/, `phải boot được:\n${ra}`);
    assert.match(ra, /LOI:.*Providers/, ra);
  });

  it("có key nhưng THIẾU MODEL: câu lỗi nói về model, không phải lỗi HTTP khó hiểu", () => {
    // Trước đây LLM_MODEL là `.min(1)` nên thiếu nó là chết lúc boot - không ai
    // vào được dashboard để nhập
    const ra = thuLuot({ LLM_API_KEY: "sk-thu", LLM_BASE_URL: "https://r.test/v1" });
    assert.match(ra, /BOOT_OK/, ra);
    assert.match(ra, /LOI:.*model/i, ra);
  });

  it("có key và model nhưng THIẾU BASE URL: cũng báo ở lượt, không chặn boot", () => {
    // Ràng buộc chéo cũ ở env.ts chặn boot khi thiếu base URL - nhưng base URL
    // nhập được trên dashboard, nên chặn boot là chặn đúng người cần vào nhập
    const ra = thuLuot({ LLM_API_KEY: "sk-thu", LLM_MODEL: "gpt-combo" });
    assert.match(ra, /BOOT_OK/, ra);
    assert.match(ra, /LOI:.*base URL/i, ra);
  });

  it("đủ cả ba thì dựng được model, không ném", () => {
    const ra = thuLuot({
      LLM_API_KEY: "sk-thu",
      LLM_MODEL: "gpt-combo",
      LLM_BASE_URL: "https://r.test/v1",
    });
    assert.match(ra, /KHONG_NEM/, ra);
  });
});

/** Giữ import cho gọn lint - pathToFileURL dùng trong script con dạng chuỗi */
void pathToFileURL;
