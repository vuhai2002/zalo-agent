import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Hono } from "hono";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";

/**
 * API xóa sạch ngữ cảnh một cuộc trò chuyện.
 *
 * Ba nhóm khẳng định, mỗi nhóm vá một cách endpoint này có thể phản bội người
 * dùng: (1) phải có đăng nhập - đây là thao tác PHÁ HỦY không hoàn tác; (2) chỉ
 * xóa đúng thread được chỉ định; (3) trí nhớ chỉ mất khi thật sự tick, vì mặc
 * định bật nhầm là xóa thứ người dùng không hề định bỏ.
 */

let dataDir: string;
let app: Hono;
let cookie: string;
let accountStore: typeof import("../../config/account-store.js");
let threadStore: typeof import("../../conversation/thread-store.js");
let history: typeof import("../../conversation/history-store.js");
let memories: typeof import("../../conversation/memory-store.js");
let database: typeof import("../../conversation/database.js");

const ACC = "acc-wipe-route";
const TH = "t-wipe";
const TH_KHAC = "t-wipe-khac";
const PASSWORD = "mat-khau-wipe-123";

before(async () => {
  dataDir = setupTestEnv({ DASHBOARD_PASSWORD: PASSWORD });
  const { buildDashboardApp } = await import("../dashboard-server.js");
  app = buildDashboardApp();
  accountStore = await import("../../config/account-store.js");
  threadStore = await import("../../conversation/thread-store.js");
  history = await import("../../conversation/history-store.js");
  memories = await import("../../conversation/memory-store.js");
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
    displayName: "Ai đó",
    lastSenderName: "Ai đó",
  });
  history.appendMessage(ACC, threadId, { role: "user", content: `tin của ${threadId}` });
  memories.saveMemoryFact({
    accountId: ACC,
    subjectId: "u1",
    content: `fact của ${threadId}`,
    learnedInThreadId: threadId,
    learnedInGroup: false,
  });
}

const soTin = (threadId: string) => history.getRecentMessages(ACC, threadId, 50).length;
const soTriNho = () => memories.listMemories({ accountId: ACC, limit: 50 }).length;

const goiXoa = (threadId: string, query: string, kemCookie = true) =>
  app.request(`/api/threads/${threadId}/history?accountId=${ACC}${query}`, {
    method: "DELETE",
    headers: kemCookie ? { cookie } : {},
  });

beforeEach(() => {
  for (const t of ["messages", "threads", "memories"]) database.db.exec(`DELETE FROM ${t}`);
  gieo(TH);
  gieo(TH_KHAC);
});

describe("DELETE /api/threads/:id/history", () => {
  it("CHƯA đăng nhập thì bị chặn và KHÔNG xóa gì", async () => {
    const res = await goiXoa(TH, "", false);
    assert.equal(res.status, 401);
    assert.equal(soTin(TH), 1, "chặn mà vẫn xóa là thảm họa - đây là thao tác không hoàn tác");
  });

  it("thiếu accountId thì 400 - không đoán account", async () => {
    const res = await app.request(`/api/threads/${TH}/history`, {
      method: "DELETE",
      headers: { cookie },
    });
    assert.equal(res.status, 400);
    assert.equal(soTin(TH), 1);
  });

  it("xóa đúng thread được chỉ định, thread khác còn nguyên", async () => {
    const res = await goiXoa(TH, "");
    assert.equal(res.status, 200);

    const body = (await res.json()) as { ok: boolean; tinNhan: number };
    assert.equal(body.ok, true);
    assert.equal(body.tinNhan, 1);
    assert.equal(soTin(TH), 0);
    assert.equal(soTin(TH_KHAC), 1, "xóa lây thread khác là mất dữ liệu người dùng không nhờ");
  });

  it("KHÔNG truyền xoaTriNho thì trí nhớ còn nguyên", async () => {
    const truoc = soTriNho();
    await goiXoa(TH, "");
    assert.equal(soTriNho(), truoc, "mặc định phải giữ trí nhớ");
  });

  it("xoaTriNho=true mới xóa, và chỉ fact học trong thread đó", async () => {
    const res = await goiXoa(TH, "&xoaTriNho=true");
    const body = (await res.json()) as { triNho: number };

    assert.equal(body.triNho, 1);
    assert.equal(soTriNho(), 1, "fact của thread khác phải còn");
  });

  it('giá trị lạ ở xoaTriNho KHÔNG được hiểu là bật', async () => {
    // Chỉ đúng chuỗi "true" mới xóa. Nhận bừa mọi giá trị "truthy" thì một
    // đường dẫn gõ nhầm (?xoaTriNho=0) cũng xóa mất trí nhớ.
    for (const v of ["1", "yes", "TRUE", ""]) {
      const truoc = soTriNho();
      const res = await goiXoa(TH, `&xoaTriNho=${v}`);
      assert.equal(res.status, 200);
      assert.equal(soTriNho(), truoc, `"${v}" không được coi là bật`);
    }
  });

  it("thread không tồn tại thì vẫn 200 và không nổ - xóa là thao tác lũy đẳng", async () => {
    const res = await goiXoa("t-khong-co-that", "");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { tinNhan: number };
    assert.equal(body.tinNhan, 0);
  });
});
