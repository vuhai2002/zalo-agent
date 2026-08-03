import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";

/**
 * Đổi `CREDENTIALS_ENCRYPTION_KEY` sau khi đã lưu API key trên dashboard KHÔNG
 * được làm chết lượt agent hay chết `/api/overview`.
 *
 * `decryptSecret` ném khi khóa sai, mà `getEffectiveLlmSettings` nằm trên đường
 * đi của MỌI lượt lẫn của trang Tổng quan. Trước khi vá:
 *
 *   - Lượt agent: `Error` thường -> `phanLoaiLoiProvider` ra `unknown` -> người
 *     nhắn nhận "bạn nhắn lại sau ít phút nhé" cho một tình trạng VĨNH VIỄN.
 *   - Dashboard: `/api/overview` trả 500 - đúng trang người ta mở đầu tiên để
 *     hiểu chuyện gì đang xảy ra.
 *
 * PHẢI chạy TIẾN TRÌNH CON: `env.ts` parse `process.env` một lần lúc import rồi
 * đông cứng, nên không có cách nào đổi khóa giữa chừng trong cùng tiến trình.
 */

const goc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const thuMucTam: string[] = [];

after(() => {
  for (const d of thuMucTam) fs.rmSync(d, { recursive: true, force: true });
});

/**
 * Lưu API key bằng khóa A, rồi chạy lại `than` bằng khóa B trên CÙNG thư mục
 * dữ liệu - đúng kịch bản người dùng đổi `CREDENTIALS_ENCRYPTION_KEY`.
 */
function doiKhoaRoiChay(than: string): string {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "doi-khoa-"));
  thuMucTam.push(dataDir);

  const envChung = {
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
    DATA_DIR: dataDir,
    LOG_LEVEL: "error",
    LOG_FILE_ENABLED: "false",
  };
  const nap = `const nap = (p) => import(pathToFileURL(${JSON.stringify(goc)} + "/" + p).href);`;
  const dau = `import { pathToFileURL } from "node:url";\n${nap}\nprocess.loadEnvFile = () => {};\n`;

  // Bước 1: lưu key bằng khóa A
  const luu = spawnSync(
    process.execPath,
    ["--import", "tsx", "--eval", `${dau}
const s = await nap("src/config/runtime-llm-settings.ts");
s.updateLlmSettings({ provider: "openai-compatible", baseUrl: "https://r.test/v1", model: "m", apiKey: "sk-that" });
const db = await nap("src/conversation/database.ts");
db.closeDatabase();
`, "--input-type=module"],
    { env: { ...envChung, CREDENTIALS_ENCRYPTION_KEY: "a".repeat(64) }, encoding: "utf-8", timeout: 120_000 },
  );
  assert.equal(luu.status, 0, `bước lưu hỏng: ${luu.stderr}`);

  // Bước 2: đọc lại bằng khóa B (KHÁC)
  const doc = spawnSync(
    process.execPath,
    ["--import", "tsx", "--eval", dau + than, "--input-type=module"],
    { env: { ...envChung, CREDENTIALS_ENCRYPTION_KEY: "b".repeat(64) }, encoding: "utf-8", timeout: 120_000 },
  );
  return `${doc.stdout ?? ""}${doc.stderr ?? ""}`;
}

describe("đổi CREDENTIALS_ENCRYPTION_KEY sau khi đã lưu API key", () => {
  it("getEffectiveLlmSettings KHÔNG ném, và đánh dấu apiKeyHong", () => {
    const ra = doiKhoaRoiChay(`
const s = await nap("src/config/runtime-llm-settings.ts");
const c = s.getEffectiveLlmSettings();
console.log("KQ:" + JSON.stringify({ hong: c.apiKeyHong, key: c.apiKey, model: c.model }));
`);
    assert.match(ra, /KQ:/, `đã ném thay vì trả về:\n${ra}`);
    const kq = JSON.parse(ra.slice(ra.indexOf("KQ:") + 3).split("\n")[0]!);
    assert.equal(kq.hong, true, "phải đánh dấu là hỏng");
    assert.equal(kq.key, "", "KHÔNG được âm thầm rơi về .env - bot sẽ chạy bằng khóa khác khóa người dùng vừa nhập");
    assert.equal(kq.model, "m", "phần không mã hóa vẫn phải đọc được");
  });

  it("trang Tổng quan vẫn dựng được (không 500)", () => {
    const ra = doiKhoaRoiChay(`
const o = await nap("src/server/overview-stats.ts");
const info = o.getSystemInfo();
console.log("KQ:" + JSON.stringify({ daCauHinh: info.llm.daCauHinh }));
`);
    assert.match(ra, /KQ:/, `getSystemInfo ném - /api/overview sẽ trả 500:\n${ra}`);
    assert.equal(JSON.parse(ra.slice(ra.indexOf("KQ:") + 3).split("\n")[0]!).daCauHinh, false);
  });

  it("lượt agent báo ĐÚNG bệnh, không phải câu 'thử lại sau'", () => {
    const ra = doiKhoaRoiChay(`
const { resolveLanguageModel } = await nap("src/agent/llm-provider.ts");
const { getAgentForAccount } = await nap("src/config/agent-store.ts");
const { phanLoaiLoiProvider } = await nap("src/agent/provider-error-classifier.ts");
try { resolveLanguageModel(getAgentForAccount("x")); console.log("KQ:KHONG_NEM"); }
catch (e) { console.log("KQ:" + phanLoaiLoiProvider(e) + "|" + e.message); }
`);
    assert.match(ra, /KQ:cau_hinh\|/, `phải phân loại là cau_hinh:\n${ra}`);
    // Nói sai bệnh thì người dùng đi nhập lại key, trong khi gốc rễ là khóa mã
    // hóa đã đổi - và lúc đó cookie Zalo cũng hỏng theo
    assert.match(ra, /CREDENTIALS_ENCRYPTION_KEY/, "câu lỗi phải chỉ đúng gốc rễ");
  });
});
