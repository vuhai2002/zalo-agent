import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Hono } from "hono";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";

/**
 * /api/kb - CRUD nguồn, upload, gán agent. Mọi route đi qua auth middleware
 * chung của dashboard-server.ts (`app.use("/api/*", ...)`) - không auth riêng
 * ở kb-routes.ts, đúng pattern memory-routes.ts/schedule-routes.ts.
 */

let dataDir: string;
let app: Hono;
let cookie: string;
let store: typeof import("../../knowledge/kb-source-store.js");
let fileStore: typeof import("../../knowledge/kb-file-store.js");
let binding: typeof import("../../knowledge/kb-agent-binding.js");
let tuning: typeof import("../../config/runtime-tuning-settings.js");
let database: typeof import("../../conversation/database.js");

const PASSWORD = "mat-khau-kb-routes-123";
const kbDir = () => path.join(dataDir, "kb");

before(async () => {
  dataDir = setupTestEnv({ DASHBOARD_PASSWORD: PASSWORD });
  const { buildDashboardApp } = await import("../dashboard-server.js");
  app = buildDashboardApp();
  store = await import("../../knowledge/kb-source-store.js");
  fileStore = await import("../../knowledge/kb-file-store.js");
  binding = await import("../../knowledge/kb-agent-binding.js");
  tuning = await import("../../config/runtime-tuning-settings.js");
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

// Dọn sạch cả 4 bảng DB LẪN thư mục file trên đĩa trước mỗi test - test nào
// cũng bắt đầu từ một kho trắng, không thì test đếm số file/nguồn ở test SAU
// dính rác từ test TRƯỚC (đặc biệt là test "quá trần" cần thư mục kb/ RỖNG).
beforeEach(() => {
  for (const t of ["kb_sources", "kb_chunks", "kb_chunks_fts", "agent_kb_sources"]) {
    database.db.exec(`DELETE FROM ${t}`);
  }
  fs.rmSync(kbDir(), { recursive: true, force: true });
  fs.mkdirSync(kbDir(), { recursive: true });
  tuning.setTuning("KB_MAX_FILE_MB", null);
});

function formFile(ten: string, buf: Buffer, tenFile = ten): FormData {
  const fd = new FormData();
  fd.append("ten", ten);
  fd.append("file", new File([new Uint8Array(buf)], tenFile));
  return fd;
}
const guiJson = (duong: string, method: string, than: unknown) =>
  app.request(duong, {
    method,
    body: JSON.stringify(than),
    headers: { cookie, "content-type": "application/json" },
  });

describe("POST /api/kb/sources/file", () => {
  it("upload trả 202 và trạng thái cho_xu_ly - KHÔNG chặn request để xử lý", async () => {
    const res = await app.request("/api/kb/sources/file", {
      method: "POST",
      body: formFile("gia.txt", Buffer.from("Bảng giá")),
      headers: { cookie },
    });
    assert.equal(res.status, 202);
    assert.equal(store.danhSachNguon()[0]!.trangThai, "cho_xu_ly");
  });

  it("file quá trần bị từ chối bằng 413, KHÔNG ghi gì xuống đĩa", async () => {
    tuning.setTuning("KB_MAX_FILE_MB", 1);
    const qua = Buffer.alloc(2 * 1024 * 1024, 0x61);
    const res = await app.request("/api/kb/sources/file", {
      method: "POST",
      body: formFile("to.txt", qua),
      headers: { cookie },
    });
    assert.equal(res.status, 413);
    assert.equal(store.danhSachNguon().length, 0);
    assert.equal(fs.readdirSync(kbDir()).length, 0);
  });

  it("đuôi .pdf nhưng nội dung không phải PDF bị từ chối 400", async () => {
    // Tin đuôi tên là mở đường cho file BẤT KỲ nằm trong dataDir
    const res = await app.request("/api/kb/sources/file", {
      method: "POST",
      body: formFile("gia.pdf", Buffer.from("PK\x03\x04 day la zip")),
      headers: { cookie },
    });
    assert.equal(res.status, 400);
    assert.equal(store.danhSachNguon().length, 0, "không được tạo dòng DB khi file không hợp lệ");
  });

  it("đuôi không nằm trong 5 định dạng hỗ trợ bị từ chối 400", async () => {
    const res = await app.request("/api/kb/sources/file", {
      method: "POST",
      body: formFile("virus.exe", Buffer.from("MZ...")),
      headers: { cookie },
    });
    assert.equal(res.status, 400);
  });

  it("thiếu tên nguồn bị từ chối 400", async () => {
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array(Buffer.from("x"))], "gia.txt"));
    const res = await app.request("/api/kb/sources/file", { method: "POST", body: fd, headers: { cookie } });
    assert.equal(res.status, 400);
  });
});

describe("POST /api/kb/sources/text", () => {
  it("gõ tay nội dung tạo được nguồn loai='text', không cần file nào", async () => {
    const res = await guiJson("/api/kb/sources/text", "POST", { ten: "Giờ làm việc", noiDung: "8h - 21h mỗi ngày" });
    assert.equal(res.status, 201);
    const n = store.danhSachNguon()[0]!;
    assert.equal(n.loai, "text");
    assert.equal(n.trangThai, "cho_xu_ly");
    assert.equal(n.duongDan, "", "nguồn gõ tay không được sinh file trên đĩa");
  });

  it("gõ tay với nội dung rỗng bị từ chối 400", async () => {
    const res = await guiJson("/api/kb/sources/text", "POST", { ten: "trống", noiDung: "   " });
    assert.equal(res.status, 400);
    assert.equal(store.danhSachNguon().length, 0);
  });

  it("thiếu tên bị từ chối 400", async () => {
    const res = await guiJson("/api/kb/sources/text", "POST", { ten: "", noiDung: "có nội dung" });
    assert.equal(res.status, 400);
  });
});

