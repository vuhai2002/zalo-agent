import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import type { API } from "zca-js";
import type { AccountConfig } from "../config/account-store.js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
// import type bị xóa lúc chạy nên không kéo module lên trước setupTestEnv
import type { CreateScheduledJobInput } from "./scheduled-job-store.js";

/**
 * Test tích hợp cho vòng tick: dùng THẬT account-manager + DB, chỉ giả
 * `api.sendMessage`. Không test lại phần "gửi/guard/im lặng" (đã có ở
 * run-scheduled-job.test.ts) - trọng tâm ở đây là ĐÚNG NHỊP: clear-before-dispatch,
 * không await trong tick, skip-forward, phục hồi lúc boot.
 *
 * CẢNH BÁO AN TOÀN: `api.sendMessage` LUÔN LÀ HÀM GIẢ - không chạm api thật.
 */

let dataDir: string;
let schedulerLoop: typeof import("./scheduler-loop.js");
let accountManager: typeof import("../zalo/account-manager.js");
let accountStore: typeof import("../config/account-store.js");
let threadStore: typeof import("../conversation/thread-store.js");
let jobStore: typeof import("./scheduled-job-store.js");
let runLogStore: typeof import("./job-run-log-store.js");
let tuning: typeof import("../config/runtime-tuning-settings.js");
let database: typeof import("../conversation/database.js");

const ACC = "acc-scheduler-loop";

before(async () => {
  // SCHEDULER_TICK_MS có sàn cứng 5000ms (Zod) - không hạ được để "chờ tick kế
  // thật xảy ra" trong test. Test tick lặp lại vì vậy gọi runSchedulerTick()
  // trực tiếp thay vì chờ setInterval thật (xem nhóm mô tả bên dưới).
  // Gap gửi = 0 để không phải chờ nhịp rải đều thật. Grace 'once' hạ còn 1
  // phút để test "run-late" không cần trễ hàng chục phút mới vượt ngưỡng.
  dataDir = setupTestEnv({ SCHEDULER_TICK_MS: "5000", SCHEDULER_SEND_GAP_MS: "0", SCHEDULER_ONCE_GRACE_MINUTES: "1" });
  schedulerLoop = await import("./scheduler-loop.js");
  accountManager = await import("../zalo/account-manager.js");
  accountStore = await import("../config/account-store.js");
  threadStore = await import("../conversation/thread-store.js");
  jobStore = await import("./scheduled-job-store.js");
  runLogStore = await import("./job-run-log-store.js");
  tuning = await import("../config/runtime-tuning-settings.js");
  database = await import("../conversation/database.js");

  accountStore.createAccount({ id: ACC, label: "Test" });
});

// Mỗi test tự start/stop - dọn sạch giữa các ca để không rò rỉ timer/cấu hình sang test sau
afterEach(() => {
  schedulerLoop.stopScheduler();
  tuning.setTuning("SCHEDULER_ENABLED", null);
});

