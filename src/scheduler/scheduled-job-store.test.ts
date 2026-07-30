import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import type { ParsedSchedule } from "./schedule-parser.js";
// import type bị xóa lúc chạy nên không kéo module lên trước setupTestEnv
import type { CreateScheduledJobInput } from "./scheduled-job-store.js";

let dataDir: string;
let store: typeof import("./scheduled-job-store.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  store = await import("./scheduled-job-store.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

const ACC = "acc-1";
const ONCE: ParsedSchedule = { kind: "once", runAtUtc: "2026-08-01T08:00:00.000Z" };
const EVERY_30: ParsedSchedule = { kind: "every", minutes: 30 };

function taoJob(overrides: Partial<CreateScheduledJobInput> = {}) {
  return store.createJob({
    accountId: ACC,
    threadId: "t-1",
    threadType: 1,
    name: "nhắc test",
    kind: "message",
    payload: "noi dung nhac",
    schedule: EVERY_30,
    createdBy: "user-1",
    now: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  });
}

describe("createJob", () => {
  it("once: next_run_at = runAtUtc, max_runs mặc định 1", () => {
    const job = taoJob({ threadId: "t-once", schedule: ONCE });
    assert.equal(job.nextRunAt, "2026-08-01T08:00:00.000Z");
    assert.equal(job.maxRuns, 1);
    assert.equal(job.scheduleKind, "once");
    assert.equal(job.runAt, "2026-08-01T08:00:00.000Z");
    assert.equal(job.everyMinutes, null);
    assert.equal(job.enabled, true);
    assert.equal(job.runCount, 0);
  });

  it("every: next_run_at = now + interval, max_runs mặc định vô hạn (NULL)", () => {
    const job = taoJob({ threadId: "t-every" });
    assert.equal(job.nextRunAt, "2026-08-01T00:30:00.000Z");
    assert.equal(job.maxRuns, null);
    assert.equal(job.everyMinutes, 30);
    assert.equal(job.cronExpr, null);
  });

  it("id là hex 12 ký tự", () => {
    const job = taoJob({ threadId: "t-id" });
    assert.match(job.id, /^[0-9a-f]{12}$/);
  });
});

describe("getJob (có phạm vi) / getJobUnscoped / listJobsForThread", () => {
  it("getJob: id không tồn tại trả undefined", () => {
    assert.equal(store.getJob(ACC, "t-khong-ton-tai", "khong-ton-tai"), undefined);
  });

  it("getJob: đúng phạm vi thì đọc được, sai accountId hoặc threadId đều trả undefined dù id đúng - chặn IDOR", () => {
    const job = taoJob({ threadId: "t-scope-get" });
    assert.equal(store.getJob(ACC, "t-scope-get", job.id)?.id, job.id, "đúng phạm vi phải đọc được");
    assert.equal(store.getJob("acc-khac", "t-scope-get", job.id), undefined, "sai accountId phải bị từ chối");
    assert.equal(store.getJob(ACC, "t-thread-khac", job.id), undefined, "sai threadId phải bị từ chối");
  });

  it("getJobUnscoped: đọc được bất kể phạm vi - chỉ dùng nội bộ (vòng tick/markRun), không phơi cho tool/API", () => {
    const job = taoJob({ threadId: "t-scope-unscoped" });
    assert.equal(store.getJobUnscoped(job.id)?.id, job.id);
  });

  it("chỉ liệt kê job của đúng account+thread, không lẫn thread khác", () => {
    taoJob({ threadId: "t-list-a", name: "job A1" });
    taoJob({ threadId: "t-list-a", name: "job A2" });
    taoJob({ threadId: "t-list-b", name: "job B1" });

    const listA = store.listJobsForThread(ACC, "t-list-a");
    assert.equal(listA.length, 2);
    assert.ok(listA.every((j) => j.threadId === "t-list-a"));
  });
});

describe("updateJob", () => {
  it("id không tồn tại trả false", () => {
    assert.equal(store.updateJob(ACC, "t-nope", "khong-ton-tai", { name: "x" }), false);
  });

  it("sai accountId hoặc threadId thì trả false và KHÔNG sửa gì - chặn IDOR", () => {
    const job = taoJob({ threadId: "t-scope-update" });
    assert.equal(store.updateJob("acc-khac", "t-scope-update", job.id, { name: "bị đổi trái phép" }), false);
    assert.equal(store.updateJob(ACC, "t-thread-khac", job.id, { name: "bị đổi trái phép" }), false);
    assert.equal(store.getJobUnscoped(job.id)!.name, job.name, "tên gốc phải còn nguyên");
  });

  it("chỉ đổi name/payload thì next_run_at GIỮ NGUYÊN", () => {
    const job = taoJob({ threadId: "t-update-1" });
    const ok = store.updateJob(ACC, "t-update-1", job.id, { name: "tên mới", payload: "nội dung mới" });
    assert.equal(ok, true);

    const sau = store.getJob(ACC, "t-update-1", job.id)!;
    assert.equal(sau.name, "tên mới");
    assert.equal(sau.payload, "nội dung mới");
    assert.equal(sau.nextRunAt, job.nextRunAt, "đổi tên/payload không được nhảy mốc lịch");
    assert.equal(sau.maxRuns, job.maxRuns, "không đổi schedule thì maxRuns cũng giữ nguyên");
  });

  it("đổi schedule (giữ nguyên kind every) thì next_run_at được TÍNH LẠI, maxRuns giữ null", () => {
    const job = taoJob({ threadId: "t-update-2" });
    store.updateJob(ACC, "t-update-2", job.id, {
      schedule: { kind: "every", minutes: 45 },
      now: new Date("2026-08-01T00:00:00Z"),
    });

    const sau = store.getJob(ACC, "t-update-2", job.id)!;
    assert.equal(sau.everyMinutes, 45);
    assert.equal(sau.nextRunAt, "2026-08-01T00:45:00.000Z");
    assert.equal(sau.maxRuns, null);
  });

  it("đổi kind every -> once KHÔNG kèm maxRuns: tự tính lại maxRuns=1 theo kind mới, markRun tự tắt sau đúng 1 lần (chặn spam vô hạn)", () => {
    // Ca vỡ tìm thấy lúc review: every có maxRuns=null (vô hạn), đổi sang once
    // mà giữ nguyên null thì markRun không bao giờ thấy hitMax -> job "chạy 1
    // lần" không tự tắt -> next_run_at đứng yên ở mốc đã qua -> tick sau nhặt
    // lại NGAY -> bắn lại mỗi tick vô hạn.
    const job = taoJob({ threadId: "t-update-kind-change" });
    assert.equal(job.maxRuns, null);

    const ok = store.updateJob(ACC, "t-update-kind-change", job.id, {
      schedule: ONCE,
      now: new Date("2026-08-01T00:00:00Z"),
    });
    assert.equal(ok, true);

    const sau = store.getJob(ACC, "t-update-kind-change", job.id)!;
    assert.equal(sau.scheduleKind, "once");
    assert.equal(sau.maxRuns, 1, "phải tính lại theo kind mới, không giữ null của kind cũ");

    // Chứng minh hết-vòng-vòng-lặp thật: markRun 1 lần phải chạm max_runs và tự tắt
    store.markRun(job.id, "ok");
    const sauMark = store.getJob(ACC, "t-update-kind-change", job.id)!;
    assert.equal(sauMark.enabled, false, "phải tự tắt sau đúng 1 lần chạy, không lặp lại mỗi tick");
    assert.equal(sauMark.nextRunAt, null);
  });

  it("đổi schedule NHƯNG có truyền maxRuns tường minh thì dùng đúng giá trị đó, không bị tính lại đè lên", () => {
    const job = taoJob({ threadId: "t-update-explicit-maxruns" });
    store.updateJob(ACC, "t-update-explicit-maxruns", job.id, {
      schedule: ONCE,
      maxRuns: 5,
      now: new Date("2026-08-01T00:00:00Z"),
    });
    assert.equal(store.getJob(ACC, "t-update-explicit-maxruns", job.id)!.maxRuns, 5);
  });
});

describe("setEnabled / deleteJob", () => {
  it("setEnabled đổi cờ, trả false khi id lạ", () => {
    const job = taoJob({ threadId: "t-enable" });
    assert.equal(store.setEnabled(ACC, "t-enable", job.id, false), true);
    assert.equal(store.getJob(ACC, "t-enable", job.id)!.enabled, false);
    assert.equal(store.setEnabled(ACC, "t-enable", "khong-ton-tai", true), false);
  });

  it("setEnabled: sai phạm vi thì trả false và KHÔNG tắt job - chặn IDOR", () => {
    const job = taoJob({ threadId: "t-scope-setenabled" });
    assert.equal(store.setEnabled(ACC, "t-thread-khac", job.id, false), false);
    assert.equal(store.getJobUnscoped(job.id)!.enabled, true, "vẫn còn bật, không bị tắt trái phép");
  });

  it("deleteJob xoá hẳn row, gọi lần 2 trả false", () => {
    const job = taoJob({ threadId: "t-delete" });
    assert.equal(store.deleteJob(ACC, "t-delete", job.id), true);
    assert.equal(store.getJobUnscoped(job.id), undefined);
    assert.equal(store.deleteJob(ACC, "t-delete", job.id), false);
  });

  it("deleteJob: sai phạm vi thì trả false và job vẫn còn nguyên - chặn IDOR", () => {
    const job = taoJob({ threadId: "t-scope-delete" });
    assert.equal(store.deleteJob("acc-khac", "t-scope-delete", job.id), false);
    assert.notEqual(store.getJobUnscoped(job.id), undefined, "job phải còn nguyên");
  });
});

describe("listDueJobs", () => {
  it("chỉ trả job enabled=1 và next_run_at <= mốc truyền vào, sắp tăng dần", () => {
    const som = taoJob({
      threadId: "t-due",
      name: "due-som",
      schedule: ONCE,
      now: new Date("2026-08-01T00:00:00Z"),
    }); // next_run_at 08:00
    const muon = taoJob({
      threadId: "t-due",
      name: "due-muon",
      schedule: { kind: "once", runAtUtc: "2026-08-01T09:00:00.000Z" },
      now: new Date("2026-08-01T00:00:00Z"),
    });
    const chuaToiHan = taoJob({
      threadId: "t-due",
      name: "chua-toi-han",
      schedule: { kind: "once", runAtUtc: "2026-08-01T23:00:00.000Z" },
      now: new Date("2026-08-01T00:00:00Z"),
    });
    const daTat = taoJob({ threadId: "t-due", name: "da-tat", schedule: ONCE, now: new Date("2026-08-01T00:00:00Z") });
    store.setEnabled(ACC, "t-due", daTat.id, false);

    // listDueJobs KHÔNG lọc theo thread (đúng thiết kế - vòng tick quét toàn
    // cục), nên phải tự lọc về đúng thread của test này trước khi so thứ tự;
    // DB dùng chung cho cả file test, các describe khác cũng để lại job "every".
    const due = store.listDueJobs("2026-08-01T09:30:00.000Z").filter((j) => j.threadId === "t-due");
    const ids = due.map((j) => j.id);
    assert.deepEqual(ids, [som.id, muon.id], "sắp theo next_run_at tăng dần, bỏ job chưa tới hạn và job đã tắt");
    assert.ok(!ids.includes(chuaToiHan.id));
    assert.ok(!ids.includes(daTat.id));
  });
});

describe("setNextRun", () => {
  it("ghi mốc mới, và ghi NULL được (job hết lượt)", () => {
    const job = taoJob({ threadId: "t-setnext" });
    store.setNextRun(job.id, "2026-09-01T00:00:00.000Z");
    assert.equal(store.getJobUnscoped(job.id)!.nextRunAt, "2026-09-01T00:00:00.000Z");

    store.setNextRun(job.id, null);
    assert.equal(store.getJobUnscoped(job.id)!.nextRunAt, null);
  });
});

describe("markRun", () => {
  it("job vô hạn (every): tăng run_count, ghi last_status/last_error, KHÔNG tự tắt", () => {
    const job = taoJob({ threadId: "t-mark-every" });
    store.markRun(job.id, "ok");
    store.markRun(job.id, "error", "router chết");

    const sau = store.getJobUnscoped(job.id)!;
    assert.equal(sau.runCount, 2);
    assert.equal(sau.lastStatus, "error");
    assert.equal(sau.lastError, "router chết");
    assert.equal(sau.enabled, true);
    assert.notEqual(sau.lastRunAt, null);
  });

  it("job once (max_runs=1): chạm trần thì tự tắt + next_run_at=NULL nhưng GIỮ NGUYÊN row", () => {
    const job = taoJob({ threadId: "t-mark-once", schedule: ONCE });
    store.markRun(job.id, "ok");

    const sau = store.getJobUnscoped(job.id)!;
    assert.equal(sau.runCount, 1);
    assert.equal(sau.enabled, false, "chạm max_runs phải tự tắt");
    assert.equal(sau.nextRunAt, null, "không còn lượt kế tiếp");
    assert.equal(sau.lastStatus, "ok");
    // Row vẫn còn - khác Hermes/goclaw xoá hẳn, để dashboard còn hiện "đã nhắc xong"
    assert.notEqual(store.getJobUnscoped(job.id), undefined);
  });

  it("id không tồn tại: no-op, không throw", () => {
    assert.doesNotThrow(() => store.markRun("khong-ton-tai", "ok"));
  });
});

describe("scheduleOf", () => {
  it("dựng lại đúng ParsedSchedule cho từng kind", () => {
    const onceJob = taoJob({ threadId: "t-schedule-once", schedule: ONCE });
    assert.deepEqual(store.scheduleOf(store.getJobUnscoped(onceJob.id)!, "UTC"), ONCE);

    const everyJob = taoJob({ threadId: "t-schedule-every" });
    assert.deepEqual(store.scheduleOf(store.getJobUnscoped(everyJob.id)!, "UTC"), EVERY_30);
  });

  it("cron: timezone rỗng trên row rơi về defaultTimeZone do caller truyền vào", () => {
    const job = taoJob({
      threadId: "t-schedule-cron",
      schedule: { kind: "cron", expr: "0 7 * * *", timeZone: "Asia/Ho_Chi_Minh" },
      timezone: "", // job "trôi" theo cấu hình hiện tại thay vì pin cứng
    });
    const schedule = store.scheduleOf(store.getJobUnscoped(job.id)!, "Europe/Paris");
    assert.deepEqual(schedule, { kind: "cron", expr: "0 7 * * *", timeZone: "Europe/Paris" });
  });

  it("cron: timezone đã pin trên row thì giữ nguyên, không rơi về default", () => {
    const job = taoJob({
      threadId: "t-schedule-cron-pinned",
      schedule: { kind: "cron", expr: "0 7 * * *", timeZone: "Asia/Ho_Chi_Minh" },
      timezone: "Asia/Ho_Chi_Minh",
    });
    const schedule = store.scheduleOf(store.getJobUnscoped(job.id)!, "Europe/Paris");
    assert.deepEqual(schedule, { kind: "cron", expr: "0 7 * * *", timeZone: "Asia/Ho_Chi_Minh" });
  });
});
