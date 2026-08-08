import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let query: typeof import("./kb-fts-query.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  query = await import("./kb-fts-query.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

describe("dungTruyVanFts", () => {
  it("bọc từng từ trong nháy kép và nối bằng OR", () => {
    assert.equal(query.dungTruyVanFts("phí ship nội thành"), '"phi" OR "ship" OR "noi" OR "thanh"');
  });

  it("ký tự cú pháp FTS5 trong câu hỏi KHÔNG làm ném lỗi", () => {
    // Chữ của người lạ đi thẳng vào đây - "-", "*", '"', "(" đều là cú pháp FTS5
    for (const cau of ['giá "combo" bao nhiêu', "shop ơi - còn hàng *không*", "a( b) c"]) {
      assert.doesNotThrow(() =>
        database.db.prepare("SELECT rowid FROM kb_chunks_fts WHERE phang MATCH ?").all(query.dungTruyVanFts(cau)),
      );
    }
  });

  it("câu hỏi không còn từ nào dùng được thì trả rỗng, KHÔNG dựng MATCH rỗng", () => {
    assert.equal(query.dungTruyVanFts("!!! ??? ..."), "");
  });
});
