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
let agents: typeof import("../../config/agent-store.js");
let database: typeof import("../../conversation/database.js");
let queries: typeof import("../../knowledge/kb-source-queries.js");

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
  agents = await import("../../config/agent-store.js");
  database = await import("../../conversation/database.js");
  queries = await import("../../knowledge/kb-source-queries.js");

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
  for (const t of ["kb_sources", "kb_chunks", "kb_chunks_fts", "agent_kb_sources", "agents"]) {
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

  // Nhánh CHẤP NHẬN: test thất bại (magic bytes sai) ở trên không chứng minh
  // được nhánh khớp CHẤP NHẬN có thật sự nối đúng vào MAGIC_BYTES hay không -
  // một bản cài đặt từ chối 100% pdf/docx/xlsx vẫn xanh nếu chỉ có test hỏng.
  it("pdf với chữ ký thật (%PDF) được chấp nhận, trả 202", async () => {
    const res = await app.request("/api/kb/sources/file", {
      method: "POST",
      body: formFile("gia.pdf", Buffer.from("%PDF-1.7\nnoi dung gia lap, chi can dung chu ky dau file")),
      headers: { cookie },
    });
    assert.equal(res.status, 202);
    assert.equal(store.danhSachNguon()[0]!.dinhDang, "pdf");
  });

  it("docx với chữ ký thật (PK) được chấp nhận, trả 202", async () => {
    const res = await app.request("/api/kb/sources/file", {
      method: "POST",
      body: formFile("hop-dong.docx", Buffer.from("PK\x03\x04 noi dung gia lap, chi can dung chu ky dau file")),
      headers: { cookie },
    });
    assert.equal(res.status, 202);
    assert.equal(store.danhSachNguon()[0]!.dinhDang, "docx");
  });

  it("xlsx với chữ ký thật (PK) được chấp nhận, trả 202", async () => {
    const res = await app.request("/api/kb/sources/file", {
      method: "POST",
      body: formFile("bang-gia.xlsx", Buffer.from("PK\x03\x04 noi dung gia lap, chi can dung chu ky dau file")),
      headers: { cookie },
    });
    assert.equal(res.status, 202);
    assert.equal(store.danhSachNguon()[0]!.dinhDang, "xlsx");
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

  it("tên quá 200 ký tự bị từ chối 400 - ô maxLength ở form chỉ là giao diện", async () => {
    const res = await guiJson("/api/kb/sources/text", "POST", { ten: "a".repeat(201), noiDung: "x" });
    assert.equal(res.status, 400);
  });

  it("nội dung gõ tay quá trần KB_MAX_FILE_MB bị từ chối, KHÔNG ghi gì xuống DB", async () => {
    // c.req.json() gom trọn body vào RAM TRƯỚC khi kịp kiểm gì - phải chặn
    // được ở đây chứ không chỉ ở route upload file.
    tuning.setTuning("KB_MAX_FILE_MB", 1);
    const res = await guiJson("/api/kb/sources/text", "POST", {
      ten: "quá khổ",
      noiDung: "a".repeat(2 * 1024 * 1024),
    });
    assert.equal(res.status, 413);
    assert.equal(store.danhSachNguon().length, 0, "không được tạo dòng DB khi nội dung vượt trần");
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

  it("KHÔNG kéo theo noi_dung_goc - trang tự làm mới mỗi vài giây, kéo dư toàn văn là phí băng thông", async () => {
    await guiJson("/api/kb/sources/text", "POST", { ten: "B", noiDung: "nội dung bí mật dài" });
    const res = await app.request("/api/kb/sources", { headers: { cookie } });
    const body = (await res.json()) as { items: Record<string, unknown>[] };
    assert.equal(body.items.length, 1);
    assert.equal("noiDungGoc" in body.items[0]!, false, "response vẫn còn field noiDungGoc");
  });
});

describe("POST /api/kb/sources/:id/reindex", () => {
  it("đặt lại cho_xu_ly để xử lý lại, cấp lại budget lượt thử (soLanThu về 0)", async () => {
    const n = store.taoNguon({ ten: "hỏng rồi", loai: "text", noiDungGoc: "x" });
    store.datTrangThai(n.id, "hong", { loi: "lỗi cũ" });
    // Mô phỏng nguồn này đã tiêu vài lượt thử TRƯỚC lúc hỏng - bấm "Xử lý lại"
    // là hành động CHỦ ĐỘNG của người vận hành, phải cấp lại budget đầy đủ,
    // không cộng dồn lượt đã tiêu từ trước.
    queries.giaNguonChoXuLy(n.id, 5);
    store.datTrangThai(n.id, "hong", { loi: "lỗi cũ" });

    const res = await app.request(`/api/kb/sources/${n.id}/reindex`, { method: "POST", headers: { cookie } });
    assert.equal(res.status, 200);
    const sau = store.layNguon(n.id)!;
    assert.equal(sau.trangThai, "cho_xu_ly");
    assert.equal(sau.soLanThu, 0, "bấm Xử lý lại phải cấp lại budget lượt thử đầy đủ");
  });

  it("id không tồn tại trả 404", async () => {
    const res = await app.request("/api/kb/sources/khong-ton-tai/reindex", { method: "POST", headers: { cookie } });
    assert.equal(res.status, 404);
  });

  it("bấm Xử lý lại lúc nguồn đang dang_xu_ly trả 409, không nuốt lặng lẽ (I6)", async () => {
    const n = store.taoNguon({ ten: "đang xử lý", loai: "text", noiDungGoc: "abc" });
    store.datTrangThai(n.id, "dang_xu_ly");
    const res = await app.request(`/api/kb/sources/${n.id}/reindex`, { method: "POST", headers: { cookie } });
    assert.equal(res.status, 409);
    assert.equal(
      store.layNguon(n.id)!.trangThai,
      "dang_xu_ly",
      "route KHÔNG được đổi trạng thái khi từ chối - lượt đang chạy phải là nơi duy nhất quyết định trạng thái cuối",
    );
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
    agents.createAgent({ id: "a1", name: "Agent A1" });
    const n1 = store.taoNguon({ ten: "n1", loai: "text", noiDungGoc: "1" });
    const n2 = store.taoNguon({ ten: "n2", loai: "text", noiDungGoc: "2" });

    await guiJson("/api/kb/agents/a1/sources", "PUT", { sourceIds: [n1.id, n2.id] });
    await guiJson("/api/kb/agents/a1/sources", "PUT", { sourceIds: [n2.id] });

    assert.deepEqual(binding.nguonCuaAgent("a1"), [n2.id]);
  });

  it("gán nguồn KHÔNG tồn tại bị từ chối 400", async () => {
    agents.createAgent({ id: "a1", name: "Agent A1" });
    // Không chặn ở đây thì bảng gán tích lũy id rác, và trang agent hiện ô tick
    // trỏ vào hư không
    const res = await guiJson("/api/kb/agents/a1/sources", "PUT", { sourceIds: ["khong-co"] });
    assert.equal(res.status, 400);
    assert.deepEqual(binding.nguonCuaAgent("a1"), []);
  });

  it("gán cho agentId KHÔNG tồn tại bị từ chối 400 - không được tạo dòng gán mồ côi", async () => {
    const n1 = store.taoNguon({ ten: "n1", loai: "text", noiDungGoc: "1" });
    const res = await guiJson("/api/kb/agents/agent-khong-ton-tai/sources", "PUT", { sourceIds: [n1.id] });
    assert.equal(res.status, 400);
    assert.deepEqual(binding.nguonCuaAgent("agent-khong-ton-tai"), []);
  });

  // Không thử với vài trăm id "không tồn tại": id không tồn tại CŨNG ra 400
  // (nhánh "Nguồn không tồn tại" ở dưới), nên phép thử đó đỏ y hệt dù có
  // .max(500) hay không - không chứng minh được gì về CHÍNH cái trần này.
  // Test dưới đây vượt THẲNG qua SQLITE_LIMIT_VARIABLE_NUMBER (đo thật: 32766
  // OK, 32767 ném "too many SQL variables") để lộ ra khác biệt thật: có
  // .max(500) thì chặn ở schema (400) TRƯỚC KHI build câu SQL nào; bỏ .max()
  // thì lọt xuống `locIdTonTai()`, câu `IN (...)` 33.000 placeholder ném lỗi,
  // Hono không có `onError` riêng nên rơi về 500 trần (không lý do đọc được).
  it("sourceIds vượt xa SQLITE_LIMIT_VARIABLE_NUMBER vẫn bị chặn 400 nhờ .max(500) - không lọt xuống tới câu SQL", async () => {
    agents.createAgent({ id: "a1", name: "Agent A1" });
    const qua = Array.from({ length: 33_000 }, (_, i) => `id-${i}`);
    const res = await guiJson("/api/kb/agents/a1/sources", "PUT", { sourceIds: qua });
    assert.equal(res.status, 400, `phải chặn ở schema với 400 có lý do, không phải văng 500 trần - nhận ${res.status}`);
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
