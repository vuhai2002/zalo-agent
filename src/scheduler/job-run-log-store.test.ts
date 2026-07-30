import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let runLog: typeof import("./job-run-log-store.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  runLog = await import("./job-run-log-store.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

// scheduled_job_runs không có FOREIGN KEY sang scheduled_jobs (2 bảng tách rời
// theo thiết kế) nên test dùng thẳng jobId giả, không cần dựng job thật trước.

describe("openRun / finishRun", () => {
  it("mở lượt mới ở trạng thái running, id tăng dần", () => {
    const id1 = runLog.openRun("job-a");
    const id2 = runLog.openRun("job-a");
    assert.ok(id2 > id1);

    const [ganNhat] = runLog.listRuns("job-a", 1);
    assert.equal(ganNhat!.id, id2);
    assert.equal(ganNhat!.status, "running");
    assert.equal(ganNhat!.finishedAt, null);
  });

  it("chốt lượt ghi đủ status/detail/deliveredChars/turnId/finishedAt", () => {
    const id = runLog.openRun("job-b");
    runLog.finishRun(id, { status: "ok", detail: "gửi xong", deliveredChars: 42, turnId: 999 });

    const [run] = runLog.listRuns("job-b", 1);
    assert.equal(run!.status, "ok");
    assert.equal(run!.detail, "gửi xong");
    assert.equal(run!.deliveredChars, 42);
    assert.equal(run!.turnId, 999);
    assert.notEqual(run!.finishedAt, null);
  });

  it("chốt lượt không truyền gì vẫn có giá trị mặc định hợp lý", () => {
    const id = runLog.openRun("job-c");
    runLog.finishRun(id, { status: "skipped" });

    const [run] = runLog.listRuns("job-c", 1);
    assert.equal(run!.status, "skipped");
    assert.equal(run!.detail, "");
    assert.equal(run!.deliveredChars, 0);
    assert.equal(run!.turnId, null);
  });
});

describe("listRuns", () => {
  it("mới nhất đứng trước, chỉ của đúng job, tôn trọng limit", () => {
    for (let i = 0; i < 5; i++) runLog.openRun("job-list");
    runLog.openRun("job-khac");

    const top2 = runLog.listRuns("job-list", 2);
    assert.equal(top2.length, 2);
    assert.ok(top2[0]!.id > top2[1]!.id, "mới nhất (id lớn nhất) phải đứng đầu");
    assert.ok(top2.every((r) => r.jobId === "job-list"));
  });

  it("job chưa có lượt nào trả mảng rỗng", () => {
    assert.deepEqual(runLog.listRuns("job-trong"), []);
  });
});

describe("dọn theo KEEP", () => {
  it("chỉ giữ KEEP lượt gần nhất mỗi job, không đụng job khác", () => {
    const idsOfA: number[] = [];
    for (let i = 0; i < 7; i++) idsOfA.push(runLog.openRun("job-keep-a", 3));
    runLog.openRun("job-keep-b", 3); // job khác, ngưỡng riêng, không bị ảnh hưởng

    const con = runLog.listRuns("job-keep-a", 100);
    assert.equal(con.length, 3, "chỉ còn 3 lượt gần nhất");
    // 3 lượt còn lại phải đúng là 3 id MỚI NHẤT vừa mở
    assert.deepEqual(
      con.map((r) => r.id).sort((a, b) => a - b),
      idsOfA.slice(-3).sort((a, b) => a - b),
    );

    assert.equal(runLog.listRuns("job-keep-b", 100).length, 1);
  });
});
