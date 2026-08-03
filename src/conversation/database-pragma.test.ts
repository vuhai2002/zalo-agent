import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Canh hai PRAGMA quyết định tốc độ ghi của cả bot.
 *
 * Vì sao cần test cho hai dòng lệnh: `node:sqlite` chạy ĐỒNG BỘ trong tiến
 * trình một luồng, nên mỗi lần ghi là chặn cả bot. Lật `synchronous` về `FULL`
 * làm mỗi INSERT chậm 50 lần mà KHÔNG có gì hỏng, không test nào đỏ, không log
 * nào kêu - chỉ là bot chậm dần khi nhiều người nhắn cùng lúc. Đúng kiểu hồi
 * quy không ai phát hiện ra.
 *
 * `database.ts` mở SQLite ở MODULE SCOPE nên phải `setupTestEnv()` xong mới
 * `await import()` - import tĩnh sẽ mở nhầm DB thật (bẫy ghi trong CLAUDE.md).
 */

setupTestEnv();

let db: typeof import("./database.js").db;

before(async () => {
  db = (await import("./database.js")).db;
});

/** `pragma x` trả về object một khóa, tên khóa không phải lúc nào cũng trùng tên pragma */
function giaTriPragma(ten: string): unknown {
  return Object.values(db.prepare(`pragma ${ten}`).get() as Record<string, unknown>)[0];
}

describe("PRAGMA của SQLite", () => {
  it("journal_mode = wal", () => {
    // WAL cho đọc và ghi không chặn nhau. Đây là thứ được GHI VÀO FILE DB nên
    // chỉ cần đặt một lần, nhưng vẫn canh phòng ai đó gỡ dòng exec.
    assert.equal(giaTriPragma("journal_mode"), "wal");
  });

  it("synchronous = NORMAL (1), KHÔNG phải FULL (2)", () => {
    // Khác journal_mode: `synchronous` KHÔNG lưu vào file DB, nó theo từng kết
    // nối. Gỡ dòng exec là SQLite lặng lẽ về mặc định FULL.
    //
    // Đo thật trên máy dev: FULL 1.884 us/INSERT, NORMAL 37 us/INSERT.
    assert.equal(giaTriPragma("synchronous"), 1, "FULL bắt fsync mỗi commit - chặn bot 2ms mỗi lần ghi");
  });

  it("ghi rồi đọc lại vẫn đúng - NORMAL không đánh đổi tính đúng đắn", () => {
    // `synchronous` chỉ đổi thời điểm fsync xuống đĩa, KHÔNG đổi ngữ nghĩa
    // giao dịch: ghi xong đọc lại trong cùng tiến trình luôn thấy dữ liệu.
    db.exec("CREATE TABLE IF NOT EXISTS thu_pragma (id INTEGER PRIMARY KEY, v TEXT)");
    db.prepare("DELETE FROM thu_pragma").run();
    for (let i = 0; i < 50; i++) {
      db.prepare("INSERT INTO thu_pragma (v) VALUES (?)").run("giá trị " + i);
    }
    const dem = db.prepare("SELECT COUNT(*) c FROM thu_pragma").get() as { c: number };
    assert.equal(dem.c, 50);
    const cuoi = db.prepare("SELECT v FROM thu_pragma ORDER BY id DESC LIMIT 1").get() as { v: string };
    assert.equal(cuoi.v, "giá trị 49");
    db.exec("DROP TABLE thu_pragma");
  });
});
