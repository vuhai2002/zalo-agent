import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Cổng kiểm token lúc khởi động tài khoản bot.
 *
 * Hai ca phải TÁCH BẠCH, và bản đầu gộp nhầm chúng làm một:
 * - LỖI TOKEN: chờ bao lâu cũng không tự hết, phải có người nhập lại -> NÉM để
 *   `startAccount` không cài account vào `running`.
 * - LỖI MẠNG: tự lành -> vẫn mở vòng poll, backoff lo phần còn lại.
 *
 * Bản đầu tính `err.httpStatus ?? Number(err.maLoi)`, mà `goi()` luôn gán
 * `httpStatus = res.status` và Zalo trả lỗi trong THÂN kèm HTTP 200 - nên nhánh
 * `??` là code chết và `laLoiToken` LUÔN false. Không test nào chạm tới nó:
 * test route ném `new Error(...)` trần, không phải `LoiZaloBotApi`.
 */
let dataDir: string;
let runner: typeof import("./bot-account-runner.js");
let client: typeof import("./zalo-bot-api-client.js");

before(async () => {
  dataDir = setupTestEnv();
  runner = await import("./bot-account-runner.js");
  client = await import("./zalo-bot-api-client.js");
});

after(async () => {
  (await import("../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

/** Client thật, chỉ thay `fetch` - để đi qua ĐÚNG đường dựng lỗi của `goi()` */
function clientVoiPhanHoi(than: unknown, status = 200) {
  const f = (async () =>
    new Response(typeof than === "string" ? than : JSON.stringify(than), { status })) as unknown as typeof fetch;
  return () => client.taoZaloBotClient({ token: "123:abc", fetchImpl: f, gocApi: "https://x.test" });
}

describe("cổng kiểm token lúc khởi động", () => {
  it("TOKEN SAI (ok:false + error_code 401 kèm HTTP 200) thì NÉM, không mở vòng poll", async () => {
    // Đây là hình dạng lỗi THẬT của Zalo - đo được và đã ghi trong tài liệu
    // kiến trúc. Không ném thì `running.set` cài account, dashboard báo xanh
    // "Đang chạy", còn vòng poll lỗi mỗi vòng và bot im lặng vĩnh viễn.
    const khoiPhuc = runner.tiemClientRunnerChoTest(
      clientVoiPhanHoi({ ok: false, description: "Invalid token", error_code: 401 }),
    );
    try {
      await assert.rejects(() => runner.chayTaiKhoanBot({ accountId: "b1", token: "123:abc" }));
    } finally {
      khoiPhuc();
    }
  });

  it("403 trong thân cũng là lỗi token", async () => {
    const khoiPhuc = runner.tiemClientRunnerChoTest(
      clientVoiPhanHoi({ ok: false, description: "Forbidden", error_code: 403 }),
    );
    try {
      await assert.rejects(() => runner.chayTaiKhoanBot({ accountId: "b1", token: "123:abc" }));
    } finally {
      khoiPhuc();
    }
  });

  it("LỖI MẠNG thì VẪN mở vòng poll - backoff tự lo, không giết account vĩnh viễn", async () => {
    // Container lên trước khi DNS sẵn sàng là ca rất phổ biến. Ném ở đây thì
    // `startAllAccounts` chỉ log rồi bỏ qua, không ai hẹn thử lại.
    const f = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const khoiPhuc = runner.tiemClientRunnerChoTest(() =>
      client.taoZaloBotClient({ token: "123:abc", fetchImpl: f, gocApi: "https://x.test" }),
    );
    try {
      const { dung } = await runner.chayTaiKhoanBot({ accountId: "b1", token: "123:abc" });
      dung();
    } finally {
      khoiPhuc();
    }
  });

  it("404 (method không tồn tại) KHÔNG bị coi là lỗi token", async () => {
    // 13/17 method trả 404 theo số đo. Chặn oan ca này là mọi account bot chết
    // lúc boot nếu Zalo bỏ một method phụ.
    const khoiPhuc = runner.tiemClientRunnerChoTest(
      clientVoiPhanHoi({ ok: false, description: "Not Found", error_code: 404 }),
    );
    try {
      const { dung } = await runner.chayTaiKhoanBot({ accountId: "b1", token: "123:abc" });
      dung();
    } finally {
      khoiPhuc();
    }
  });
});
