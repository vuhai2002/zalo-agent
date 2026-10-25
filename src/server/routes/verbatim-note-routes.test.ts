import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Hono } from "hono";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";

/**
 * /api/verbatim-notes: người vận hành xem ghi chú nguyên văn của MỌI người (kèm
 * tên trong danh bạ) và xóa được - nhưng phải đăng nhập, phải nêu accountId, và
 * xóa không lây sang account khác.
 */

let dataDir: string;
let app: Hono;
let cookie: string;
let store: typeof import("../../conversation/verbatim-note-store.js");
let contacts: typeof import("../../conversation/contact-store.js");
let database: typeof import("../../conversation/database.js");

const PASSWORD = "mat-khau-note-123";

before(async () => {
  dataDir = setupTestEnv({ DASHBOARD_PASSWORD: PASSWORD });
  const { buildDashboardApp } = await import("../dashboard-server.js");
  app = buildDashboardApp();
  store = await import("../../conversation/verbatim-note-store.js");
  contacts = await import("../../conversation/contact-store.js");
  database = await import("../../conversation/database.js");
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

function luu(accountId: string, subjectId: string, title: string, content: string) {
  const kq = store.luuGhiChu(
    { accountId, subjectId, chiTrongNhom: false },
    { title, content, threadId: subjectId, isGroup: false },
    100,
  );
  assert.ok(kq.ok);
}

const get = (url: string) => app.request(url, { headers: { cookie } });
const del = (url: string) => app.request(url, { method: "DELETE", headers: { cookie } });

beforeEach(() => {
  database.db.exec("DELETE FROM verbatim_notes; DELETE FROM contacts;");
  contacts.recordContactActivity("acc-a", "u1", "An Khánh");
  luu("acc-a", "u1", "Thông báo nhận quà", "Địa điểm:  Trước cổng phụ\n\nLiên hệ: Bạn A");
  luu("acc-b", "u2", "Lời cảm ơn", "Cảm ơn HĐ ạ");
});

describe("GET /api/verbatim-notes", () => {
  it("chưa đăng nhập -> 401", async () => {
    assert.equal((await app.request("/api/verbatim-notes")).status, 401);
  });

  it("trả đủ nội dung NGUYÊN VĂN kèm tên trong danh bạ", async () => {
    const { items } = (await (await get("/api/verbatim-notes?accountId=acc-a")).json()) as {
      items: { title: string; content: string; tenNguoi: string }[];
    };
    assert.equal(items.length, 1);
    assert.equal(items[0]!.tenNguoi, "An Khánh");
    assert.equal(items[0]!.content, "Địa điểm:  Trước cổng phụ\n\nLiên hệ: Bạn A");
  });

  it("không lọc account thì thấy mọi account; tìm được theo tên người", async () => {
    const tatCa = (await (await get("/api/verbatim-notes")).json()) as { items: unknown[] };
    assert.equal(tatCa.items.length, 2);
    const theoTen = (await (await get(`/api/verbatim-notes?q=${encodeURIComponent("Khánh")}`)).json()) as {
      items: { title: string }[];
    };
    assert.deepEqual(theoTen.items.map((i) => i.title), ["Thông báo nhận quà"]);
  });
});

describe("DELETE /api/verbatim-notes/:id", () => {
  async function idCua(title: string) {
    const { items } = (await (await get("/api/verbatim-notes")).json()) as { items: { id: number; title: string }[] };
    return items.find((i) => i.title === title)!.id;
  }

  it("thiếu accountId -> 400, không xóa gì", async () => {
    assert.equal((await del(`/api/verbatim-notes/${await idCua("Lời cảm ơn")}`)).status, 400);
    assert.equal(((await (await get("/api/verbatim-notes")).json()) as { items: unknown[] }).items.length, 2);
  });

  it("accountId KHÁC account của ghi chú -> 404, ghi chú còn nguyên", async () => {
    assert.equal((await del(`/api/verbatim-notes/${await idCua("Lời cảm ơn")}?accountId=acc-a`)).status, 404);
    assert.equal(((await (await get("/api/verbatim-notes")).json()) as { items: unknown[] }).items.length, 2);
  });

  it("đúng account -> xóa", async () => {
    assert.equal((await del(`/api/verbatim-notes/${await idCua("Lời cảm ơn")}?accountId=acc-b`)).status, 200);
    const { items } = (await (await get("/api/verbatim-notes")).json()) as { items: { title: string }[] };
    assert.deepEqual(items.map((i) => i.title), ["Thông báo nhận quà"]);
  });
});