describe("GET /api/kb/sources", () => {
  it("liệt kê nguồn vừa tạo", async () => {
    await guiJson("/api/kb/sources/text", "POST", { ten: "A", noiDung: "abc" });
    const res = await app.request("/api/kb/sources", { headers: { cookie } });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { items: { ten: string }[] };
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0]!.ten, "A");
  });
});

describe("POST /api/kb/sources/:id/reindex", () => {
  it("đặt lại cho_xu_ly để xử lý lại", async () => {
    const n = store.taoNguon({ ten: "hỏng rồi", loai: "text", noiDungGoc: "x" });
    store.datTrangThai(n.id, "hong", { loi: "lỗi cũ" });
    const res = await app.request(`/api/kb/sources/${n.id}/reindex`, { method: "POST", headers: { cookie } });
    assert.equal(res.status, 200);
    assert.equal(store.layNguon(n.id)!.trangThai, "cho_xu_ly");
  });

  it("id không tồn tại trả 404", async () => {
    const res = await app.request("/api/kb/sources/khong-ton-tai/reindex", { method: "POST", headers: { cookie } });
    assert.equal(res.status, 404);
  });
});

describe("DELETE /api/kb/sources/:id", () => {
  it("DELETE xóa cả dòng DB lẫn file trên đĩa", async () => {
    const duongDan = fileStore.luuFile("src-del", "txt", Buffer.from("x"));
    const n = store.taoNguon({ ten: "xóa thử", loai: "file", dinhDang: "txt", duongDan });
    const tuyetDoi = path.join(dataDir, duongDan);
    assert.equal(fs.existsSync(tuyetDoi), true, "chưa xóa mà file đã không có thì test vô nghĩa");

    const res = await app.request(`/api/kb/sources/${n.id}`, { method: "DELETE", headers: { cookie } });

    assert.equal(res.status, 200);
    assert.equal(store.layNguon(n.id), null);
    assert.equal(fs.existsSync(tuyetDoi), false, "dòng DB mất nhưng file còn nằm lại - đĩa phình mãi");
  });

  it("xóa nguồn gõ tay (không có file) không lỗi gì", async () => {
    const n = store.taoNguon({ ten: "text thuần", loai: "text", noiDungGoc: "x" });
    const res = await app.request(`/api/kb/sources/${n.id}`, { method: "DELETE", headers: { cookie } });
    assert.equal(res.status, 200);
  });

  it("id không tồn tại trả 404", async () => {
    const res = await app.request("/api/kb/sources/khong-ton-tai", { method: "DELETE", headers: { cookie } });
    assert.equal(res.status, 404);
  });
});

describe("gán nguồn cho agent", () => {
  it("PUT thay thế toàn bộ danh sách", async () => {
    const n1 = store.taoNguon({ ten: "n1", loai: "text", noiDungGoc: "1" });
    const n2 = store.taoNguon({ ten: "n2", loai: "text", noiDungGoc: "2" });

    await guiJson("/api/kb/agents/a1/sources", "PUT", { sourceIds: [n1.id, n2.id] });
    await guiJson("/api/kb/agents/a1/sources", "PUT", { sourceIds: [n2.id] });

    assert.deepEqual(binding.nguonCuaAgent("a1"), [n2.id]);
  });

  it("gán nguồn KHÔNG tồn tại bị từ chối 400", async () => {
    // Không chặn ở đây thì bảng gán tích lũy id rác, và trang agent hiện ô tick
    // trỏ vào hư không
    const res = await guiJson("/api/kb/agents/a1/sources", "PUT", { sourceIds: ["khong-co"] });
    assert.equal(res.status, 400);
    assert.deepEqual(binding.nguonCuaAgent("a1"), []);
  });

  it("GET trả đúng danh sách đã gán", async () => {
    const n1 = store.taoNguon({ ten: "n1", loai: "text", noiDungGoc: "1" });
    binding.datNguonChoAgent("a2", [n1.id]);
    const res = await app.request("/api/kb/agents/a2/sources", { headers: { cookie } });
    const body = (await res.json()) as { sourceIds: string[] };
    assert.deepEqual(body.sourceIds, [n1.id]);
  });
});

describe("auth", () => {
  it("mọi route KB đều đòi đăng nhập", async () => {
    const duong = [
      ["GET", "/api/kb/sources"],
      ["POST", "/api/kb/sources/text"],
      ["DELETE", "/api/kb/sources/x"],
      ["POST", "/api/kb/sources/x/reindex"],
      ["GET", "/api/kb/agents/a/sources"],
      ["PUT", "/api/kb/agents/a/sources"],
    ] as const;
    for (const [m, p] of duong) {
      assert.equal((await app.request(p, { method: m })).status, 401, `${m} ${p} không đòi đăng nhập`);
    }
  });
});
