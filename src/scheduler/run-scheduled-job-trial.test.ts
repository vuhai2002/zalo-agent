import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { API } from "zca-js";
import type { AccountConfig } from "../config/account-store.js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
// import type bị xóa lúc chạy nên không kéo module lên trước setupTestEnv
import type { CreateScheduledJobInput } from "./scheduled-job-store.js";

/**
 * Test riêng cho race đã vá ở vòng review 2: "Chạy thử ngay" phải GIÀNH job
 * (next_run_at=NULL) trước khi dispatch, đúng bài clear-before-dispatch của
 * `scheduler-loop.ts` - nếu không, 1 tick THẬT xen vào giữa lúc trial còn
 * chạy dở (job kind='agent' gọi LLM dễ lâu hơn SCHEDULER_TICK_MS) sẽ dispatch
 * THẬT lần nữa, rồi bị restore của trial xoá mất tiến độ, khiến tick kế tiếp
 * gửi TRÙNG tin thật.
 *
 * CẢNH BÁO AN TOÀN: `api.sendMessage` LUÔN LÀ HÀM GIẢ - không chạm api thật.
 */

let dataDir: string;
let trialModule: typeof import("./run-scheduled-job-trial.js");
let schedulerLoop: typeof import("./scheduler-loop.js");
let accountManager: typeof import("../zalo/account-manager.js");
let accountStore: typeof import("../config/account-store.js");
let threadStore: typeof import("../conversation/thread-store.js");
let jobStore: typeof import("./scheduled-job-store.js");
let database: typeof import("../conversation/database.js");

const ACC = "acc-trial-race";

before(async () => {
  dataDir = setupTestEnv({ SCHEDULER_SEND_GAP_MS: "0" });
  trialModule = await import("./run-scheduled-job-trial.js");
  schedulerLoop = await import("./scheduler-loop.js");
  accountManager = await import("../zalo/account-manager.js");
  accountStore = await import("../config/account-store.js");
  threadStore = await import("../conversation/thread-store.js");
  jobStore = await import("./scheduled-job-store.js");
  database = await import("../conversation/database.js");

  accountStore.createAccount({ id: ACC, label: "Test" });
});

after(() => {
  accountManager.stopAllAccounts();
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

/**
 * Online hoá ACC với `sendMessage` TREO tới khi test tự `release()` - dựng
 * đúng "cửa sổ" để tick thật có cơ hội xen vào giữa lúc trial còn chạy dở,
 * mô phỏng lượt agent gọi LLM lâu hơn SCHEDULER_TICK_MS mà không cần mock
 * model thật (cơ chế giành job xảy ra TRƯỚC cả khi runScheduledJob rẽ nhánh
 * theo job.kind, nên test bằng kind='message' + sendMessage chậm vẫn chứng
 * minh đúng ĐIỂM giành/restore đang được test).
 */
function attachOnlineWithGate(): { sent: { threadId: string; text: string }[]; release: () => void } {
  const sent: { threadId: string; text: string }[] = [];
  let releaseFn: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseFn = resolve;
  });
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
      await gate;
      return { msgId: `m-${sent.length}` };
    },
  } as unknown as API;
  accountManager.attachAccount(config, api);
  return { sent, release: releaseFn };
}

function makeThread(threadId: string): void {
  threadStore.recordThreadActivity({ accountId: ACC, threadId, threadType: 0, displayName: "", lastSenderName: "" });
}

function makeJob(overrides: Partial<CreateScheduledJobInput> & { threadId: string }) {
  return jobStore.createJob({
    accountId: ACC,
    threadType: 0,
    name: "job quá hạn",
    kind: "message",
    payload: "Tin quá hạn, đang chờ tick thật",
    // createJob nhận thẳng ParsedSchedule đã chuẩn hoá, KHÔNG qua parseSchedule
    // (không kiểm "phải ở tương lai") - dùng đúng để dựng job ĐANG QUÁ HẠN,
    // khớp use-case brief nói là giá trị nhất: badge đỏ, bấm "Chạy thử ngay".
    schedule: { kind: "once", runAtUtc: new Date(Date.now() - 10 * 60_000).toISOString() },
    createdBy: "test",
    ...overrides,
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("runScheduledJobTrial - giành job trước khi dispatch (chống gửi trùng)", () => {
  it("job đang quá hạn: tick thật KHÔNG nhặt được job trong lúc trial còn treo, và trạng thái phục hồi đúng sau khi thử xong", async () => {
    const threadId = "t-trial-race";
    makeThread(threadId);
    const { sent, release } = attachOnlineWithGate();
    const job = makeJob({ threadId });
    assert.ok(new Date(job.nextRunAt!).getTime() < Date.now(), "job phải đang quá hạn để đúng use-case đang test");

    const trialPromise = trialModule.runScheduledJobTrial(job);

    // Đợi vài microtask/macrotask để trial chắc chắn đã claim (next_run_at=NULL)
    // VÀ đã gọi tới sendMessage (đang treo ở gate) - toàn bộ guard/preflight
    // giữa 2 điểm đó là SQLite đồng bộ, không có macrotask nào chặn giữa đường.
    await sleep(20);

    const duringTrial = jobStore.getJobUnscoped(job.id)!;
    assert.equal(duringTrial.nextRunAt, null, "job phải bị GIÀNH (next_run_at=NULL) trong lúc trial còn chạy");
    assert.equal(sent.length, 1, "trial đã gọi tới sendMessage (đang treo chờ gate)");

    // Chạy 1 tick THẬT ngay trong lúc trial còn "treo" - đúng kịch bản race
    await schedulerLoop.runSchedulerTick();
    assert.equal(
      sent.length,
      1,
      "tick KHÔNG được dispatch job này lần nữa - next_run_at đang NULL nên listDueJobs() không thấy nó",
    );

    release();
    await trialPromise;

    assert.equal(sent.length, 1, "chỉ ĐÚNG 1 tin được gửi - không nhân đôi vì tick chen vào giữa");
    const after = jobStore.getJobUnscoped(job.id)!;
    assert.equal(
      after.nextRunAt,
      job.nextRunAt,
      "sau khi thử xong, next_run_at phải quay về ĐÚNG mốc quá hạn ban đầu để tick THẬT sau đó còn tự nhặt lại",
    );
    assert.equal(after.enabled, true);
    assert.equal(after.runCount, 0, "chạy thử không được tính là 1 lần chạy thật");

    // Job vẫn "due mãi" (mốc quá hạn được phục hồi nguyên vẹn) - dọn để không
    // bị tick THẬT của các test SAU trong file này (nếu có) nhặt nhầm.
    jobStore.deleteJob(ACC, threadId, job.id);
  });
});
