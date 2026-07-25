import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { API } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import type { QrLoginEvent } from "./zalo-client.js";

let dataDir: string;
let manager: typeof import("./qr-login-manager.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  manager = await import("./qr-login-manager.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Login giả điều khiển được từng bước qua emit + resolve/reject */
function fakeLogin() {
  let emit!: (e: QrLoginEvent) => void;
  let resolve!: (api: API) => void;
  let reject!: (err: Error) => void;
  const attached: string[] = [];

  const deps = {
    login: (_accountId: string, onEvent: (e: QrLoginEvent) => void) => {
      emit = onEvent;
      return new Promise<API>((res, rej) => {
        resolve = res;
        reject = rej;
      });
    },
    attach: (accountId: string) => attached.push(accountId),
  };
  return {
    deps,
    attached,
    emit: (e: QrLoginEvent) => emit(e),
    finish: () => resolve({} as API),
    fail: (msg: string) => reject(new Error(msg)),
  };
}

describe("qr-login-manager", () => {
  it("luồng chuẩn: starting -> waiting_scan (có QR) -> scanned -> success + attach", async () => {
    const fake = fakeLogin();
    manager.startQrLogin("acc-qr-1", fake.deps);
    assert.equal(manager.getQrLoginStatus("acc-qr-1").status, "starting");

    fake.emit({ type: "qr", qrBase64: "QR_BASE64_DATA" });
    const waiting = manager.getQrLoginStatus("acc-qr-1");
    assert.equal(waiting.status, "waiting_scan");
    assert.equal(waiting.qrDataUri, "data:image/png;base64,QR_BASE64_DATA");

    fake.emit({ type: "scanned" });
    assert.equal(manager.getQrLoginStatus("acc-qr-1").status, "scanned");

    fake.finish();
    await sleep(10);
    const done = manager.getQrLoginStatus("acc-qr-1");
    assert.equal(done.status, "success");
    assert.equal(done.qrDataUri, undefined, "QR phải bị xóa sau khi login xong");
    assert.deepEqual(fake.attached, ["acc-qr-1"]);
  });

  it("QR hết hạn: zca-js bắn lại QR mới, UI nhận ảnh mới", () => {
    const fake = fakeLogin();
    manager.startQrLogin("acc-qr-2", fake.deps);
    fake.emit({ type: "qr", qrBase64: "QR_CU" });
    fake.emit({ type: "expired" });
    fake.emit({ type: "qr", qrBase64: "QR_MOI" });

    const state = manager.getQrLoginStatus("acc-qr-2");
    assert.equal(state.status, "waiting_scan");
    assert.ok(state.qrDataUri!.includes("QR_MOI"));
  });

  it("từ chối trên điện thoại -> declined; login lỗi -> error kèm message", async () => {
    const fake1 = fakeLogin();
    manager.startQrLogin("acc-qr-3", fake1.deps);
    fake1.emit({ type: "declined" });
    assert.equal(manager.getQrLoginStatus("acc-qr-3").status, "declined");

    const fake2 = fakeLogin();
    manager.startQrLogin("acc-qr-4", fake2.deps);
    fake2.fail("mạng rớt");
    await sleep(10);
    const state = manager.getQrLoginStatus("acc-qr-4");
    assert.equal(state.status, "error");
    assert.equal(state.error, "mạng rớt");
  });

  it("phiên đang sống thì start lần 2 là idempotent (không tạo QR mới)", () => {
    const fake = fakeLogin();
    const first = manager.startQrLogin("acc-qr-5", fake.deps);
    fake.emit({ type: "qr", qrBase64: "QR_A" });

    const second = manager.startQrLogin("acc-qr-5", fakeLogin().deps);
    assert.equal(second.seq, first.seq, "phải trả về đúng phiên đang chạy");
  });

  it("phiên mới đè phiên chết: kết quả muộn của phiên cũ bị bỏ qua", async () => {
    const fake1 = fakeLogin();
    manager.startQrLogin("acc-qr-6", fake1.deps);
    fake1.emit({ type: "declined" }); // phiên 1 chết

    const fake2 = fakeLogin();
    manager.startQrLogin("acc-qr-6", fake2.deps);
    fake2.emit({ type: "qr", qrBase64: "QR_PHIEN_2" });

    // Phiên 1 resolve muộn - không được đè trạng thái phiên 2
    fake1.finish();
    await sleep(10);
    const state = manager.getQrLoginStatus("acc-qr-6");
    assert.equal(state.status, "waiting_scan");
    assert.deepEqual(fake1.attached, [], "phiên cũ không được attach");
  });

  it("chưa từng start -> idle", () => {
    assert.equal(manager.getQrLoginStatus("acc-chua-start").status, "idle");
  });
});