after(() => {
  accountManager.stopAllAccounts();
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** "Online" hoá ACC - sendMessageImpl nhận (msg, threadId) để phân biệt hành vi theo thread nếu cần */
function attachOnline(
  sendMessageImpl?: (msg: string, threadId: string) => unknown,
): { threadId: string; text: string }[] {
  const sent: { threadId: string; text: string }[] = [];
  const config: AccountConfig = {
    id: ACC,
    label: "Test",
    enabled: true,
    agentId: "khong-quan-tam",
    allowlist: { mode: "all", userIds: [] },
    groupRequireMention: true,
    respondToGroups: true,
    groupPassiveListen: true,
    autoReactEnabled: false,
    autoReactIcon: "heart",
    typingIndicatorEnabled: false,
    disabledTools: [],
  };
  const api = {
    getOwnId: () => "self-1",
    listener: { on: () => {}, onConnected: () => {}, onError: () => {}, onClosed: () => {}, start: () => {}, stop: () => {} },
    sendMessage: async (payload: { msg: string }, threadId: string) => {
      sent.push({ threadId, text: payload.msg });
      if (sendMessageImpl) return sendMessageImpl(payload.msg, threadId);
      return { msgId: `m-${sent.length}` };
    },
  } as unknown as API;
  accountManager.attachAccount(config, api);
  return sent;
}

function makeThread(threadId: string): void {
  threadStore.recordThreadActivity({
    accountId: ACC,
    threadId,
    threadType: 0,
    displayName: "",
    lastSenderName: "",
  });
}

function makeJob(overrides: Partial<CreateScheduledJobInput> & { threadId: string }) {
  return jobStore.createJob({
    accountId: ACC,
    threadType: 0,
    name: "job test",
    kind: "message",
    payload: "noi dung",
    schedule: { kind: "once", runAtUtc: new Date(Date.now() - 5000).toISOString() },
    createdBy: "user-1",
    ...overrides,
  });
}

function lastRunOf(jobId: string) {
  return runLogStore.listRuns(jobId, 1)[0];
}

describe("startScheduler - SCHEDULER_ENABLED", () => {
  it("=false thì không đăng ký gì - job đã đến hạn không bao giờ được xử lý", async () => {
    tuning.setTuning("SCHEDULER_ENABLED", false);
    const sent = attachOnline();
    const threadId = "t-tat-scheduler";
    makeThread(threadId);
    const job = makeJob({ threadId });

    schedulerLoop.startScheduler();
    await sleep(180); // hơn 3 chu kỳ tick (50ms) nếu lỡ vẫn chạy

    assert.equal(sent.length, 0);
    assert.equal(runLogStore.listRuns(job.id).length, 0, "không được có run nào - tick chưa từng chạy");

    // Dọn job: nó vẫn "due" và enabled=1 (đúng ý test - CHƯA từng bị nhặt).
    // Không xoá thì nó mồ côi lại trong DB, và tick THẬT của các test SAU (khi
    // SCHEDULER_ENABLED trở lại true) sẽ nhặt nhầm job của test này.
    jobStore.deleteJob(ACC, threadId, job.id);
  });

  it("tắt GIỮA CHỪNG (sau khi đã startScheduler) vẫn có tác dụng ngay - đọc lại mỗi tick, không chỉ lúc start", async () => {
    // Đây là khoảng hở suýt lọt: SCHEDULER_ENABLED là tham số chỉnh-nóng
    // (getTuning đọc lại MỖI LẦN gọi theo triết lý chung của dự án), nhưng nếu
    // scheduler-loop chỉ kiểm cờ này lúc startScheduler() thì tắt trên
    // dashboard trong lúc bot đang chạy sẽ KHÔNG có tác dụng gì - interval đã
    // đăng ký cứ thế chạy tiếp. Một công tắc an toàn không tắt được là vô nghĩa.
    const sent = attachOnline();
    schedulerLoop.startScheduler(); // lúc này SCHEDULER_ENABLED vẫn true (mặc định)

    tuning.setTuning("SCHEDULER_ENABLED", false); // tắt GIỮA CHỪNG, scheduler vẫn đang "chạy"

    const threadId = "t-tat-giua-chung";
    makeThread(threadId);
    const job = makeJob({ threadId }); // due ngay

    // Gọi tick trực tiếp (mô phỏng interval sắp tới) thay vì chờ 5s thật
    await schedulerLoop.runSchedulerTick(new Date());

    assert.equal(sent.length, 0, "tick phải tự bỏ qua khi cờ đã tắt, dù interval vẫn đang đăng ký");
    assert.equal(runLogStore.listRuns(job.id).length, 0);

    jobStore.deleteJob(ACC, threadId, job.id);
  });
});

describe("startScheduler - phục hồi lúc boot", () => {
  it("run còn status='running' (process cũ bị giết giữa chừng) được đánh dấu 'interrupted'", () => {
    const threadId = "t-boot-interrupt";
    makeThread(threadId);
    const job = makeJob({ threadId, schedule: { kind: "once", runAtUtc: "2099-01-01T00:00:00.000Z" } });
    runLogStore.openRun(job.id); // mở nhưng KHÔNG finishRun - mô phỏng process bị kill giữa chừng

    schedulerLoop.startScheduler();

    const run = lastRunOf(job.id)!;
    assert.equal(run.status, "interrupted");
  });
});

describe("startScheduler - nhịp tick", () => {
  it("xử lý NGAY job đã đến hạn lúc boot, không đợi hết SCHEDULER_TICK_MS đầu tiên", async () => {
    const sent = attachOnline();
    const threadId = "t-boot-ngay";
    makeThread(threadId);
    makeJob({ threadId }); // mặc định due 5s trước - đã quá hạn ngay từ đầu

    schedulerLoop.startScheduler();
    await sleep(40); // ngắn hơn NHIỀU so với SCHEDULER_TICK_MS=5000 - chỉ tick "lúc boot" mới kịp chạy

    assert.equal(sent.length, 1, "phải gửi ngay, không chờ chu kỳ tick đầu tiên");
  });
});

describe("stopScheduler", () => {
  it("reset trạng thái để startScheduler() sau đó khởi động lại được - không bị khoá bởi guard 'đã chạy rồi'", async () => {
    const sent = attachOnline();
    schedulerLoop.startScheduler();
    schedulerLoop.stopScheduler();

    const threadId = "t-restart-sau-stop";
    makeThread(threadId);
    makeJob({ threadId }); // due ngay, nhưng tạo SAU khi đã stop nên tick "lúc boot" đầu tiên không thấy

    // Nếu stopScheduler() KHÔNG reset biến timer nội bộ, lần start() thứ 2 này
    // sẽ bị chặn ngay ở guard "if (timer) return" -> tick "lúc boot" không
    // chạy lại -> sent.length vẫn là 0. Chạy được nghĩa là state đã sạch.
    schedulerLoop.startScheduler();
    await sleep(40);

    assert.equal(sent.length, 1, "start lại sau khi stop phải chạy tick ngay như một lần boot mới");
  });
});

describe("runSchedulerTick - không bị chặn bởi job chạy lâu", () => {
  it("tick tự trả về nhanh dù vừa dispatch job chậm, và tick GỌI NGAY SAU đó cũng không bị 'dính' theo", async () => {
    // Lưu ý: hàng đợi rải đều (enqueueProactiveSend) là TOÀN CỤC theo THIẾT KẾ
    // (mục 8) - 2 tin ở 2 thread khác nhau vẫn cách nhau SCHEDULER_SEND_GAP_MS,
    // nên job chậm ở thread khác HOÀN TOÀN CÓ THỂ làm job khác phải chờ theo
    // (đúng ý "rải đều", không phải bug). Cái brief yêu cầu kiểm ở đây là
    // VÒNG TICK không bị chặn - tức bản thân runSchedulerTick() phải trả về
    // ngay, không phải chuyện 2 job độc lập tốc độ nhau.
    const threadCham = "t-cham";
    makeThread(threadCham);
    attachOnline((_msg) => sleep(250).then(() => ({ msgId: "cham" })));
    const jobCham = makeJob({ threadId: threadCham, payload: "viec cham" });

    const t0 = Date.now();
    await schedulerLoop.runSchedulerTick(new Date());
    const dt1 = Date.now() - t0;
    assert.ok(dt1 < 100, `tick lần 1 phải trả về nhanh dù vừa dispatch 1 job chậm (đo được ${dt1}ms)`);

    // Job chậm còn dở (250ms chưa qua) - gọi THÊM 1 tick nữa NGAY LẬP TỨC: tick
    // này cũng phải trả về nhanh, không bị "dính" chờ theo job đang chạy dở
    // của tick trước - đúng nghĩa "tick kế vẫn chạy" brief yêu cầu.
    const t1 = Date.now();
    await schedulerLoop.runSchedulerTick(new Date());
    const dt2 = Date.now() - t1;
    assert.ok(dt2 < 100, `tick lần 2 (gọi ngay sau tick 1) cũng phải trả về nhanh (đo được ${dt2}ms)`);

    assert.notEqual(lastRunOf(jobCham.id)?.status, "ok", "job chậm phải CHƯA xong ngay sau 2 lần gọi tick liên tiếp");

    // Cuối cùng job chậm vẫn phải hoàn thành, không bị rơi mất
    await sleep(350);
    assert.equal(lastRunOf(jobCham.id)?.status, "ok");
  });
});

describe("clear-before-dispatch", () => {
  it("job 'once' được clear next_run_at về NULL ngay khi dispatch - gọi tick() lần 2 ngay sau đó không nhặt lại", async () => {
    const threadId = "t-clear-once";
    makeThread(threadId);
    attachOnline((_msg) => sleep(200).then(() => ({ msgId: "x" })));
    const job = makeJob({ threadId });

    await schedulerLoop.runSchedulerTick(new Date());
    // Lượt vừa dispatch còn đang "chạy dở" (sendMessage giả mất 200ms) nhưng
    // next_run_at đã phải là NULL NGAY - đây chính là ý nghĩa của clear-before-dispatch.
    assert.equal(jobStore.getJobUnscoped(job.id)!.nextRunAt, null);

    // Gọi tick() thêm 1 lần liền tay: KHÔNG được nhặt lại job này lần 2
    await schedulerLoop.runSchedulerTick(new Date());
    await sleep(300);

    assert.equal(runLogStore.listRuns(job.id).length, 1, "chỉ đúng 1 lần chạy dù gọi tick() 2 lần liên tiếp");
  });
});

describe("skip-forward", () => {
  it("every trễ quá cửa sổ grace: bỏ lượt (không gửi gì), ghi run 'skipped', next_run_at nhảy tới TƯƠNG LAI", async () => {
    const sent = attachOnline();
    const threadId = "t-skip-forward";
    makeThread(threadId);
    // every 30 phút -> grace = nửa chu kỳ = 900s = 15 phút. Đặt next_run_at trễ 2000 giây (> 900s)
    const job = makeJob({
      threadId,
      schedule: { kind: "every", minutes: 30 },
      now: new Date(Date.now() - 2000_000), // giá trị now lúc TẠO không quan trọng, sẽ ép next_run_at ngay dưới
    });
    const now = new Date();
    jobStore.setNextRun(job.id, new Date(now.getTime() - 2000 * 1000).toISOString());

    await schedulerLoop.runSchedulerTick(now);

    assert.equal(sent.length, 0, "skip-forward không được gửi gì");
    const run = lastRunOf(job.id)!;
    assert.equal(run.status, "skipped");
    assert.match(run.detail, /grace/);

    const updated = jobStore.getJobUnscoped(job.id)!;
    assert.ok(
      new Date(updated.nextRunAt!).getTime() > now.getTime(),
      "next_run_at phải nhảy tới tương lai, không đứng yên ở mốc đã trễ",
    );
  });
});

describe("run-late", () => {
  it("once trễ quá grace: vẫn dispatch (không phải skip-forward), text gửi đi có tiền tố '(nhắc trễ, lịch gốc HH:MM)'", async () => {
    const sent = attachOnline();
    const threadId = "t-run-late";
    makeThread(threadId);
    // 08:00Z = 15:00 giờ VN; trễ 5 phút so với "now" giả định 08:05Z, vượt grace 1 phút (test override)
    const job = makeJob({ threadId, payload: "Nho hop", schedule: { kind: "once", runAtUtc: "2026-08-01T08:00:00.000Z" } });
    const now = new Date("2026-08-01T08:05:00.000Z");

    await schedulerLoop.runSchedulerTick(now);
    await sleep(40);

    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.text, "(nhắc trễ, lịch gốc 15:00) Nho hop");
    assert.equal(lastRunOf(job.id)?.status, "ok");
  });
});
