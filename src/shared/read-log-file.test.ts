import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { readRecentLogs } from "./read-log-file.js";

/**
 * Module thuần: nhận thư mục, không đụng env - test chạy thẳng.
 */

let dir: string;

/** pino ghi mỗi dòng một JSON, level là SỐ (30 = info) */
function dong(level: number, scope: string, msg: string, time = Date.now()): string {
  return JSON.stringify({ level, time, scope, msg });
}

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "log-test-"));
  // Hai file như pino-roll xoay vòng theo ngày
  fs.writeFileSync(
    path.join(dir, "bot.2026-07-27.1.log"),
    [dong(30, "cu", "hôm qua"), dong(50, "cu", "lỗi hôm qua")].join("\n") + "\n",
  );
  fs.writeFileSync(
    path.join(dir, "bot.2026-07-28.1.log"),
    [
      dong(20, "agent-loop", "chi tiết step"),
      dong(30, "message-turn", "xử lý lượt"),
      dong(40, "vision-sidecar", "sidecar chậm"),
      dong(50, "account-manager", "mất kết nối"),
    ].join("\n") + "\n",
  );
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("readRecentLogs", () => {
  it("đọc được mọi file trong thư mục, MỚI NHẤT ĐỨNG ĐẦU", () => {
    const r = readRecentLogs(dir, { limit: 100 });
    assert.equal(r.entries.length, 6);
    assert.equal(r.entries[0]!.msg, "mất kết nối", "dòng cuối của file mới nhất phải đứng đầu");
  });

  it("lọc theo mức: chỉ lấy từ mức đó trở lên", () => {
    const r = readRecentLogs(dir, { limit: 100, minLevel: 40 });
    assert.deepEqual(
      r.entries.map((e) => e.msg).sort(),
      ["lỗi hôm qua", "mất kết nối", "sidecar chậm"].sort(),
    );
  });

  it("lọc theo scope", () => {
    const r = readRecentLogs(dir, { limit: 100, scope: "agent-loop" });
    assert.equal(r.entries.length, 1);
    assert.equal(r.entries[0]!.msg, "chi tiết step");
  });

  it("tìm theo chữ trong nội dung dòng log", () => {
    const r = readRecentLogs(dir, { limit: 100, search: "sidecar" });
    assert.equal(r.entries.length, 1);
    assert.equal(r.entries[0]!.scope, "vision-sidecar");
  });

  it("limit cắt bớt nhưng vẫn giữ dòng MỚI NHẤT", () => {
    const r = readRecentLogs(dir, { limit: 2 });
    assert.equal(r.entries.length, 2);
    assert.equal(r.entries[0]!.msg, "mất kết nối");
  });

  it("liệt kê các scope đang có - để dashboard dựng ô lọc", () => {
    const r = readRecentLogs(dir, { limit: 100 });
    assert.ok(r.scopes.includes("agent-loop"));
    assert.ok(r.scopes.includes("account-manager"));
    assert.deepEqual(r.scopes, [...r.scopes].sort(), "scope phải sắp xếp cho dễ nhìn");
  });

  it("giữ nguyên các trường phụ để đọc ngữ cảnh", () => {
    const f = path.join(dir, "bot.2026-07-29.1.log");
    fs.writeFileSync(f, JSON.stringify({ level: 30, time: Date.now(), scope: "x", msg: "m", threadId: "t-9", steps: 3 }) + "\n");
    const r = readRecentLogs(dir, { limit: 10, scope: "x" });
    assert.equal(r.entries[0]!.fields.threadId, "t-9");
    assert.equal(r.entries[0]!.fields.steps, 3);
    fs.rmSync(f);
  });
});

describe("readRecentLogs - chỉ đọc đủ dùng, không nuốt cả tuần log", () => {
  it("đủ dòng ở file mới nhất thì DỪNG, không mở file cũ", () => {
    // Thư mục có 2 file; xin 1 dòng thì chỉ cần mở file mới nhất
    const r = readRecentLogs(dir, { limit: 1 });
    assert.equal(r.entries.length, 1);
    assert.equal(r.filesRead, 1, "mở cả file cũ là đọc thừa cả tuần log mỗi lần vào trang");
  });

  it("thiếu dòng thì mới lần ngược sang file cũ hơn", () => {
    const r = readRecentLogs(dir, { limit: 100 });
    assert.equal(r.filesRead, 2);
    assert.equal(r.entries.length, 6);
  });

  it("lọc chặt (không khớp gì ở file mới) vẫn lần ngược tìm tiếp", () => {
    const r = readRecentLogs(dir, { limit: 10, scope: "cu" });
    assert.equal(r.entries.length, 2, "phải tìm được ở file cũ");
    assert.equal(r.filesRead, 2);
  });
});

describe("readRecentLogs - hỏng hóc không được làm chết trang", () => {
  it("thư mục chưa tồn tại trả rỗng, không throw", () => {
    const r = readRecentLogs(path.join(dir, "khong-co"), { limit: 10 });
    assert.deepEqual(r.entries, []);
    assert.deepEqual(r.scopes, []);
  });

  it("dòng JSON hỏng bị bỏ qua, các dòng khác vẫn đọc được", () => {
    const f = path.join(dir, "bot.2026-07-30.1.log");
    fs.writeFileSync(f, `khong-phai-json\n${dong(30, "ok", "van doc duoc")}\n`);
    const r = readRecentLogs(dir, { limit: 100, scope: "ok" });
    assert.equal(r.entries.length, 1);
    fs.rmSync(f);
  });

  it("bỏ qua file không phải .log", () => {
    const f = path.join(dir, "ghi-chu.txt");
    fs.writeFileSync(f, dong(30, "khong-nen-doc", "x") + "\n");
    const r = readRecentLogs(dir, { limit: 100 });
    assert.ok(!r.scopes.includes("khong-nen-doc"));
    fs.rmSync(f);
  });
});
