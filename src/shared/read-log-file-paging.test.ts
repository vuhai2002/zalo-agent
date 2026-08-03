import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { docConTro } from "./log-cursor.js";
import { readRecentLogs, type LogEntry } from "./read-log-file.js";

/**
 * Phân trang trang Logs. Tách khỏi `read-log-file.test.ts` vì bộ này cần dữ
 * liệu dựng riêng: nhiều dòng CÙNG một mili giây - đúng cái làm con trỏ chỉ
 * mang mốc thời gian bị hỏng.
 *
 * Luật phải giữ ở mọi test dưới đây: lật hết các trang thì ra ĐÚNG danh sách
 * đọc một lần, KHÔNG sót và KHÔNG lặp.
 */

let dir: string;

function dong(time: number, msg: string, level = 30, scope = "test"): string {
  return JSON.stringify({ level, time, scope, msg });
}

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "log-paging-"));
  // 20 dòng, mốc thời gian CỐ Ý trùng nhau theo cụm 4 - giống lúc bot bận bắn
  // cả cụm log trong một mili giây.
  const dongs: string[] = [];
  for (let i = 0; i < 20; i++) {
    dongs.push(dong(1_700_000_000_000 + Math.floor(i / 4), "dong-" + i));
  }
  fs.writeFileSync(path.join(dir, "bot.2026-07-01.1.log"), dongs.join("\n") + "\n");
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Lật hết trang bằng con trỏ, trả về danh sách msg theo thứ tự đã đọc */
function latHetTrang(limit: number, opt: { search?: string } = {}): string[] {
  const ra: string[] = [];
  let cursor: string | undefined;
  for (let vong = 0; vong < 50; vong++) {
    const r = readRecentLogs(dir, {
      limit,
      ...opt,
      before: cursor ? (docConTro(cursor) ?? undefined) : undefined,
    });
    ra.push(...r.entries.map((e: LogEntry) => e.msg));
    if (!r.nextCursor) return ra;
    cursor = r.nextCursor;
  }
  throw new Error("lật quá 50 trang - con trỏ không tiến");
}

describe("phân trang log", () => {
  it("đọc một lần: mới nhất trước", () => {
    const r = readRecentLogs(dir, { limit: 100 });
    assert.equal(r.entries.length, 20);
    assert.equal(r.entries[0]!.msg, "dong-19");
    assert.equal(r.entries[19]!.msg, "dong-0");
    assert.equal(r.nextCursor, null, "hết log thì nextCursor phải null");
  });

  it("lật từng trang ra ĐÚNG danh sách đọc một lần - không sót, không lặp", () => {
    const motLan = readRecentLogs(dir, { limit: 100 }).entries.map((e) => e.msg);
    // Nhiều cỡ trang, trong đó có cỡ CẮT NGANG cụm cùng mili giây (cụm 4 dòng)
    for (const limit of [1, 2, 3, 5, 7, 19, 20]) {
      assert.deepEqual(latHetTrang(limit), motLan, `cỡ trang ${limit}`);
    }
  });

  it("cỡ trang 3 cắt ngang cụm 4 dòng cùng mili giây mà vẫn đúng", () => {
    // Đây là ca làm hỏng bản chỉ mang mốc thời gian: dùng `<` thì mất dòng,
    // dùng `<=` thì lặp dòng. Cỡ 3 bảo đảm ranh giới rơi vào giữa cụm.
    const ra = latHetTrang(3);
    assert.equal(ra.length, 20);
    assert.equal(new Set(ra).size, 20, "có dòng bị lặp");
  });

  it("nextCursor null ở trang cuối, khác null khi còn dòng", () => {
    const t1 = readRecentLogs(dir, { limit: 5 });
    assert.ok(t1.nextCursor, "còn 15 dòng mà báo hết");
    const t4 = readRecentLogs(dir, { limit: 20 });
    assert.equal(t4.nextCursor, null);
  });

  it("con trỏ đi cùng BỘ LỌC: lật trang trong tập đã lọc vẫn đủ", () => {
    const loc = { search: "dong-1" }; // khớp dong-1 và dong-10..19 = 11 dòng
    const motLan = readRecentLogs(dir, { limit: 100, ...loc }).entries.map((e) => e.msg);
    assert.equal(motLan.length, 11);
    for (const limit of [1, 2, 4, 11]) {
      assert.deepEqual(latHetTrang(limit, loc), motLan, `cỡ trang ${limit}`);
    }
  });

  it("con trỏ hỏng -> docConTro trả null, KHÔNG rơi về trang đầu", () => {
    // Luật của Hermes (`list_sessions`): con trỏ lạ phải ra trang rỗng chứ
    // không phải trang đầu, nếu không client cứ nối thêm bản sao mãi.
    for (const rac of ["", "abc", "12", ".5", "1700000000000.", "-1.0", "1.5.9", "1e3.0"]) {
      assert.equal(docConTro(rac), null, `"${rac}" phải bị từ chối`);
    }
    assert.deepEqual(docConTro("1700000000000.3"), { time: 1_700_000_000_000, daLay: 3 });
  });

  it("thư mục log không tồn tại thì trả rỗng kèm nextCursor null", () => {
    const r = readRecentLogs(path.join(dir, "khong-co"), { limit: 10 });
    assert.deepEqual(r.entries, []);
    assert.equal(r.nextCursor, null);
  });
});
