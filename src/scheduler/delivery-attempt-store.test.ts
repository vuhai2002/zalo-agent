import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
// import type bị xóa lúc chạy nên không kéo module lên trước setupTestEnv
import type { CreateScheduledJobInput } from "./scheduled-job-store.js";

let dataDir: string;
let store: typeof import("./delivery-attempt-store.js");
let jobStore: typeof import("./scheduled-job-store.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  store = await import("./delivery-attempt-store.js");
  jobStore = await import("./scheduled-job-store.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

function taoJob(overrides: Partial<CreateScheduledJobInput> = {}) {
  return jobStore.createJob({
    accountId: "acc-1",
    threadId: "t-1",
    threadType: 1,
    name: "job test",
    kind: "message",
    payload: "nội dung",
    schedule: { kind: "once", runAtUtc: "2026-08-01T08:00:00.000Z" },
    createdBy: "user-1",
    now: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  });
}

describe("incrementDeliveryAttempts", () => {
  it("job mới tạo: delivery_attempts ngầm định 0, tăng lần đầu ra 1", () => {
    const job = taoJob({ threadId: "t-tang-lan-dau" });
    assert.equal(store.incrementDeliveryAttempts(job.id), 1);
  });

  it("tăng nhiều lần cộng dồn đúng", () => {
    const job = taoJob({ threadId: "t-tang-nhieu-lan" });
    assert.equal(store.incrementDeliveryAttempts(job.id), 1);
    assert.equal(store.incrementDeliveryAttempts(job.id), 2);
    assert.equal(store.incrementDeliveryAttempts(job.id), 3);
  });

  it("job không tồn tại: UPDATE no-op, trả về 0 (không ném lỗi)", () => {
    assert.equal(store.incrementDeliveryAttempts("khong-ton-tai"), 0);
  });
});

describe("resetDeliveryAttempts", () => {
  it("đưa về 0 sau khi đã tăng vài lần", () => {
    const job = taoJob({ threadId: "t-reset" });
    store.incrementDeliveryAttempts(job.id);
    store.incrementDeliveryAttempts(job.id);
    store.resetDeliveryAttempts(job.id);
    assert.equal(store.incrementDeliveryAttempts(job.id), 1, "sau reset, tăng lần kế phải ra lại 1");
  });
});

describe("MAX_DELIVERY_ATTEMPTS", () => {
  it("là 3 - đúng quyết định 'thử tối đa 3 lần' của thiết kế", () => {
    assert.equal(store.MAX_DELIVERY_ATTEMPTS, 3);
  });
});
