import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { ZaloApiError, type API } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Account cá nhân khởi động hỏng vì LỖI MẠNG phải được hẹn thử lại, và hẹn đó
 * không được sống sót qua tắt/xóa/dừng hết.
 *
 * Ca thật 2026-11-19: lúc boot DNS chết, `startAllAccounts` log "bỏ qua" rồi
 * thôi - account cá nhân nằm im hơn 30 tiếng. Module hẹn đã có test riêng
 * (`account-start-retry.test.ts`); file này khoá chỗ NỐI vào account-manager:
 * phân loại ở `startAllAccounts`, hủy ở `stopAccount`/`stopAllAccounts`, và hai
 * phép đọc lại sau await trong `startAccount`.
 */
let dataDir: string;
let manager: typeof import("./account-manager.js");
let accounts: typeof import("../config/account-store.js");
let database: typeof import("../conversation/database.js");
let khoiPhucDangNhap: (() => void) | undefined;

const ID = "acc-thu-lai";

before(async () => {
  dataDir = setupTestEnv();
  manager = await import("./account-manager.js");
  accounts = await import("../config/account-store.js");
  database = await import("../conversation/database.js");
});

after(() => {
  manager.stopAllAccounts();
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(() => {
  khoiPhucDangNhap?.();
  khoiPhucDangNhap = undefined;
  manager.stopAllAccounts();
  database.db.exec("DELETE FROM accounts");
  accounts.createAccount({ id: ID, label: "Thử lại" });
});

function apiGia(): API {
  return {
    getOwnId: () => "self-1",
    listener: { on: () => {}, onConnected: () => {}, onClosed: () => {}, start: () => {}, stop: () => {} },
  } as unknown as API;
}

const loiMang = () =>
  new TypeError("fetch failed", {
    cause: Object.assign(new Error("getaddrinfo EAI_AGAIN wpa.chat.zalo.me"), { code: "EAI_AGAIN" }),
  });

function tiemDangNhap(fn: () => Promise<API>): void {
  khoiPhucDangNhap = manager.tiemDangNhapChoTest(fn);
}

describe("startAllAccounts: phân loại lỗi khởi động", () => {
  it("lỗi mạng -> hẹn thử lại (bản cũ: bỏ qua vĩnh viễn)", async () => {
    tiemDangNhap(async () => {
      throw loiMang();
    });
    await manager.startAllAccounts();
    assert.equal(manager.isAccountRunning(ID), false);
    assert.equal(manager.dangHenKhoiDongLai(ID), true, "lỗi mạng lúc boot mà không hẹn thử lại - đúng sự cố prod");
  });

  it("ZaloApiError (phiên chết) -> KHÔNG hẹn, phải quét QR", async () => {
    tiemDangNhap(async () => {
      throw new ZaloApiError("Đăng nhập thất bại");
    });
    await manager.startAllAccounts();
    assert.equal(manager.dangHenKhoiDongLai(ID), false);
  });
});

describe("hẹn thử lại không sống sót qua dừng", () => {
  it("`stopAccount` (tắt/xóa trên dashboard) gỡ hẹn", async () => {
    tiemDangNhap(async () => {
      throw loiMang();
    });
    await manager.startAllAccounts();
    assert.equal(manager.dangHenKhoiDongLai(ID), true);
    manager.stopAccount(ID);
    assert.equal(manager.dangHenKhoiDongLai(ID), false);
  });

  it("`stopAllAccounts` (shutdown) gỡ mọi hẹn", async () => {
    tiemDangNhap(async () => {
      throw loiMang();
    });
    await manager.startAllAccounts();
    manager.stopAllAccounts();
    assert.equal(manager.dangHenKhoiDongLai(ID), false);
  });

  it("gắn phiên mới (quét QR) gỡ hẹn", async () => {
    tiemDangNhap(async () => {
      throw loiMang();
    });
    await manager.startAllAccounts();
    manager.attachAccount(accounts.getAccount(ID)!, apiGia());
    assert.equal(manager.dangHenKhoiDongLai(ID), false);
  });
});

describe("lấy bù tin lỡ đi theo vòng đời account", () => {
  it("dây thật: listener báo kết nối (onConnected của startListener) -> xin bù 510", () => {
    const lenh: { cmd: number }[] = [];
    let khiKetNoi: (() => void) | undefined;
    const api = {
      getOwnId: () => "self-1",
      listener: {
        on: () => {},
        onConnected: (cb: () => void) => {
          khiKetNoi = cb;
        },
        onClosed: () => {},
        start: () => {},
        stop: () => {},
        sendWs: (p: { cmd: number }) => lenh.push(p),
      },
    } as unknown as API;
    manager.attachAccount(accounts.getAccount(ID)!, api);
    khiKetNoi?.();
    manager.stopAccount(ID);
    assert.deepEqual(
      lenh.map((l) => l.cmd),
      [510],
    );
  });

  it("gắn phiên thì đăng ký lấy bù, dừng account thì gỡ", async () => {
    const registry = await import("./offline-replay/lay-bu-registry.js");
    manager.attachAccount(accounts.getAccount(ID)!, apiGia());
    assert.ok(registry.layBuCuaAccount(ID), "account cá nhân chạy mà không có lấy bù");
    manager.stopAccount(ID);
    assert.equal(registry.layBuCuaAccount(ID), undefined, "dừng account mà lấy bù vẫn sống");
  });
});

describe("startAccount đọc lại trạng thái sau khi đăng nhập", () => {
  it("account bị TẮT trong lúc đăng nhập -> không vào sổ chạy", async () => {
    tiemDangNhap(async () => {
      accounts.updateAccount(ID, { enabled: false });
      return apiGia();
    });
    await manager.startAccount(ID);
    assert.equal(manager.isAccountRunning(ID), false, "account đã tắt mà vẫn chạy - công tắc an toàn hỏng câm");
  });

  it("account bị XÓA trong lúc đăng nhập -> không vào sổ chạy", async () => {
    tiemDangNhap(async () => {
      accounts.deleteAccount(ID);
      return apiGia();
    });
    await manager.startAccount(ID);
    assert.equal(manager.isAccountRunning(ID), false);
  });

  it("lượt thử lại (`boQuaNeuDangChay`) không ghi đè phiên vừa quét QR", async () => {
    const apiQr = apiGia();
    tiemDangNhap(async () => {
      // Người vận hành quét QR xong đúng lúc lượt thử lại đang đăng nhập
      manager.attachAccount(accounts.getAccount(ID)!, apiQr);
      return apiGia();
    });
    await manager.startAccount(ID, { boQuaNeuDangChay: true });
    assert.equal(manager.getRunningAccountKenh(ID)?.api, apiQr, "phiên QR bị phiên cookie cũ ghi đè");
  });
});
