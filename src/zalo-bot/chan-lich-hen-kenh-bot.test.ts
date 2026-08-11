import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Hono } from "hono";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Lịch hẹn trên tài khoản bot bị chặn ở BA chỗ, vì có ba đường vào.
 *
 * Tool `schedule_task` đã bị `nang-luc-kenh-bot.ts` chặn, nhưng dashboard là
 * ĐƯỜNG VÒNG tạo được job y hệt - đúng lớp lỗi mà rà soát theo-mảnh không
 * thấy, vì không mảnh nào sở hữu đường đó.
 *
 * Hậu quả nếu không chặn: `run-scheduled-job` lấy `getRunningAccountApi` (trả
 * undefined vì api null) rồi `concludeBlockedNotRun`, mà hàm đó PHỤC HỒI
 * `next_run_at` cho job `once` - job quay lại mỗi tick, vĩnh viễn, kèm lý do
 * sai sự thật "Account hiện không chạy" trong khi account ĐANG chạy.
 */
let dataDir: string;
let app: Hono;
let cookie: string;
let accounts: typeof import("../config/account-store.js");
let threads: typeof import("../conversation/thread-store.js");
let database: typeof import("../conversation/database.js");

const PASSWORD = "mat-khau-chan-lich-123";

before(async () => {
  dataDir = setupTestEnv({ DASHBOARD_PASSWORD: PASSWORD });
  const { buildDashboardApp } = await import("../server/dashboard-server.js");
  app = buildDashboardApp();
  accounts = await import("../config/account-store.js");
  threads = await import("../conversation/thread-store.js");
  database = await import("../conversation/database.js");

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
  for (const t of ["scheduled_jobs", "scheduled_job_runs", "threads", "accounts"]) {
    database.db.exec(`DELETE FROM ${t}`);
  }
});

function dungAccount(id: string, loai: "ca_nhan" | "bot") {
  accounts.createAccount({ id, label: id });
  if (loai === "bot") accounts.datLoaiKenh(id, "bot");
  // Thread phải có thật, không thì route chặn ở bước khác và ca này đo nhầm
  threads.recordThreadActivity({
    accountId: id,
    threadId: "t1",
    threadType: 0,
    displayName: "Người thử",
    lastSenderName: "Người thử",
  });
}

const taoLich = (accountId: string) =>
  app.request("/api/schedule", {
    method: "POST",
    body: JSON.stringify({
      accountId,
      threadId: "t1",
      threadType: 0,
      name: "Nhắc uống nước",
      kind: "message",
      payload: "nhắc uống nước",
      schedule: { kind: "every", minutes: 30 },
    }),
    headers: { cookie, "content-type": "application/json" },
  });

describe("chặn lịch hẹn trên tài khoản bot", () => {
  it("dashboard KHÔNG tạo được lịch cho tài khoản bot", async () => {
    dungAccount("acc-bot", "bot");
    const res = await taoLich("acc-bot");
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error?: string }).error ?? "", /bộ hẹn lịch/);
  });

  it("tài khoản CÁ NHÂN vẫn tạo được - không chặn nhầm", async () => {
    // Chốt chống "sửa cho bot làm hỏng luôn tính năng đang chạy".
    dungAccount("acc-thuong", "ca_nhan");
    const res = await taoLich("acc-thuong");
    assert.equal(res.status, 201, `tài khoản cá nhân bị chặn nhầm: ${await res.text()}`);
  });

  it("job CŨ của tài khoản bot bị TẮT HẲN, không quay lại mỗi tick", async () => {
    // Job kiểu này tồn tại nếu được tạo TRƯỚC khi có phép chặn ở route, hoặc
    // nếu ai đó đổi loại tài khoản. Để `concludeBlockedNotRun` xử lý thì nó
    // PHỤC HỒI `next_run_at` cho job `once` và job quay mãi mãi, mỗi lần một
    // dòng 'skipped' với lý do sai sự thật.
    //
    // Dựng job thẳng qua store chứ không qua route: route nay đã chặn, mà thứ
    // ca này đo là hành vi của `run-scheduled-job`, không phải của route.
    dungAccount("acc-bot", "bot");
    const store = await import("../scheduler/scheduled-job-store.js");
    const runner = await import("../scheduler/run-scheduled-job.js");

    const job = store.createJob({
      accountId: "acc-bot",
      threadId: "t1",
      threadType: 0,
      name: "Nhắc cũ",
      kind: "message",
      payload: "nhắc uống nước",
      schedule: { kind: "once", runAtUtc: new Date(Date.now() + 60_000).toISOString() },
      createdBy: "test",
    });
    assert.ok(job.nextRunAt, "job vừa tạo phải có hẹn giờ - không thì ca này đo rỗng");

    await runner.runScheduledJob(job, {
      scheduledFor: job.nextRunAt!,
      now: new Date(),
      late: false,
    });

    assert.equal(
      store.getJobUnscoped(job.id)?.nextRunAt ?? null,
      null,
      "job của tài khoản bot vẫn còn hẹn giờ - sẽ bị dispatch lại mỗi tick, vĩnh viễn",
    );
  });
});
