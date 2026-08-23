import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * XÓA HẲN session khác RESET: nó bỏ luôn dòng `threads`. Vẫn phải giữ đúng thứ
 * người dùng chốt (Phương án A): danh bạ và sổ token ở lại, chỉ session + tin +
 * lịch hẹn của thread đó ra đi. DB không có khóa ngoại nên mỗi bảng xóa tay -
 * hai kiểu sai đều tệ ngược nhau (sót bảng / xóa quá tay sang account khác), nên
 * mỗi test dựng sẵn một account thứ hai và khẳng định nó còn nguyên.
 */

let dataDir: string;
let xoa: typeof import("./xoa-han-session.js");
let history: typeof import("./history-store.js");
let threads: typeof import("./thread-store.js");
let contacts: typeof import("./contact-store.js");
let database: typeof import("./database.js");

const ACC = "acc-1";
const ACC_KHAC = "acc-2";
const TH = "thread-1";
const TH_KHAC = "thread-2";

before(async () => {
  dataDir = setupTestEnv();
  xoa = await import("./xoa-han-session.js");
  history = await import("./history-store.js");
  threads = await import("./thread-store.js");
  contacts = await import("./contact-store.js");
  database = await import("./database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

let demJob = 0;

/** Dựng một thread đủ: dòng session, tin nhắn, sổ token, danh bạ, lịch hẹn */
function gieo(accountId: string, threadId: string): void {
  threads.recordThreadActivity({
    accountId,
    threadId,
    threadType: 0,
    displayName: `Tên ${threadId}`,
    lastSenderName: "Người dùng",
  });
  history.appendMessage(accountId, threadId, { role: "user", content: "tin người dùng" });
  history.appendMessage(accountId, threadId, { role: "assistant", content: "bot trả lời" });
  contacts.recordContactActivity(accountId, threadId, "Người dùng"); // chat riêng: userId == threadId
  database.db
    .prepare("INSERT INTO agent_turns (account_id, thread_id, total_tokens, steps) VALUES (?, ?, 100, 1)")
    .run(accountId, threadId);
  database.db
    .prepare(
      `INSERT INTO scheduled_jobs (id, account_id, thread_id, thread_type, name, kind, payload, schedule_kind, run_at)
       VALUES (?, ?, ?, 0, 'nhắc', 'message', '{}', 'once', '2030-01-01T00:00:00Z')`,
    )
    .run(`job-${++demJob}`, accountId, threadId);
}

const demThread = (a: string, t: string) =>
  (database.db.prepare("SELECT COUNT(*) n FROM threads WHERE account_id=? AND thread_id=?").get(a, t) as { n: number }).n;
const demTin = (a: string, t: string) =>
  (database.db.prepare("SELECT COUNT(*) n FROM messages WHERE account_id=? AND thread_id=?").get(a, t) as { n: number }).n;
const demJobDb = (a: string, t: string) =>
  (database.db.prepare("SELECT COUNT(*) n FROM scheduled_jobs WHERE account_id=? AND thread_id=?").get(a, t) as { n: number }).n;
const demTurn = (a: string, t: string) =>
  (database.db.prepare("SELECT COUNT(*) n FROM agent_turns WHERE account_id=? AND thread_id=?").get(a, t) as { n: number }).n;
const demContact = (a: string, t: string) =>
  (database.db.prepare("SELECT COUNT(*) n FROM contacts WHERE account_id=? AND user_id=?").get(a, t) as { n: number }).n;

beforeEach(() => {
  for (const tbl of ["threads", "messages", "contacts", "agent_turns", "scheduled_jobs"]) {
    database.db.prepare(`DELETE FROM ${tbl}`).run();
  }
  gieo(ACC, TH);
  gieo(ACC, TH_KHAC);
  gieo(ACC_KHAC, TH); // cùng threadId, khác account - phải còn nguyên
});

describe("xoaHanSession", () => {
  it("xóa dòng session + tin nhắn + lịch hẹn của ĐÚNG thread đó", () => {
    const kq = xoa.xoaHanSession(ACC, TH);
    assert.equal(demThread(ACC, TH), 0, "dòng session phải biến mất");
    assert.equal(demTin(ACC, TH), 0, "tin nhắn phải bị xóa");
    assert.equal(demJobDb(ACC, TH), 0, "lịch hẹn của thread phải bị xóa");
    assert.equal(kq.coDong, true);
    assert.equal(kq.tinNhan, 2);
    assert.equal(kq.lichHen, 1);
  });

  it("GIỮ danh bạ (Phương án A) và sổ token (agent_turns)", () => {
    xoa.xoaHanSession(ACC, TH);
    assert.equal(demContact(ACC, TH), 1, "danh bạ phải được giữ - có nút xóa riêng");
    assert.equal(demTurn(ACC, TH), 1, "sổ token phải giữ để thống kê không bị viết lại");
  });

  it("KHÔNG đụng thread khác cùng account", () => {
    xoa.xoaHanSession(ACC, TH);
    assert.equal(demThread(ACC, TH_KHAC), 1);
    assert.equal(demTin(ACC, TH_KHAC), 2);
    assert.equal(demJobDb(ACC, TH_KHAC), 1);
  });

  it("KHÔNG đụng account khác cùng threadId", () => {
    xoa.xoaHanSession(ACC, TH);
    assert.equal(demThread(ACC_KHAC, TH), 1, "account khác cùng threadId phải còn nguyên");
    assert.equal(demTin(ACC_KHAC, TH), 2);
    assert.equal(demContact(ACC_KHAC, TH), 1);
  });

  it("xóa cái không tồn tại thì coDong=false, không ném", () => {
    const kq = xoa.xoaHanSession(ACC, "thread-khong-co");
    assert.equal(kq.coDong, false);
  });
});
