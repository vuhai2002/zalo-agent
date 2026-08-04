import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { API } from "zca-js";
import type { AccountConfig } from "../config/account-store.js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
// import type bị xóa lúc chạy nên không kéo module lên trước setupTestEnv
import type { CreateScheduledJobInput } from "./scheduled-job-store.js";

/**
 * Test riêng, CÔ LẬP HẲN 1 FILE cho đúng kịch bản nguy hiểm nhất Finding-2/vòng
 * 3 (`sendAndConclude`): lỗi ném ra SAU KHI đã gửi thành công KHÔNG được coi
 * là "chưa gửi" - coi nhầm sẽ rơi vào đường retry và gửi TRÙNG đúng nội dung
 * tới `MAX_DELIVERY_ATTEMPTS` lần.
 *
 * Round trước thử ép lỗi bằng `node:test`'s `mock.method` trên
 * `appendMessage`/`markRun` - thất bại vì named export ESM là binding
 * `configurable: false` một khi có consumer khác đã resolve nó (đúng spec,
 * không phải thao tác sai). Round này ép lỗi THẬT bằng cách DROP hẳn bảng
 * `messages` - `appendMessage` (bên trong `sendAndConclude`) chắc chắn ném
 * lỗi SQL thật, không cần mock gì cả.
 *
 * AN TOÀN vì `setupTestEnv()` tạo `mkdtemp` RIÊNG cho MỖI LẦN GỌI (mỗi file
 * test gọi đúng 1 lần ở `before()`), và `node --test` chạy MỖI FILE một
 * process - phá bảng trong DB của FILE NÀY không đụng gì tới DB của file
 * khác. File này không cần đọc lại `messages` sau khi drop nên an toàn drop
 * ngay từ `before()`, trước cả test đầu tiên.
 */

let dataDir: string;
let runJob: typeof import("./run-scheduled-job.js");
let accountManager: typeof import("../zalo/account-manager.js");
let accountStore: typeof import("../config/account-store.js");
let threadStore: typeof import("../conversation/thread-store.js");
let jobStore: typeof import("./scheduled-job-store.js");
let runLogStore: typeof import("./job-run-log-store.js");
let database: typeof import("../conversation/database.js");

const ACC = "acc-post-send-fail";
const THREAD = "t-post-send-fail";

before(async () => {
  dataDir = setupTestEnv({ SCHEDULER_SEND_GAP_MS: "0" });
  runJob = await import("./run-scheduled-job.js");
  accountManager = await import("../zalo/account-manager.js");
  accountStore = await import("../config/account-store.js");
  threadStore = await import("../conversation/thread-store.js");
  jobStore = await import("./scheduled-job-store.js");
  runLogStore = await import("./job-run-log-store.js");
  database = await import("../conversation/database.js");

  accountStore.createAccount({ id: ACC, label: "Test" });
  threadStore.recordThreadActivity({
    accountId: ACC,
    threadId: THREAD,
    threadType: 0,
    displayName: "",
    lastSenderName: "",
  });

  // Ép appendMessage LUÔN throw lỗi SQL thật ("no such table: messages") -
  // đúng kịch bản "gửi thành công rồi mới hỏng ở bước ghi sổ". Xem doc đầu
  // file vì sao an toàn để drop hẳn (không mock được).
  database.db.exec("DROP TABLE messages");
});

