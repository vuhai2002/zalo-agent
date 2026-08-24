import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Config auto-accept kết bạn per-account. `setupTestEnv()` trước rồi mới import
 * (account-store bắc cầu tới database.ts).
 */
let dataDir: string;
let store: typeof import("./account-store.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  store = await import("./account-store.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

describe("account-store: config auto-accept kết bạn", () => {
  it("account mới: auto-accept TẮT, delay = 1 phút (mặc định)", () => {
    const a = store.createAccount({ id: "acc-def", label: "Nick" });
    assert.equal(a.autoAcceptFriends, false, "mặc định phải TẮT");
    assert.equal(a.autoAcceptFriendDelayMinutes, 1, "delay mặc định 1 phút");
  });

  it("updateAccount lưu đúng, getAccount đọc lại đúng (persist thật)", () => {
    store.createAccount({ id: "acc-upd", label: "Nick" });
    const updated = store.updateAccount("acc-upd", {
      autoAcceptFriends: true,
      autoAcceptFriendDelayMinutes: 5,
    });
    assert.equal(updated?.autoAcceptFriends, true);
    assert.equal(updated?.autoAcceptFriendDelayMinutes, 5);

    const got = store.getAccount("acc-upd");
    assert.equal(got?.autoAcceptFriends, true, "đọc lại từ DB phải khớp");
    assert.equal(got?.autoAcceptFriendDelayMinutes, 5);
  });

  it("tắt lại về false vẫn lưu đúng (không dính giá trị cũ)", () => {
    store.createAccount({ id: "acc-off", label: "Nick" });
    store.updateAccount("acc-off", { autoAcceptFriends: true });
    store.updateAccount("acc-off", { autoAcceptFriends: false });
    assert.equal(store.getAccount("acc-off")?.autoAcceptFriends, false);
  });
});
