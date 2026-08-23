import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Hono } from "hono";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";

/**
 * Hai endpoint XÓA (session, contact) đều KHÔNG hoàn tác. Ba nhóm khẳng định vá
 * ba cách chúng có thể phản bội người dùng: (1) phải đăng nhập; (2) phải có
 * accountId, không đoán account; (3) xóa đúng phạm vi, không lây sang account
 * khác.
 */

let dataDir: string;
let app: Hono;
let cookie: string;
let accountStore: typeof import("../../config/account-store.js");
let threadStore: typeof import("../../conversation/thread-store.js");
let contacts: typeof import("../../conversation/contact-store.js");
let history: typeof import("../../conversation/history-store.js");
let database: typeof import("../../conversation/database.js");

const ACC = "acc-del";
const TH = "1234567890123456789"; // chat riêng: userId == threadId
const PASSWORD = "mat-khau-del-123";

before(async () => {
  dataDir = setupTestEnv({ DASHBOARD_PASSWORD: PASSWORD });
  const { buildDashboardApp } = await import("../dashboard-server.js");
  app = buildDashboardApp();
  accountStore = await import("../../config/account-store.js");
  threadStore = await import("../../conversation/thread-store.js");
  contacts = await import("../../conversation/contact-store.js");
  history = await import("../../conversation/history-store.js");
  database = await import("../../conversation/database.js");

  accountStore.createAccount({ id: ACC, label: "Test" });
  const login = await app.request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password: PASSWORD }),
    headers: { "content-type": "application/json" },
  });
  cookie = login.headers.get("set-cookie")!.split(";")[0]!;
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

function gieo(threadId: string): void {
  threadStore.recordThreadActivity({
    accountId: ACC,
    threadId,
    threadType: 0,
    displayName: "Vũ Văn Hải",
    lastSenderName: "Vũ Văn Hải",
  });
  history.appendMessage(ACC, threadId, { role: "user", content: "tin" });
  contacts.recordContactActivity(ACC, threadId, "Vũ Văn Hải");
}

const soTin = (t: string) => history.getRecentMessages(ACC, t, 50).length;
const soThread = (t: string) =>
  (database.db.prepare("SELECT COUNT(*) n FROM threads WHERE account_id=? AND thread_id=?").get(ACC, t) as { n: number }).n;
const soContact = (u: string) => contacts.listContacts({ accountId: ACC, query: u }).length;

beforeEach(() => {
  for (const t of ["messages", "threads", "contacts"]) database.db.exec(`DELETE FROM ${t}`);
  gieo(TH);
});

describe("DELETE /api/threads/:id (xóa hẳn session)", () => {
  it("CHƯA đăng nhập thì 401 và KHÔNG xóa gì", async () => {
    const res = await app.request(`/api/threads/${TH}?accountId=${ACC}`, { method: "DELETE" });
    assert.equal(res.status, 401);
    assert.equal(soThread(TH), 1, "chặn mà vẫn xóa là thảm họa");
  });

  it("thiếu accountId thì 400", async () => {
    const res = await app.request(`/api/threads/${TH}`, { method: "DELETE", headers: { cookie } });
    assert.equal(res.status, 400);
    assert.equal(soThread(TH), 1);
  });

  it("xóa dòng session + tin, GIỮ danh bạ", async () => {
    const res = await app.request(`/api/threads/${TH}?accountId=${ACC}`, {
      method: "DELETE",
      headers: { cookie },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; tinNhan: number };
    assert.equal(body.ok, true);
    assert.equal(soThread(TH), 0, "session phải biến mất");
    assert.equal(soTin(TH), 0);
    assert.equal(soContact(TH), 1, "danh bạ phải giữ - Phương án A");
  });
});

describe("DELETE /api/contacts/:userId (xóa danh bạ)", () => {
  it("CHƯA đăng nhập thì 401 và KHÔNG xóa gì", async () => {
    const res = await app.request(`/api/contacts/${TH}?accountId=${ACC}`, { method: "DELETE" });
    assert.equal(res.status, 401);
    assert.equal(soContact(TH), 1);
  });

  it("thiếu accountId thì 400", async () => {
    const res = await app.request(`/api/contacts/${TH}`, { method: "DELETE", headers: { cookie } });
    assert.equal(res.status, 400);
    assert.equal(soContact(TH), 1);
  });

  it("xóa danh bạ nhưng GIỮ tin nhắn (chỉ xóa dòng contact)", async () => {
    const res = await app.request(`/api/contacts/${TH}?accountId=${ACC}`, {
      method: "DELETE",
      headers: { cookie },
    });
    assert.equal(res.status, 200);
    assert.equal(soContact(TH), 0, "danh bạ phải mất");
    assert.equal(soTin(TH), 1, "tin nhắn phải còn - contact-delete không đụng lịch sử");
    assert.equal(soThread(TH), 1, "session cũng còn");
  });
});
