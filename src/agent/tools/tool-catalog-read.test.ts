import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";

/**
 * `tool-catalog-read.ts` chạm DB (bắc cầu qua `kb-agent-binding.ts` /
 * `kb-source-queries.js`, mở ở MODULE SCOPE) - phải `setupTestEnv()` TRƯỚC
 * rồi mới `await import()` động, không import tĩnh ở đầu file.
 */
let dataDir: string;
let READ_TOOL_DEFINITIONS: (typeof import("./tool-catalog-read.js"))["READ_TOOL_DEFINITIONS"];
let database: typeof import("../../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  ({ READ_TOOL_DEFINITIONS } = await import("./tool-catalog-read.js"));
  database = await import("../../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

describe("kb_search.unavailableHint (I18)", () => {
  it("không chỉ sang tab Kho tri thức để GÁN - tab đó không có ô gán nào", () => {
    const dinhNghia = READ_TOOL_DEFINITIONS.find((t) => t.key === "kb_search");
    assert.ok(dinhNghia, "phải có định nghĩa kb_search trong catalog read");
    const hint = dinhNghia!.unavailableHint;
    assert.ok(hint, "kb_search phải có unavailableHint - agent chưa gán nguồn cần được chỉ đường");
    assert.doesNotMatch(
      hint!,
      /tab Kho tri thức để.*gán/i,
      "câu cũ đẩy người vận hành sang tab Kho tri thức để 'gán', nhưng tab đó chỉ NẠP tài liệu - ngõ cụt tròn",
    );
    assert.match(
      hint!,
      /ngay bên dưới|trang Agents|khối Kho tri thức/i,
      "phải chỉ đúng chỗ có ô gán thật: khối Kho tri thức trên trang Agents",
    );
  });
});
