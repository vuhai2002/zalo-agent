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

// Mỗi test tự start/stop - dọn sạch giữa các ca để không rò rỉ timer/cấu hình sang test sau.
// Đặt ở afterEach (không phải cuối thân test) để dọn CHẮC CHẮN chạy dù assert
// phía trên có ném lỗi giữa chừng hay không - để trong thân test thì 1 lần
// assert đỏ sẽ làm dòng dọn KHÔNG BAO GIỜ chạy, rò cấu hình sang mọi test sau.
afterEach(() => {
  schedulerLoop.stopScheduler();
  tuning.setTuning("SCHEDULER_ENABLED", null);
  tuning.setTuning("SCHEDULER_MAX_PROACTIVE_PER_DAY", null);
  tuning.setTuning("SCHEDULER_SEND_GAP_MS", null);
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
    payload: "nội dung",
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

    jobStore.deleteJob(ACC, threadId, job.id);
  });

  it("lời nhắc 'once' bị GIÀNH (next_run_at=NULL bởi clear-before-dispatch) nhưng process bị giết trước khi markRun: next_run_at được phục hồi về run_at (I2)", () => {
    const threadId = "t-boot-revive-claimed-once";
    makeThread(threadId);
    // Mốc gốc ở tương lai xa để job KHÔNG bị tick "chạy ngay lúc boot" nhặt lại
    // trong chính test này - chỉ cần kiểm việc phục hồi next_run_at, không cần
    // chờ nó gửi.
    const runAt = new Date(Date.now() + 3_600_000).toISOString();
    const job = makeJob({ threadId, schedule: { kind: "once", runAtUtc: runAt } });
    // Mô phỏng đúng cửa sổ vỡ: tick THẬT đã clear-before-dispatch (next_run_at
    // = NULL) rồi process bị kill TRƯỚC khi kịp markRun - job chưa hề chạy
    // (run_count vẫn 0, enabled vẫn 1).
    jobStore.setNextRun(job.id, null);

    schedulerLoop.startScheduler();

    const after = jobStore.getJobUnscoped(job.id)!;
    assert.equal(after.nextRunAt, runAt, "next_run_at phải được phục hồi về run_at (mốc gốc) - không thì lời nhắc mất vĩnh viễn");
    assert.equal(after.runCount, 0, "job chưa hề chạy - phục hồi không được đụng run_count");

    jobStore.deleteJob(ACC, threadId, job.id);
  });

  it("job 'once' ĐÃ chạy xong (hitMax -> enabled=0) thì KHÔNG bị hồi sinh dù next_run_at đang NULL (I2)", () => {
    const threadId = "t-boot-no-revive-done";
    makeThread(threadId);
    const runAt = new Date(Date.now() + 3_600_000).toISOString();
    const job = makeJob({ threadId, schedule: { kind: "once", runAtUtc: runAt } });
    // Job ĐÃ chạy thật xong (không phải bị giành dở) - markRun tự đặt
    // enabled=0, next_run_at=null vì 'once' luôn maxRuns=1.
    jobStore.markRun(job.id, "ok");

    schedulerLoop.startScheduler();

    const after = jobStore.getJobUnscoped(job.id)!;
    assert.equal(after.nextRunAt, null, "job đã chạy xong thì next_run_at phải VẪN là null - không được hồi sinh job đã hoàn thành");
    assert.equal(after.enabled, false);

    jobStore.deleteJob(ACC, threadId, job.id);
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
    const jobCham = makeJob({ threadId: threadCham, payload: "việc chậm" });

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

describe("preflight - account/thread chưa sẵn sàng (Finding 1)", () => {
  it("account KHÔNG chạy: job VẪN CÒN SỐNG sau tick (enabled=1, next_run_at KHÔNG bị xoá, KHÔNG có run log) - tick sau account online lại thì gửi được", async () => {
    // Ca hoàn toàn bình thường của zca-js: account rớt phiên đúng lúc job đến
    // hạn. Trước fix: clear-before-dispatch + markRun('skipped') vẫn chạy ->
    // job once mất next_run_at + run_count chạm max -> chết vĩnh viễn.
    accountManager.stopAccount(ACC); // đảm bảo THẬT SỰ offline, không phụ thuộc thứ tự test khác
    const threadId = "t-account-offline";
    makeThread(threadId);
    const job = makeJob({ threadId, payload: "nhớ họp trực tuyến" });
    const originalNextRunAt = job.nextRunAt;

    await schedulerLoop.runSchedulerTick(new Date());

    const afterOffline = jobStore.getJobUnscoped(job.id)!;
    assert.equal(afterOffline.enabled, true, "job KHÔNG được tự tắt");
    assert.equal(afterOffline.nextRunAt, originalNextRunAt, "next_run_at KHÔNG được đụng vào");
    assert.equal(afterOffline.runCount, 0, "run_count KHÔNG được tăng - job chưa từng chạy thật sự");
    assert.equal(runLogStore.listRuns(job.id).length, 0, "không ghi run nào - chưa hề dispatch");
    // Mục 5: dù KHÔNG có run log nào, lý do chặn vẫn phải THẤY ĐƯỢC ngay trên
    // chính row job - trước fix, account rớt phiên nhiều ngày liền làm job
    // hiện y hệt job khoẻ mạnh trên dashboard (return trước cả openRun).
    assert.equal(afterOffline.lastStatus, "blocked", "phải thấy được trên dashboard dù chưa có run log nào");
    assert.match(afterOffline.lastError ?? "", /không chạy/);

    // Account online lại - tick SAU đó phải nhặt lại và gửi được bình thường
    const sent = attachOnline();
    await schedulerLoop.runSchedulerTick(new Date());
    await sleep(40);

    assert.equal(sent.length, 1, "job phải gửi được ở tick kế tiếp sau khi account online lại");
    assert.equal(lastRunOf(job.id)?.status, "ok");
    // Dấu "blocked" tự lành khi job chạy thật lần kế - markRun ghi đè last_status vô điều kiện
    assert.equal(jobStore.getJobUnscoped(job.id)!.lastStatus, "ok");
  });

  it("thread bot_enabled=0: job VẪN CÒN SỐNG sau tick, không markRun - đúng bất biến như ca account offline", async () => {
    attachOnline();
    const threadId = "t-bot-tat-tick";
    makeThread(threadId);
    threadStore.setBotEnabled(ACC, threadId, false);
    const job = makeJob({ threadId });

    await schedulerLoop.runSchedulerTick(new Date());

    const after = jobStore.getJobUnscoped(job.id)!;
    assert.equal(after.enabled, true);
    assert.equal(after.nextRunAt, job.nextRunAt);
    assert.equal(after.runCount, 0);
    assert.equal(runLogStore.listRuns(job.id).length, 0);
  });

  it("job bị chặn NGAY Ở TICK (account offline) phải RESET delivery_attempts - đây là đường PHỔ BIẾN nhất trong sản xuất (Mục 1, vòng 4)", async () => {
    const attemptStore = await import("./delivery-attempt-store.js");
    accountManager.stopAccount(ACC);
    const threadId = "t-tick-block-reset-delivery-attempts";
    makeThread(threadId);
    const job = makeJob({ threadId });

    // Mô phỏng 2 lần gửi hỏng RẢI RÁC ở các lượt TRƯỚC (vd tuần trước) - việc
    // bị chặn ở TICK lần này (account offline, không hề chạm sendAndConclude)
    // không được cộng dồn với chúng. Thiếu reset này: gửi hỏng 1 lần -> account
    // offline vài ngày (chặn ở đúng nhánh này) -> gửi hỏng lần 2, lần 3 cách
    // nhau HÀNG TUẦN vẫn đủ 3 -> job 'once' bị markRun('error') và tắt hẳn -
    // mất một lời nhắc dù chưa từng có 3 lần hỏng LIÊN TIẾP thật sự.
    attemptStore.incrementDeliveryAttempts(job.id);
    attemptStore.incrementDeliveryAttempts(job.id);

    await schedulerLoop.runSchedulerTick(new Date());

    const row = database.db.prepare("SELECT delivery_attempts AS n FROM scheduled_jobs WHERE id = ?").get(job.id) as {
      n: number;
    };
    assert.equal(row.n, 0, "delivery_attempts phải về 0 ngay khi bị chặn ở tick - lượt này KHÔNG PHẢI vì gửi hỏng");

    jobStore.deleteJob(ACC, threadId, job.id); // account vẫn offline nên job "due mãi" - dọn để không lọt sang test sau
  });
});

describe("trần ngày chặn NGAY Ở TICK - trước dispatch, không đợi agent chạy xong (Mục 1)", () => {
  it("job 'once' bị trần chặn: next_run_at đẩy sang GIỜ CẤU HÌNH (mặc định 8h) của NGÀY MAI (không phải 00:00, không phải mốc cũ, không phải NULL), đúng 1 tin thông báo, KHÔNG markRun", async () => {
    const zoneTime = await import("../shared/zone-time.js");
    const guard = await import("./proactive-send-guard.js");
    const sent = attachOnline();
    const threadId = "t-tick-tran-once";
    makeThread(threadId);
    tuning.setTuning("SCHEDULER_MAX_PROACTIVE_PER_DAY", 1);

    const now = new Date("2026-08-01T03:00:00.000Z"); // 10:00 sáng giờ VN 01/08
    guard.reserveProactiveSlot(ACC, threadId, "Asia/Ho_Chi_Minh", now); // chiếm hết suất TRƯỚC khi tick chạy

    const job = makeJob({ threadId, schedule: { kind: "once", runAtUtc: now.toISOString() } });

    await schedulerLoop.runSchedulerTick(now);
    await sleep(40);

    assert.equal(sent.length, 1, "chỉ có ĐÚNG 1 tin - câu thông báo chạm trần, không phải payload gốc");
    assert.notEqual(sent[0]!.text, job.payload);

    const after = jobStore.getJobUnscoped(job.id)!;
    assert.equal(after.runCount, 0, "chưa markRun - job chưa 'chạy' thật sự");
    assert.equal(after.enabled, true);
    assert.equal(
      after.nextRunAt,
      zoneTime.deferredRunAtUtc("Asia/Ho_Chi_Minh", tuning.getTuning("SCHEDULER_DEFERRED_RUN_HOUR"), now),
      "phải đẩy sang ĐÚNG giờ cấu hình của ngày mai - khớp câu bot vừa nhắn 'các lịch còn lại sẽ tiếp tục vào ngày mai'",
    );
    // 8h sáng giờ VN 02/08 = 01:00Z 02/08 (UTC+7) - KHÔNG PHẢI 17:00Z 01/08 (00:00 giờ VN 02/08, mốc nửa đêm bản trước dùng)
    assert.equal(after.nextRunAt, "2026-08-02T01:00:00.000Z", "phải là 8h sáng giờ VN ngày mai, KHÔNG dồn về nửa đêm");

    const run = lastRunOf(job.id);
    assert.equal(run?.status, "skipped");
    assert.match(run!.detail, /chạm trần/);

    // Job 'once' bị trần chặn vẫn SỐNG (enabled=true), next_run_at trỏ tới
    // tương lai (ngày mai) - dọn hẳn để không bị các test SAU trong file này
    // (dùng `now` giả lập cũng ở tương lai) quét trúng nhầm là "due".
    jobStore.deleteJob(ACC, threadId, job.id);
  });

  it("giành quyền báo trần dùng ĐÚNG day-key của `now` giả lập, không lệch sang ngày THẬT lúc chạy test (Mục 3, vòng 4)", async () => {
    const zoneTime = await import("../shared/zone-time.js");
    const guard = await import("./proactive-send-guard.js");
    const counterStore = await import("./proactive-send-counter-store.js");
    attachOnline();
    const threadId = "t-tick-tran-day-key-dung";
    makeThread(threadId);
    tuning.setTuning("SCHEDULER_MAX_PROACTIVE_PER_DAY", 1);

    // `now` XA ngày THẬT lúc chạy test (2026-07-31 theo currentDate hệ thống) -
    // nếu reserveCapNotice/revertCapNotice tự lấy `new Date()` thay vì nhận
    // `now` này, quyền "đã báo" sẽ bị ghi nhầm vào day-key CỦA NGÀY THẬT, và
    // day-key giả lập bên dưới (đúng ngày job đang xử lý) sẽ KHÔNG có gì.
    const now = new Date("2026-08-01T03:00:00.000Z");
    guard.reserveProactiveSlot(ACC, threadId, "Asia/Ho_Chi_Minh", now);
    const job = makeJob({ threadId, schedule: { kind: "once", runAtUtc: now.toISOString() } });

    await schedulerLoop.runSchedulerTick(now);
    await sleep(40);

    const dayKeyGiaLap = zoneTime.todayKey("Asia/Ho_Chi_Minh", now);
    const counter = counterStore.getProactiveCounter(ACC, threadId, dayKeyGiaLap);
    assert.equal(
      counter.noticeSent,
      true,
      "quyền báo phải ghi ĐÚNG day-key của `now` giả lập đang xử lý, không phải ngày thật lúc chạy test",
    );

    jobStore.deleteJob(ACC, threadId, job.id);
  });

  it("job 'every' bị trần chặn: next_run_at GIỮ mốc kế TỰ NHIÊN (đã tính sẵn bởi clear-before-dispatch) - KHÔNG bị đẩy qua ngày mai như 'once'", async () => {
    const guard = await import("./proactive-send-guard.js");
    attachOnline();
    const threadId = "t-tick-tran-every";
    makeThread(threadId);
    tuning.setTuning("SCHEDULER_MAX_PROACTIVE_PER_DAY", 1);

    const now = new Date("2026-08-01T03:00:00.000Z");
    guard.reserveProactiveSlot(ACC, threadId, "Asia/Ho_Chi_Minh", now);

    const job = makeJob({ threadId, schedule: { kind: "every", minutes: 30 }, now });
    jobStore.setNextRun(job.id, now.toISOString()); // ép due đúng lúc `now`

    await schedulerLoop.runSchedulerTick(now);
    await sleep(40);

    const after = jobStore.getJobUnscoped(job.id)!;
    assert.equal(
      after.nextRunAt,
      new Date(now.getTime() + 30 * 60_000).toISOString(),
      "mốc kế every 30 phút TỰ NHIÊN - nhánh trần ngày không được đụng vào",
    );
    assert.equal(lastRunOf(job.id)?.status, "skipped");

    // 'every' KHÔNG tự tắt (maxRuns=null, vô hạn) - dọn hẳn, nếu không job này
    // "due mãi mãi" và các test SAU (dùng `now` giả lập ở tương lai xa) sẽ
    // quét trúng, gửi nhầm 1 tin không liên quan vào `sent` của test đó.
    jobStore.deleteJob(ACC, threadId, job.id);
  });

  it("job kind='agent' bị trần chặn: KHÔNG tạo agent_turns nào - lượt LLM chưa từng chạy, tránh đốt token cho job chắc chắn không gửi được", async () => {
    const guard = await import("./proactive-send-guard.js");
    attachOnline();
    const threadId = "t-tick-tran-agent";
    makeThread(threadId);
    tuning.setTuning("SCHEDULER_MAX_PROACTIVE_PER_DAY", 1);

    const now = new Date("2026-08-01T03:00:00.000Z");
    guard.reserveProactiveSlot(ACC, threadId, "Asia/Ho_Chi_Minh", now);

    const job = makeJob({ threadId, kind: "agent", schedule: { kind: "every", minutes: 30 }, now });
    jobStore.setNextRun(job.id, now.toISOString());
    const before = (
      database.db.prepare("SELECT COUNT(*) AS n FROM agent_turns WHERE thread_id = ?").get(threadId) as { n: number }
    ).n;

    await schedulerLoop.runSchedulerTick(now);
    await sleep(40);

    const after = (
      database.db.prepare("SELECT COUNT(*) AS n FROM agent_turns WHERE thread_id = ?").get(threadId) as { n: number }
    ).n;
    assert.equal(after, before, "không được tạo agent_turns nào - lượt LLM chưa từng chạy");
    assert.equal(lastRunOf(job.id)?.status, "skipped");

    jobStore.deleteJob(ACC, threadId, job.id); // cùng lý do dọn ở test 'every' bên trên
  });

  it("job 'once' bị trần chặn rồi được gửi lại: nhãn '(nhắc trễ, lịch gốc HH:MM)' phải giữ ĐÚNG GIỜ GỐC, không phải giờ hoãn (Mục 3, vòng 3)", async () => {
    const guard = await import("./proactive-send-guard.js");
    const sent = attachOnline();
    const threadId = "t-tick-tran-once-nhac-tre";
    makeThread(threadId);
    tuning.setTuning("SCHEDULER_MAX_PROACTIVE_PER_DAY", 1);

    const runAt = new Date("2026-08-01T16:50:00.000Z"); // 23:50 giờ VN 01/08
    guard.reserveProactiveSlot(ACC, threadId, "Asia/Ho_Chi_Minh", runAt); // chiếm hết suất trước, cùng ngày VN với runAt

    const job = makeJob({ threadId, payload: "Nhớ họp", schedule: { kind: "once", runAtUtc: runAt.toISOString() } });

    // Tick lúc job đến hạn (23:50 VN) - bị trần chặn, đẩy sang 8h sáng VN ngày mai
    await schedulerLoop.runSchedulerTick(runAt);
    await sleep(40);
    assert.equal(sent.length, 1, "chỉ có tin thông báo chạm trần ở lượt này");

    const deferred = jobStore.getJobUnscoped(job.id)!;
    assert.equal(deferred.runAt, runAt.toISOString(), "run_at (mốc GỐC) KHÔNG được đụng vào dù next_run_at đã bị đẩy");

    // `reserveProactiveSlot`/`recordProactiveSend` bên trong `blockedByGuard`
    // (lúc GỬI THẬT, khác lần lọc sớm ở tick) mặc định dùng `now` THẬT (không
    // nhận `now` giả lập của tick) - tin thông báo chạm trần vừa gửi ở tick 1
    // đã vô tình chiếm mất suất của "hôm nay thật" (ngày chạy test), nên nếu
    // không dọn thì tick 2 (dù đã sang "ngày mai" theo mốc GIẢ LẬP) vẫn bị
    // chặn ở TẦNG GỬI vì suất "hôm nay thật" đã hết. Reset để cô lập đúng thứ
    // test này đang canh (nhãn nhắc trễ), không lẫn quirk thời gian thật/giả
    // lập của tầng guard.
    guard.resetProactiveSendCounters();

    // Tick NGÀY MAI đúng lúc job đến hạn lại (đã hết trần chặn - ngày mới).
    // LƯU Ý: `now` nhảy xa tới tương lai (so với giờ THẬT lúc chạy test) nên
    // tick NÀY quét ra CẢ job "due" còn sót của các ca test KHÁC trong CÙNG
    // file (DB dùng chung) - lọc đúng `threadId` của CHÍNH job đang test thay
    // vì tin vào tổng độ dài `sent`.
    await schedulerLoop.runSchedulerTick(new Date(deferred.nextRunAt!));
    await sleep(40);

    const sentThisThread = sent.filter((s) => s.threadId === threadId);
    assert.equal(sentThisThread.length, 2, "phải có đúng 2 tin trên thread này: thông báo chạm trần + tin nhắc trễ vừa gửi lại");
    assert.equal(
      sentThisThread[1]!.text,
      "(nhắc trễ, lịch gốc 23:50) Nhớ họp",
      "nhãn nhắc trễ phải giữ ĐÚNG giờ gốc 23:50 (run_at) - dùng next_run_at đã bị đẩy sẽ tính lateSeconds gần 0 và MẤT nhãn",
    );
  });

  it("N job CÙNG thread cùng bị chặn trong 1 tick (gap khác 0): chỉ ĐÚNG 1 tin thông báo, KHÔNG nhân bản theo số job (Mục 1, vòng 3)", async () => {
    const guard = await import("./proactive-send-guard.js");
    const sent = attachOnline();
    const threadId = "t-tick-nhieu-job-cham-tran";
    makeThread(threadId);
    tuning.setTuning("SCHEDULER_MAX_PROACTIVE_PER_DAY", 1);
    // Bắt buộc gap KHÁC 0 - đúng ca đã sinh bug: đường gửi (kể cả thông báo
    // chạm trần) phải CHỜ gap trước khi commit "đã báo" ở bản cũ, mở ra cửa sổ
    // đủ dài để N job khác đọc nhầm mình cũng là "lần đầu chạm trần".
    tuning.setTuning("SCHEDULER_SEND_GAP_MS", 50);

    const now = new Date("2026-08-01T03:00:00.000Z");
    guard.reserveProactiveSlot(ACC, threadId, "Asia/Ho_Chi_Minh", now); // chiếm hết suất trước

    // 3 job CÙNG thread, cùng đến hạn trong CÙNG 1 tick
    const jobs = [1, 2, 3].map((n) =>
      makeJob({ threadId, name: `job-${n}`, schedule: { kind: "once", runAtUtc: now.toISOString() } }),
    );

    await schedulerLoop.runSchedulerTick(now);
    // Đợi đủ dài hơn 3 lần gap cộng dồn - nếu bug nhân bản còn đó, đây là đủ
    // thời gian để CẢ 3 tin thông báo (nếu có) kịp ra hàng đợi rải đều.
    await sleep(400);

    // Lọc đúng threadId của CHÍNH test này (nhất quán với test "nhắc trễ" ngay
    // phía trên) - `now` giả lập ở tương lai nên tick này CÓ THỂ quét trúng
    // job "due" còn sót của test khác trong cùng file, đếm toàn cục `sent.length`
    // sẽ sai dương tính nếu có bất kỳ job lạ nào cũng lọt qua.
    const sentThisThread = sent.filter((s) => s.threadId === threadId);
    assert.equal(sentThisThread.length, 1, `chỉ được ĐÚNG 1 tin thông báo dù có 3 job cùng bị chặn (đo được ${sentThisThread.length})`);

    // Cả 3 vẫn SỐNG (bị chặn trần, không markRun) với next_run_at ở tương lai
    // (ngày mai) - dọn hẳn, cùng lý do các test 'once'/'every'/'agent' phía trên.
    for (const job of jobs) jobStore.deleteJob(ACC, threadId, job.id);
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
    const job = makeJob({ threadId, payload: "Nhớ họp", schedule: { kind: "once", runAtUtc: "2026-08-01T08:00:00.000Z" } });
    const now = new Date("2026-08-01T08:05:00.000Z");

    await schedulerLoop.runSchedulerTick(now);
    await sleep(40);

    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.text, "(nhắc trễ, lịch gốc 15:00) Nhớ họp");
    assert.equal(lastRunOf(job.id)?.status, "ok");
  });
});