after(() => {
  accountManager.stopAllAccounts();
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

function attachOnline(): { threadId: string; text: string }[] {
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
    listener: {
      on: () => {},
      onConnected: () => {},
      onError: () => {},
      onClosed: () => {},
      start: () => {},
      stop: () => {},
    },
    sendMessage: async (payload: { msg: string }, threadId: string) => {
      sent.push({ threadId, text: payload.msg });
      return { msgId: `m-${sent.length}` };
    },
  } as unknown as API;
  accountManager.attachAccount(config, api);
  return sent;
}

function makeJob(overrides: Partial<CreateScheduledJobInput> = {}) {
  return jobStore.createJob({
    accountId: ACC,
    threadId: THREAD,
    threadType: 0,
    name: "job test",
    kind: "message",
    payload: "nội dung mặc định",
    schedule: { kind: "once", runAtUtc: "2026-08-01T08:00:00.000Z" },
    createdBy: "user-1",
    now: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  });
}

describe("sendAndConclude - lỗi ném ra SAU KHI đã gửi thành công KHÔNG được coi là chưa gửi (Mục 2, vòng 4)", () => {
  it("tin ĐÃ ra Zalo (mock api ghi nhận đúng 1 lần), run ghi 'error', next_run_at KHÔNG bị đặt lại để retry", async () => {
    const sent = attachOnline();
    const job = makeJob({ payload: "Tin này phải ra đúng 1 lần, không được lặp lại" });
    const scheduledForGoc = job.nextRunAt!;

    await runJob.runScheduledJob(job, { late: false, scheduledFor: scheduledForGoc, now: new Date() });

    // 1. Tin ĐÃ RA THẬT - mock api ghi nhận đúng 1 lần, đúng nội dung.
    assert.equal(sent.length, 1, "tin phải ra Zalo đúng 1 lần - đây là bằng chứng gửi THẬT, không phải giả định");
    assert.equal(sent[0]!.threadId, THREAD);
    assert.equal(sent[0]!.text, "Tin này phải ra đúng 1 lần, không được lặp lại");

    // 2. Run phải ghi 'error' để dashboard thấy có chuyện (ghi sổ hỏng thật).
    const run = runLogStore.listRuns(job.id, 1)[0]!;
    assert.equal(run.status, "error", "phải ghi 'error' - ghi history hỏng thật sự xảy ra");
    assert.match(run.detail.toLowerCase(), /no such table/, "lý do phải là lỗi SQL thật (bảng messages đã bị drop)");

    // 3. ĐIỂM CỐT LÕI: next_run_at KHÔNG được đặt lại về scheduledFor để retry.
    // Nếu bug tái phát (throw sau khi gửi bị coi nhầm là "chưa gửi"), đường
    // concludeDeliveryFailed sẽ setNextRun(job.id, scheduledForGoc) - next_run_at
    // sẽ TRỞ LẠI đúng bằng scheduledForGoc, và tick sau gửi TRÙNG. Job 'once'
    // maxRuns=1 mà ĐÃ markRun (chạy thật) thì next_run_at phải là NULL
    // (markRun tự đưa về null khi chạm maxRuns) - khác hẳn scheduledForGoc.
    const after = jobStore.getJobUnscoped(job.id)!;
    assert.notEqual(
      after.nextRunAt,
      scheduledForGoc,
      "next_run_at KHÔNG được quay lại đúng scheduledFor - đó là dấu hiệu đã rơi vào đường retry dù tin đã ra thật",
    );
    assert.equal(after.nextRunAt, null, "once đã markRun (maxRuns=1, hitMax) nên next_run_at phải là NULL, không phải mốc chờ thử lại");
    assert.equal(after.runCount, 1, "phải markRun - job ĐÃ chạy thật (tin ra thật), không phải Finding 1 'chưa gửi được'");
    assert.equal(after.enabled, false, "maxRuns=1 đã chạm nên phải tự tắt - không phải job còn 'chờ retry'");
  });
});

describe("sendAndConclude - hoàn suất trần phải trả về ĐÚNG NGÀY đã giành", () => {
  it("gửi hỏng ở lượt có `now` giả lập: suất hoàn về ngày của LƯỢT, không phải ngày thật lúc chạy", async () => {
    // Lỗ hổng nặng nhất của bug "thiếu `now`", và trước đợt này KHÔNG test nào
    // phủ qua ĐƯỜNG GỬI THẬT (chỉ có unit test gọi thẳng refundProactiveSlot).
    //
    // Ca thật: job đến hạn lúc 23:59:50 -> `blockedByGuard` giành suất ngày D.
    // Gửi mất 20 giây (`SCHEDULER_SEND_GAP_MS`) rồi hỏng. Nếu
    // `refundProactiveSlot` tự lấy giờ THẬT thì nó trừ suất của ngày D+1: ngày
    // D giữ suất vĩnh viễn không ai đòi lại được, ngày D+1 bị `MAX(0, count-1)`
    // nuốt êm. Trần này là lá chắn chống khóa nick nên rò một suất là rò thật.
    const counterStore = await import("./proactive-send-counter-store.js");
    const zoneTime = await import("../shared/zone-time.js");

    // Mốc CỐ Ý cách xa ngày thật lúc chạy test - có lệch thì mới lộ
    const now = new Date("2026-08-01T08:00:00.000Z");
    const timeZone = "Asia/Ho_Chi_Minh";
    const dayKeyLuot = zoneTime.todayKey(timeZone, now);
    const dayKeyThat = zoneTime.todayKey(timeZone, new Date());
    assert.notEqual(dayKeyLuot, dayKeyThat, "mốc giả lập phải khác ngày thật thì ca này mới có nghĩa");

    // API gửi LUÔN HỎNG -> đường refund chắc chắn chạy
    attachOnline();
    const accountManagerMod = await import("../zalo/account-manager.js");
    accountManagerMod.attachAccount(
      {
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
      },
      {
        getOwnId: () => "self-1",
        listener: { on: () => {}, onConnected: () => {}, onError: () => {}, onClosed: () => {}, start: () => {}, stop: () => {} },
        sendMessage: async () => {
          throw new Error("Zalo từ chối");
        },
      } as unknown as API,
    );

    const job = makeJob({ payload: "tin này sẽ gửi hỏng" });
    const truocKhiChay = counterStore.getProactiveCounter(ACC, THREAD, dayKeyLuot).count;
    // Đo mốc ngày THẬT TRƯỚC lượt: ca chạy trước trong file này đã tiêu suất
    // của ngày thật, nên bất biến đúng là "lượt này không đụng vào nó", chứ
    // không phải "nó bằng 0".
    const ngayThatTruoc = counterStore.getProactiveCounter(ACC, THREAD, dayKeyThat).count;

    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, now });

    assert.equal(
      counterStore.getProactiveCounter(ACC, THREAD, dayKeyLuot).count,
      truocKhiChay,
      "gửi hỏng thì suất của NGÀY LƯỢT phải được hoàn - còn dư là rò suất vĩnh viễn",
    );
    assert.equal(
      counterStore.getProactiveCounter(ACC, THREAD, dayKeyThat).count,
      ngayThatTruoc,
      "lượt này KHÔNG được đụng vào bộ đếm của ngày THẬT lúc chạy test",
    );

    // Trả API bình thường lại cho các ca sau
    attachOnline();
  });
});
