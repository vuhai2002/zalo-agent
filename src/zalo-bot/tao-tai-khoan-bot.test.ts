import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Hono } from "hono";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Tạo tài khoản bot và lưu token qua dashboard.
 *
 * Hai bất biến quan trọng nhất ở đây đều về BÍ MẬT và về FAIL-CLOSED:
 * - Token không được lọt ra bất kỳ response nào.
 * - Token sai KHÔNG được lưu: lưu rồi thì tài khoản trông như đã cấu hình xong
 *   mà không bao giờ chạy, và triệu chứng duy nhất là bot im lặng.
 */
let dataDir: string;
let app: Hono;
let cookie: string;
let accounts: typeof import("../config/account-store.js");
let database: typeof import("../conversation/database.js");
let routes: typeof import("../server/routes/account-routes.js");
let runner: typeof import("./bot-account-runner.js");

const PASSWORD = "mat-khau-tao-bot-123";
const TOKEN_THAT_DANG = "123456789:abcDEF_ghi-JKL";

before(async () => {
  dataDir = setupTestEnv({ DASHBOARD_PASSWORD: PASSWORD });
  const { buildDashboardApp } = await import("../server/dashboard-server.js");
  app = buildDashboardApp();
  accounts = await import("../config/account-store.js");
  database = await import("../conversation/database.js");
  routes = await import("../server/routes/account-routes.js");
  runner = await import("./bot-account-runner.js");

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

beforeEach(() => {
  database.db.exec("DELETE FROM accounts");
});

const goi = (duong: string, method: string, than?: unknown) =>
  app.request(duong, {
    method,
    ...(than ? { body: JSON.stringify(than) } : {}),
    headers: { cookie, "content-type": "application/json" },
  });

describe("tạo tài khoản bot qua dashboard", () => {
  it("tạo với loai=bot thì lưu đúng loại", async () => {
    const res = await goi("/api/accounts", "POST", { id: "b1", label: "Bot", loai: "bot" });
    assert.equal(res.status, 201);
    assert.equal(accounts.getAccount("b1")?.loai, "bot");
  });

  it("KHÔNG truyền loai thì mặc định là tài khoản cá nhân", async () => {
    // Mặc định phải giữ nguyên hành vi cũ: mọi tài khoản đã tạo trước khi có
    // trường này đều là cá nhân.
    await goi("/api/accounts", "POST", { id: "b2", label: "Thường" });
    assert.equal(accounts.getAccount("b2")?.loai, "ca_nhan");
  });

  it("tài khoản bot mặc định ĐÓNG danh sách cho phép", async () => {
    // Bán kính khác hẳn tài khoản cá nhân: nick cá nhân phải là bạn bè mới nhắn
    // được, còn bot thì ai có link cũng nhắn được. Mở sẵn là mời người lạ đốt
    // token và thử prompt injection.
    await goi("/api/accounts", "POST", { id: "b3", label: "Bot", loai: "bot" });
    assert.equal(accounts.getAccount("b3")?.allowlist.mode, "list");
  });

  it("tài khoản cá nhân giữ nguyên mặc định MỞ - không đổi hành vi cũ", async () => {
    await goi("/api/accounts", "POST", { id: "b4", label: "Thường" });
    assert.equal(accounts.getAccount("b4")?.allowlist.mode, "all");
  });

  it("loai lạ bị từ chối 400, và KHÔNG tạo ra bản ghi nào", async () => {
    const res = await goi("/api/accounts", "POST", { id: "b5", label: "X", loai: "gi-do" });
    assert.equal(res.status, 400);
    assert.equal(accounts.getAccount("b5"), null, "từ chối rồi mà vẫn tạo bản ghi");
  });

  it("PATCH KHÔNG đổi được loại kênh - chốt lúc tạo là chốt thật", async () => {
    // Ba lớp chặn (patchSchema không khai, updateAccount thu hẹp kiểu, câu
    // UPDATE không có cột) nhưng chưa có gì canh. Đổi loại của tài khoản đang
    // chạy là đổi luôn ý nghĩa của credential đã lưu.
    await goi("/api/accounts", "POST", { id: "b6", label: "Bot", loai: "bot" });
    const res = await goi("/api/accounts/b6", "PATCH", { loai: "ca_nhan", label: "Đổi tên" });
    assert.equal(res.status, 200);
    assert.equal(accounts.getAccount("b6")?.loai, "bot", "PATCH đổi được loại kênh");
    assert.equal(accounts.getAccount("b6")?.label, "Đổi tên", "PATCH không còn sửa được gì cả");
  });
});

describe("PUT /accounts/:id/bot-token", () => {
  it("token SAI ĐỊNH DẠNG bị chặn trước khi ra mạng", async () => {
    // Dán nhầm cả câu thông báo, hoặc thiếu một nửa - lỗi thường gặp nhất.
    await goi("/api/accounts", "POST", { id: "b1", label: "Bot", loai: "bot" });
    const res = await goi("/api/accounts/b1/bot-token", "PUT", { token: "day khong phai token" });
    assert.equal(res.status, 400);
    assert.equal(accounts.getAccount("b1")?.coBotToken, false);

    // KHÔNG chỉ xét mã 400: route này có tới ba nhánh cùng trả 400 (sai định
    // dạng, không phải tài khoản bot, token không dùng được). Xét mã thôi thì
    // bỏ hẳn phép kiểm định dạng test vẫn xanh - nó rơi xuống nhánh gọi mạng
    // rồi hỏng ở đó. Phải chỉ đích danh nhánh đang đo.
    const than = (await res.json()) as { error?: string; issues?: unknown[] };
    assert.ok(than.issues, `phải là lỗi schema, nhận: ${JSON.stringify(than)}`);
  });

  it("Zalo TỪ CHỐI token thì KHÔNG lưu - fail closed", async () => {
    // Bản trước gọi API THẬT, nên nó xanh y hệt khi máy không có mạng (đo:
    // 94ms có mạng, 2,4ms khi fetch ném - cả hai xanh). Tức chứng minh đúng số
    // không, và mỗi lần `pnpm test` là một request ra Internet.
    await goi("/api/accounts", "POST", { id: "b1", label: "Bot", loai: "bot" });
    const khoiPhuc = routes.tiemClientBotChoTest(
      () => ({ getMe: async () => { throw new Error("Unauthorized"); } }) as never,
    );
    try {
      const res = await goi("/api/accounts/b1/bot-token", "PUT", { token: TOKEN_THAT_DANG });
      assert.equal(res.status, 400);
      assert.equal(accounts.getAccount("b1")?.coBotToken, false, "token hỏng vẫn được lưu");
    } finally {
      khoiPhuc();
    }
  });

  it("MẠNG RỚT lúc kiểm cũng KHÔNG lưu - nhánh khác hẳn Zalo từ chối", async () => {
    // Hai nguyên nhân khác nhau, cùng phải fail closed. Bản cũ không phân biệt
    // được vì cả hai đều rơi vào một lời gọi thật.
    await goi("/api/accounts", "POST", { id: "b1", label: "Bot", loai: "bot" });
    const khoiPhuc = routes.tiemClientBotChoTest(
      () => ({ getMe: async () => { throw new TypeError("fetch failed"); } }) as never,
    );
    try {
      const res = await goi("/api/accounts/b1/bot-token", "PUT", { token: TOKEN_THAT_DANG });
      assert.equal(res.status, 400);
      assert.equal(accounts.getAccount("b1")?.coBotToken, false);
    } finally {
      khoiPhuc();
    }
  });

  it("token ĐÚNG thì lưu, mã hóa được, giải mã lại KHỚP, VÀ khởi động được", async () => {
    // Nhánh THÀNH CÔNG chưa lần nào chạy trong test: bỏ hẳn `datBotToken(...)`
    // khỏi route mà 11/11 ca vẫn xanh. Ca này chốt cả vòng mã hóa/giải mã.
    //
    // Phải tiêm client ở CẢ HAI chỗ: route (để `getMe` kiểm token) và runner
    // (vì lưu xong route khởi động lại account, đi qua `chayTaiKhoanBot`).
    // Thiếu chỗ thứ hai thì `pnpm test` bắn một request THẬT tới
    // `bot-api.zaloplatforms.com` - đã đo bằng spy trên `globalThis.fetch`.
    await goi("/api/accounts", "POST", { id: "b1", label: "Bot", loai: "bot" });
    const clientGia = () =>
      ({
        getMe: async () => ({ id: "999", display_name: "Bot Thử" }),
        getWebhookInfo: async () => ({ url: "" }),
        deleteWebhook: async () => ({}),
        getUpdates: async () => null,
      }) as never;
    const khoiPhuc = routes.tiemClientBotChoTest(clientGia);
    const khoiPhuc2 = runner.tiemClientRunnerChoTest(clientGia);
    try {
      const res = await goi("/api/accounts/b1/bot-token", "PUT", { token: TOKEN_THAT_DANG });
      assert.equal(res.status, 200);
      const than = (await res.json()) as { botName?: string; warning?: string };
      assert.equal(than.botName, "Bot Thử");
      // Khởi động lại là MỘT trong bốn quyết định của trang Accounts. Không
      // khẳng định thì nó hỏng vào trường `warning` mà không ai biết.
      assert.equal(than.warning, undefined, `khởi động lại thất bại: ${than.warning}`);
      assert.equal(accounts.getAccount("b1")?.coBotToken, true);
      assert.equal(accounts.layBotTokenGiaiMa("b1"), TOKEN_THAT_DANG, "giải mã ra khác token đã lưu");

      const dangChay = (await import("../zalo/account-manager.js")).isAccountRunning("b1");
      assert.equal(dangChay, true, "lưu token xong mà account không lên sóng");
    } finally {
      (await import("../zalo/account-manager.js")).stopAccount("b1");
      khoiPhuc();
      khoiPhuc2();
    }
  });

  it("tài khoản CÁ NHÂN không nhận token", async () => {
    await goi("/api/accounts", "POST", { id: "b2", label: "Thường" });
    const res = await goi("/api/accounts/b2/bot-token", "PUT", { token: TOKEN_THAT_DANG });
    assert.equal(res.status, 400);

    // Cùng lý do với ca trên: bỏ phép kiểm loại tài khoản thì lời gọi rơi xuống
    // nhánh mạng và cũng ra 400, test vẫn xanh mà bất biến đã vỡ.
    const than = (await res.json()) as { error?: string };
    assert.match(than.error ?? "", /tài khoản loại bot/);
  });

  it("account không tồn tại thì 404", async () => {
    const res = await goi("/api/accounts/khong-co/bot-token", "PUT", { token: TOKEN_THAT_DANG });
    assert.equal(res.status, 404);
  });

  it("đòi đăng nhập", async () => {
    const res = await app.request("/api/accounts/b1/bot-token", { method: "PUT" });
    assert.equal(res.status, 401);
  });

  it("GET /accounts KHÔNG BAO GIỜ trả token ra ngoài", async () => {
    // `AccountConfig` cố ý chỉ mang `coBotToken: boolean`. Đây là chốt canh cho
    // quyết định đó - thêm token vào object là lộ bí mật cho mọi phiên dashboard.
    await goi("/api/accounts", "POST", { id: "b1", label: "Bot", loai: "bot" });
    accounts.datBotToken("b1", TOKEN_THAT_DANG);

    const body = await (await goi("/api/accounts", "GET")).text();
    assert.ok(!body.includes(TOKEN_THAT_DANG), "token lọt vào GET /api/accounts");
    assert.match(body, /"coBotToken":true/);
  });
});
