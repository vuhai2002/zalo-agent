import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { API } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import { thanhKetQuaStream, type KetQuaGenerate } from "../agent/streaming-model-test-helper.js";
// import type bị xóa lúc chạy nên không kéo module lên trước setupTestEnv
import type { AccountConfig } from "../config/account-store.js";
import type { CreateScheduledJobInput } from "./scheduled-job-store.js";

/**
 * Test tích hợp cho `runScheduledJob`: dùng THẬT account-manager (qua
 * `attachAccount` với api giả) + THẬT DB (account/thread/job/history/run-log)
 * - chỉ giả duy nhất đường ra mạng (`api.sendMessage`) và model LLM
 * (`resolveModel`). Đây là cách kiểm chứng đúng "dây nối" thật giữa các
 * module, không phải mock rời từng phần.
 *
 * CẢNH BÁO AN TOÀN: `api.sendMessage` LUÔN LÀ HÀM GIẢ trong file này - không
 * bao giờ được chạm api thật, đúng yêu cầu bắt buộc của brief.
 */

let dataDir: string;
let runJob: typeof import("./run-scheduled-job.js");
let accountManager: typeof import("../zalo/account-manager.js");
let accountStore: typeof import("../config/account-store.js");
let threadStore: typeof import("../conversation/thread-store.js");
let jobStore: typeof import("./scheduled-job-store.js");
let runLogStore: typeof import("./job-run-log-store.js");
let historyStore: typeof import("../conversation/history-store.js");
let database: typeof import("../conversation/database.js");
let guard: typeof import("./proactive-send-guard.js");

const ACC = "acc-run-job";
const THREAD = "t-run-job";

before(async () => {
  // SCHEDULER_SEND_GAP_MS mặc định 20000ms (rải đều toàn cục) - không hạ thì
  // 10+ lần gửi trong test "trần ngày" mất hàng phút, treo cả test runner.
  dataDir = setupTestEnv({ SCHEDULER_SEND_GAP_MS: "0" });
  runJob = await import("./run-scheduled-job.js");
  accountManager = await import("../zalo/account-manager.js");
  accountStore = await import("../config/account-store.js");
  threadStore = await import("../conversation/thread-store.js");
  jobStore = await import("./scheduled-job-store.js");
  runLogStore = await import("./job-run-log-store.js");
  historyStore = await import("../conversation/history-store.js");
  database = await import("../conversation/database.js");
  guard = await import("./proactive-send-guard.js");

  accountStore.createAccount({ id: ACC, label: "Test" });
  threadStore.recordThreadActivity({
    accountId: ACC,
    threadId: THREAD,
    threadType: 0,
    displayName: "",
    lastSenderName: "",
  });
});

// Bộ đếm trần ngày giờ bền qua DB (Finding 5), không còn tự "reset theo file
// test" như bản Map trong bộ nhớ cũ - nhiều ca test dùng CHUNG threadId (vd
// THREAD) sẽ cộng dồn vào NHAU nếu không dọn. Reset trước MỖI test để mỗi ca
// tự đứng độc lập, không phụ thuộc thứ tự chạy hay số ca đứng trước nó.
beforeEach(() => {
  guard.resetProactiveSendCounters();
});

after(() => {
  accountManager.stopAllAccounts();
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

/**
 * "Online" hoá ACC qua đúng đường `attachAccount` thật - `sendMessage` là hàm
 * GIẢ DUY NHẤT chạm tới "mạng"; `listener.*` toàn no-op để attachAccount()
 * không văng lỗi (không có tin nào lọt qua đường đó vì `listener.on` không
 * lưu lại callback). Gọi lại nhiều lần trong cùng file AN TOÀN: attachAccount
 * tự thay thế lượt gắn trước.
 */
function attachOnline(
  sendMessageImpl?: (msg: string, threadId: string) => unknown,
): { threadId: string; text: string; styles?: { start: number; len: number }[] }[] {
  const sent: { threadId: string; text: string; styles?: { start: number; len: number }[] }[] = [];
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
    sendMessage: async (
      payload: { msg: string; styles?: { start: number; len: number }[] },
      threadId: string,
    ) => {
      sent.push({ threadId, text: payload.msg, styles: payload.styles });
      if (sendMessageImpl) return sendMessageImpl(payload.msg, threadId);
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

function agentTurnCount(threadId: string): number {
  return (
    database.db.prepare("SELECT COUNT(*) AS n FROM agent_turns WHERE thread_id = ?").get(threadId) as { n: number }
  ).n;
}

function lastRunOf(jobId: string) {
  return runLogStore.listRuns(jobId, 1)[0]!;
}

function deliveryAttemptsOf(jobId: string): number {
  return (
    database.db.prepare("SELECT delivery_attempts AS n FROM scheduled_jobs WHERE id = ?").get(jobId) as {
      n: number;
    }
  ).n;
}

describe("runScheduledJob - kind=message", () => {
  it("gửi được, 0 lượt agent, ghi history + run 'ok'", async () => {
    const sent = attachOnline();
    const job = makeJob({ payload: "Nhắc họp lúc 3h chiều nay" });
    const before = agentTurnCount(THREAD);

    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, now: new Date() });

    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.text, "Nhắc họp lúc 3h chiều nay");
    assert.equal(sent[0]!.threadId, THREAD);
    assert.equal(agentTurnCount(THREAD), before, "job kind=message không được tạo agent_turns nào");

    const history = historyStore.getRecentMessages(ACC, THREAD);
    assert.equal(history.at(-1)!.role, "assistant");
    assert.equal(history.at(-1)!.content, "Nhắc họp lúc 3h chiều nay");

    const run = lastRunOf(job.id);
    assert.equal(run.status, "ok");

    const updated = jobStore.getJobUnscoped(job.id)!;
    assert.equal(updated.lastStatus, "ok");
    assert.equal(updated.runCount, 1);
  });

  it("account không chạy (chưa attach) thì skip ngay, không gửi gì, run 'skipped' kèm lý do", async () => {
    const job = makeJob({ accountId: "acc-chua-tung-online", threadId: "t-bat-ky" });

    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, now: new Date() });

    const run = lastRunOf(job.id);
    assert.equal(run.status, "skipped");
    assert.match(run.detail, /không chạy/);
  });

  it("bị chặn vì account không chạy phải RESET delivery_attempts - lượt này kết thúc KHÔNG PHẢI vì gửi hỏng (Mục 4, vòng 3)", async () => {
    const attemptStore = await import("./delivery-attempt-store.js");
    const job = makeJob({ accountId: "acc-chua-tung-online-2", threadId: "t-bat-ky-2" });
    attemptStore.incrementDeliveryAttempts(job.id);
    attemptStore.incrementDeliveryAttempts(job.id); // mô phỏng 2 lần gửi hỏng RẢI RÁC ở các lượt trước đó

    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, now: new Date() });

    assert.equal(deliveryAttemptsOf(job.id), 0, "bị chặn account/thread phải đứt chuỗi gửi hỏng - không cộng dồn với lần gửi hỏng KẾ TIẾP");
  });

  it("gửi hỏng (zca-js ném lỗi) thì thử lại tối đa 3 lần trước khi ghi 'error' thật (Mục 2) - KHÔNG ghi history bất kỳ lần nào", async () => {
    attachOnline(() => {
      throw new Error("mạng rớt giữa chừng");
    });
    const job = makeJob({ payload: "Tin sẽ không bao giờ tới nơi" });
    const historyBefore = historyStore.getRecentMessages(ACC, THREAD).length;

    // Lần 1 và 2: gửi hỏng nhưng CHƯA chạm đủ 3 lần - job phải SỐNG (không markRun)
    for (let lan = 1; lan <= 2; lan++) {
      await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, now: new Date() });
      const con = jobStore.getJobUnscoped(job.id)!;
      assert.equal(con.runCount, 0, `lần thử ${lan}: run_count KHÔNG được tăng - job chưa "chạy xong" thật sự`);
      assert.equal(con.lastError, null, `lần thử ${lan}: last_error KHÔNG được ghi - job còn cơ hội thử lại`);
      assert.equal(con.enabled, true, `lần thử ${lan}: job KHÔNG được tự tắt`);
      assert.match(lastRunOf(job.id).detail, /thử lại lần/);
    }

    // Lần 3: chạm đủ số lần thử tối đa - GIỜ MỚI tiêu suất chạy + ghi error thật
    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, now: new Date() });
    const run = lastRunOf(job.id);
    assert.equal(run.status, "error");
    assert.match(run.detail, /mạng rớt giữa chừng/);
    const chet = jobStore.getJobUnscoped(job.id)!;
    assert.equal(chet.runCount, 1, "lần thứ 3 mới thật sự tính là 1 lần chạy");
    assert.match(chet.lastError ?? "", /mạng rớt giữa chừng/);

    const historyAfter = historyStore.getRecentMessages(ACC, THREAD);
    assert.equal(historyAfter.length, historyBefore, "gửi hỏng thì KHÔNG được ghi thêm gì vào history, kể cả sau 3 lần thử");
  });

  it("gửi hỏng lần đầu rồi THÀNH CÔNG lần sau: delivery_attempts phải reset - không cộng dồn qua các lượt chạy KHÁC NHAU", async () => {
    let firstCallFails = true;
    const sent = attachOnline(() => {
      if (firstCallFails) {
        firstCallFails = false;
        throw new Error("lỗi mạng thoáng qua");
      }
      return { msgId: "ok" };
    });
    const job = makeJob({ payload: "Sẽ gửi được ở lần thứ 2" });

    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, now: new Date() });
    assert.equal(deliveryAttemptsOf(job.id), 1, "lần 1 hỏng phải tăng delivery_attempts lên 1");

    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, now: new Date() });
    // sendMessage giả ghi vào `sent` TRƯỚC KHI gọi sendMessageImpl (nên lần 1
    // hỏng cũng để lại 1 dòng) - tín hiệu "lần 2 THẬT SỰ tới nơi" đáng tin hơn
    // là run 'ok' + có ghi history (chỉ ghi khi deliveredText khác rỗng).
    assert.equal(sent.length, 2, "cả 2 lần gọi API đều để lại dấu vết (lần 1 hỏng SAU KHI gọi, không phải KHÔNG gọi)");
    assert.equal(lastRunOf(job.id).status, "ok");
    assert.equal(historyStore.getRecentMessages(ACC, THREAD).at(-1)!.content, "Sẽ gửi được ở lần thứ 2", "lần 2 phải THẬT SỰ tới nơi (có ghi history)");
    assert.equal(deliveryAttemptsOf(job.id), 0, "gửi được rồi thì bộ đếm phải reset về 0, không giữ lại từ lần hỏng trước");
  });

  it("late=true: nguyên văn payload được thêm tiền tố '(nhắc trễ, lịch gốc HH:MM)'", async () => {
    const sent = attachOnline();
    const job = makeJob({ payload: "Nhớ họp" });

    // 08:00Z = 15:00 giờ VN (BOT_TIMEZONE mặc định, job không pin timezone riêng)
    await runJob.runScheduledJob(job, { late: true, scheduledFor: "2026-08-01T08:00:00.000Z", now: new Date() });

    assert.equal(sent[0]!.text, "(nhắc trễ, lịch gốc 15:00) Nhớ họp");
  });

  it("trần ngày (mặc định 10/ngày): tin thứ 11 bị chặn kèm ĐÚNG 1 câu thông báo, tin thứ 12 im lặng", async () => {
    const sent = attachOnline();
    const threadTran = "t-cham-tran-runjob";
    threadStore.recordThreadActivity({
      accountId: ACC,
      threadId: threadTran,
      threadType: 0,
      displayName: "",
      lastSenderName: "",
    });
    const job = makeJob({
      threadId: threadTran,
      kind: "message",
      payload: "nhắc lặp lại",
      schedule: { kind: "every", minutes: 30 },
    });

    for (let i = 0; i < 10; i++) {
      await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, now: new Date() });
      assert.equal(lastRunOf(job.id).status, "ok", `tin thứ ${i + 1} (trong trần 10) phải gửi được`);
    }
    assert.equal(sent.length, 10);

    // Tin thứ 11: chạm trần -> bị chặn + có thêm 1 tin THÔNG BÁO (không phải payload)
    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, now: new Date() });
    assert.equal(lastRunOf(job.id).status, "skipped", "tin thứ 11 phải bị chặn");
    assert.equal(sent.length, 11, "phải có thêm đúng 1 tin - câu thông báo chạm trần");
    assert.notEqual(sent.at(-1)!.text, "nhắc lặp lại", "tin thêm phải là câu THÔNG BÁO, không phải payload gốc");
    assert.equal(deliveryAttemptsOf(job.id), 0, "bị chặn vì trần ngày phải reset delivery_attempts - KHÔNG PHẢI vì gửi hỏng (Mục 4, vòng 3)");

    // Tin thứ 12 cùng ngày: vẫn bị chặn nhưng KHÔNG lặp lại câu thông báo
    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, now: new Date() });
    assert.equal(lastRunOf(job.id).status, "skipped");
    assert.equal(sent.length, 11, "câu thông báo không được lặp lại trong cùng ngày");
  });
});

// Mục 2 (vòng 3, "gửi thành công rồi chốt sổ hỏng KHÔNG được retry") ĐÃ SỬA
// trong src/scheduler/scheduled-job-send.ts (bọc appendMessage + phần chốt sổ
// trong try/catch riêng, gắn lỗi vào reply.error thay vì để throw thoát ra
// ngoài sendAndConclude). CÓ test tích hợp ép lỗi THẬT (không phải mock) ở
// file riêng src/scheduler/scheduled-job-send.test.ts - `mock.method` không
// dùng được ở ĐÂY (cùng thread, cùng process với các test khác của file này
// đã import transitively sẵn appendMessage/markRun), nhưng 1 file test CÔ
// LẬP với DB riêng (`setupTestEnv()` tạo `mkdtemp` riêng mỗi lần gọi) thì DROP
// hẳn bảng `messages` ép lỗi SQL thật, an toàn vì không đụng DB của file nào
// khác - xem doc đầu file đó.

describe("runScheduledJob - không giữ khoá thread khi đang chờ hàng đợi toàn cục (Finding 3)", () => {
  it("tin THẬT trên CÙNG thread chạy được ngay dù job đang xếp hàng ở hàng đợi toàn cục", async () => {
    const guard = await import("./proactive-send-guard.js");
    const messageBatcher = await import("../middleware/message-batcher.js");
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    attachOnline();
    const threadKey = `${ACC}:${THREAD}`;
    const job = makeJob({ payload: "chậm vì hàng đợi toàn cục" });

    // Chiếm hàng đợi toàn cục bằng 1 việc "chậm" 200ms - job dispatch NGAY SAU
    // đây sẽ phải XẾP HÀNG sau việc này trong enqueueProactiveSend. Giữ lại
    // reference (không `void`) để CHỜ nó xong ở cuối test - bản trước bắn đi
    // không dọn, 2 promise còn dở tràn sang chạy giữa ca test KẾ TIẾP và vẫn
    // ghi DB, một nguồn gây flaky (Mục 6).
    const occupier = guard.enqueueProactiveSend(() => sleep(200));

    // Dispatch job (KHÔNG await NGAY) - nó sẽ vào deliverProactively và phải
    // CHỜ tới lượt ở hàng đợi toàn cục (~200ms) trước khi được vào xâu thread.
    const jobRun = runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, now: new Date() });
    await sleep(15); // đủ để job kịp tới bước enqueueProactiveSend (vài microtask), còn NGẮN hơn nhiều so với 200ms hàng đợi

    // Trong lúc job CÒN ĐANG CHỜ hàng đợi toàn cục, tin nhắn "thật" trên CHÍNH
    // thread đó phải chạy được NGAY - không bị job giữ khoá thread lại. Đây
    // chính là điều đã sửa: trước fix, job giữ khoá thread SUỐT lúc chờ hàng
    // đợi toàn cục (enqueueProactiveSend lồng BÊN NGOÀI runOnThreadChain).
    const t0 = Date.now();
    let ranMessage = false;
    await messageBatcher.runOnThreadChain(threadKey, async () => {
      ranMessage = true;
    });
    const dt = Date.now() - t0;

    assert.equal(ranMessage, true);
    assert.ok(dt < 100, `tin thật phải chạy gần như ngay, không đợi job xong hàng đợi toàn cục (đo được ${dt}ms)`);

    // Dọn sạch trước khi qua ca test kế: đợi cả 2 việc đã bắn ở trên hoàn tất.
    await Promise.all([occupier, jobRun]);
  });
});

describe("runScheduledJob - đếm trần THEO SỐ TIN, không phải theo lượt (Finding 4)", () => {
  it("1 lượt bị cắt thành nhiều tin thì trần cộng đúng SỐ TIN thật sự gửi, không phải cố định 1", async () => {
    const counterStore = await import("./proactive-send-counter-store.js");
    const zoneTime = await import("../shared/zone-time.js");

    attachOnline();
    const threadDaiTin = "t-dai-tin-finding4";
    threadStore.recordThreadActivity({
      accountId: ACC,
      threadId: threadDaiTin,
      threadType: 0,
      displayName: "",
      lastSenderName: "",
    });

    // Dài hơn ZALO_MAX_MESSAGE_CHARS (2000, mặc định) để sendReplyInParts CHẮC
    // CHẮN cắt thành >= 2 tin - trước fix, dù cắt bao nhiêu tin bộ đếm cũng
    // chỉ +1, nghĩa là 1 job trả lời dài chạy đủ 10 lần/ngày có thể ra tới 50
    // tin thật (5 = ZALO_MAX_MESSAGE_PARTS) mà trần tưởng mới dùng 10/10.
    const doanDai = "Nội dung báo cáo hôm nay khá dài, cần trình bày đầy đủ từng mục. ".repeat(60);
    const job = makeJob({ threadId: threadDaiTin, payload: doanDai });

    const dayKey = zoneTime.todayKey("Asia/Ho_Chi_Minh");
    const before = counterStore.getProactiveCounter(ACC, threadDaiTin, dayKey).count;

    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, now: new Date() });

    assert.equal(lastRunOf(job.id).status, "ok");
    const after = counterStore.getProactiveCounter(ACC, threadDaiTin, dayKey).count;
    assert.ok(after - before >= 2, `payload dài phải cắt thành >= 2 tin, bộ đếm phải tăng đúng bằng đó (đo được tăng ${after - before})`);
  });
});

describe("runScheduledJob - kind=agent", () => {
  /** usage LỒNG đúng cấu trúc LanguageModelV4 (KHÔNG phải 3 số phẳng) - bẫy đã ghi trong dự án */
  const usage = (vao: number, ra: number) => ({
    inputTokens: { total: vao, noCache: vao, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: ra, text: ra, reasoning: 0 },
  });

  function traLoi(text: string) {
    return {
      content: text ? [{ type: "text" as const, text }] : [],
      finishReason: "stop" as const,
      usage: usage(60, 15),
      warnings: [],
    };
  }

  // `doStream` chứ không phải `doGenerate`: vòng lặp agent đi đường `streamText`
  // để thoát 524 của Cloudflare (xem stream-text-result.ts).
  function mockModel(result: () => unknown) {
    const calls: Parameters<MockLanguageModelV4["doStream"]>[0][] = [];
    const model = new MockLanguageModelV4({
      doStream: async (options) => {
        calls.push(options);
        const r = result();
        if (r instanceof Error) throw r;
        return thanhKetQuaStream(r as KetQuaGenerate);
      },
    });
    return { model, calls };
  }

  it("chạy được (có nội dung) -> gửi + agent_turns.source='schedule' + có trace + run 'ok'", async () => {
    const sent = attachOnline();
    const job = makeJob({ kind: "agent", payload: "Tóm tắt tin công nghệ hôm nay" });
    const { model } = mockModel(() => traLoi("Hôm nay có 3 tin đáng chú ý về AI."));
    const before = agentTurnCount(THREAD);

    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, resolveModel: () => model, now: new Date() });

    assert.equal(sent.at(-1)!.text, "Hôm nay có 3 tin đáng chú ý về AI.");
    assert.equal(agentTurnCount(THREAD), before + 1, "phải có đúng 1 dòng agent_turns mới");

    const run = lastRunOf(job.id);
    assert.equal(run.status, "ok");
    assert.ok(run.turnId, "run phải nối được sang agent_turns qua turn_id");

    const turnRow = database.db.prepare("SELECT source FROM agent_turns WHERE id = ?").get(run.turnId) as {
      source: string;
    };
    assert.equal(turnRow.source, "schedule");

    const stepCount = (
      database.db.prepare("SELECT COUNT(*) AS n FROM agent_steps WHERE turn_id = ?").get(run.turnId) as { n: number }
    ).n;
    assert.ok(stepCount > 0, "phải có trace (agent_steps) cho lượt vừa chạy");

    const history = historyStore.getRecentMessages(ACC, THREAD);
    assert.equal(history.at(-1)!.content, "Hôm nay có 3 tin đáng chú ý về AI.");
  });

  it("trả [SILENT] thì KHÔNG gửi gì, run ghi 'silent' - nhưng agent_turns vẫn có (đã chạy, chỉ chọn im)", async () => {
    const sent = attachOnline();
    const job = makeJob({ kind: "agent", payload: "Theo dõi giá vàng, có gì mới thì báo" });
    const { model } = mockModel(() => traLoi("[SILENT]"));
    const before = agentTurnCount(THREAD);

    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, resolveModel: () => model, now: new Date() });

    assert.equal(sent.length, 0, "không được gửi gì khi model chọn im lặng");
    assert.equal(agentTurnCount(THREAD), before + 1, "vẫn phải có agent_turns - job ĐÃ chạy, chỉ là không gửi");
    assert.equal(lastRunOf(job.id).status, "silent");
  });

  it("payload của job kind='message' cũng qua lớp định dạng", async () => {
    // `payload` là chữ MODEL viết lúc đặt lịch qua tool schedule_task, gửi
    // nguyên văn lúc tới giờ - trước đây nó đi vòng qua lớp làm sạch hoàn toàn
    const sent = attachOnline();
    const job = makeJob({ kind: "message", payload: "**Nhắc**: họp lúc `9h` nhé" });

    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, now: new Date() });

    const tin = sent.at(-1)!;
    assert.equal(tin.text, "Nhắc: họp lúc 9h nhé", "dấu markdown không được lọt ra chữ");
    // Lịch hẹn KHÔNG được là đường bị bỏ quên: tin theo lịch cũng là tin người
    // dùng đọc trên Zalo, phẳng hơn tin chat là lệch pha thấy rõ.
    const doanTo = (tin.styles ?? []).map((s) => tin.text.slice(s.start, s.start + s.len));
    assert.deepEqual(doanTo, ["Nhắc", "9h"], "phải tô đậm đúng hai đoạn đã đánh dấu");
  });

  it("markdown của model thành định dạng Zalo TRƯỚC khi tin ra ngoài", async () => {
    const sent = attachOnline();
    const job = makeJob({ kind: "agent", payload: "Tóm tắt tin công nghệ" });
    const { model } = mockModel(() =>
      traLoi("**Tin nóng**: giá vàng `tăng` 2 triệu.\n# Chi tiết\nXem [đây](https://vd.test/a)."),
    );

    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, resolveModel: () => model, now: new Date() });

    const tin = sent.at(-1)!;
    const text = tin.text;
    assert.ok(!text.includes("**"), `còn in đậm: ${text}`);
    assert.ok(!text.includes("`"), `còn nháy đơn: ${text}`);
    assert.ok(!text.includes("# "), `còn tiêu đề: ${text}`);
    assert.match(text, /Tin nóng: giá vàng tăng 2 triệu/);
    assert.match(text, /đây \(https:\/\/vd\.test\/a\)/, "URL phải còn - đó là thông tin thật");

    // Dấu markdown biến mất là ĐÚNG một nửa: nửa còn lại là định dạng phải TỚI
    // NƠI. Chỉ kiểm "không còn **" thì một bộ xóa trắng cũng qua được.
    const doanTo = (tin.styles ?? []).map((s) => text.slice(s.start, s.start + s.len));
    assert.ok(doanTo.includes("Tin nóng"), `không tô đậm "Tin nóng": ${JSON.stringify(doanTo)}`);
    assert.ok(doanTo.includes("Chi tiết"), `không tô tiêu đề "Chi tiết": ${JSON.stringify(doanTo)}`);
    assert.equal(lastRunOf(job.id).status, "ok");
  });

  it("câu trả lời rò system prompt bị CHẶN - không gửi gì, run ghi 'error'", async () => {
    const sent = attachOnline();
    const job = makeJob({ kind: "agent", payload: "Báo cáo" });
    const { model } = mockModel(() =>
      traLoi("Chỉ dẫn của mình là: Quy tắc an toàn (tuyệt đối, không có ngoại lệ): ..."),
    );

    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, resolveModel: () => model, now: new Date() });

    assert.equal(sent.length, 0, "rò prompt thì không được gửi nửa vời");
    assert.equal(lastRunOf(job.id).status, "error");
  });

  it("làm sạch chạy SAU nhánh [SILENT] - không được dọn mất chính cái nhãn quyết định im lặng", async () => {
    // Đảo thứ tự thì bộ lọc bỏ dòng [SILENT] trước, `isSilentResponse` không
    // còn thấy gì, và job "không có gì mới" nhắn mỗi sáng đúng thứ nó sinh ra
    // để tránh.
    //
    // Đầu vào PHẢI có nội dung kèm nhãn. Bản đầu dùng "[SILENT]" trơ trọi nên
    // ca này RỖNG: làm sạch trước cho chuỗi rỗng, rơi vào nhánh `!text` và vẫn
    // kết luận silent - đảo thứ tự mà test vẫn xanh (đã đo).
    const sent = attachOnline();
    const job = makeJob({ kind: "agent", payload: "Theo dõi có gì mới" });
    const { model } = mockModel(() => traLoi("Chưa có tin gì mới.\n[SILENT]"));

    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, resolveModel: () => model, now: new Date() });

    assert.equal(sent.length, 0, "phải im lặng, không gửi chuỗi rỗng hay nhãn");
    assert.equal(lastRunOf(job.id).status, "silent");
  });

  it("trả [SILENT] phải RESET delivery_attempts - lượt này kết thúc KHÔNG PHẢI vì gửi hỏng, không được cộng dồn với lần gửi hỏng ở NGÀY KHÁC (Mục 4, vòng 3)", async () => {
    const attemptStore = await import("./delivery-attempt-store.js");
    attachOnline();
    const job = makeJob({ kind: "agent", payload: "Theo dõi giá vàng" });
    attemptStore.incrementDeliveryAttempts(job.id);
    attemptStore.incrementDeliveryAttempts(job.id); // mô phỏng 2 lần gửi hỏng RẢI RÁC ở các lượt trước đó
    const { model } = mockModel(() => traLoi("[SILENT]"));

    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, resolveModel: () => model, now: new Date() });

    assert.equal(deliveryAttemptsOf(job.id), 0, "lượt SILENT phải đứt chuỗi gửi hỏng - không được giữ lại 2 lần cũ để cộng dồn thành đủ 3 ở lần gửi hỏng KẾ TIẾP");
  });

  it("provider ném lỗi (lượt agent chết giữa chừng) thì thử lại tối đa 3 lần trước khi ghi 'error' thật (Mục 2), KHÔNG gửi gì", async () => {
    const sent = attachOnline();
    const job = makeJob({ kind: "agent", payload: "Việc sẽ không bao giờ xong" });
    const { model } = mockModel(
      () =>
        new APICallError({
          message: "500 từ router",
          url: "https://router/v1/chat",
          requestBodyValues: {},
          statusCode: 500,
          isRetryable: false,
        }),
    );

    for (let lan = 1; lan <= 2; lan++) {
      await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, resolveModel: () => model, now: new Date() });
      const con = jobStore.getJobUnscoped(job.id)!;
      assert.equal(con.runCount, 0, `lần thử ${lan}: job chưa "chạy xong" thật sự`);
      assert.equal(con.lastError, null, `lần thử ${lan}: chưa được ghi last_error`);
    }

    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, resolveModel: () => model, now: new Date() });
    assert.equal(sent.length, 0, "không bao giờ gửi gì - lượt agent chết trước cả khi tính ra text");
    const run = lastRunOf(job.id);
    assert.equal(run.status, "error");
    assert.match(run.detail, /500 từ router/);
    const chet = jobStore.getJobUnscoped(job.id)!;
    assert.equal(chet.runCount, 1, "lần thứ 3 mới thật sự tính là 1 lần chạy");
    assert.match(chet.lastError ?? "", /500 từ router/);
  });

  it("isolated:true xuyên suốt tới schema tool gửi model - loại add_reaction, save_memory", async () => {
    attachOnline();
    const job = makeJob({ kind: "agent", payload: "Báo cáo gì đó" });
    const { model, calls } = mockModel(() => traLoi("ok"));

    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, resolveModel: () => model, now: new Date() });

    const toolKeys = calls[0]!.tools?.map((t) => t.name) ?? [];
    assert.ok(!toolKeys.includes("add_reaction"), "add_reaction không được có trong lượt theo lịch");
    assert.ok(!toolKeys.includes("save_memory"), "save_memory không được có trong lượt theo lịch");
  });

  it("late=true: câu trả lời của agent được thêm tiền tố '(nhắc trễ, lịch gốc HH:MM)' trước khi gửi", async () => {
    const sent = attachOnline();
    const job = makeJob({ kind: "agent", payload: "Báo cáo định kỳ" });
    const { model } = mockModel(() => traLoi("Báo cáo xong rồi đấy."));

    await runJob.runScheduledJob(job, {
      late: true,
      scheduledFor: "2026-08-01T08:00:00.000Z", // 15:00 giờ VN
      now: new Date(),
      resolveModel: () => model,
    });

    assert.equal(sent.at(-1)!.text, "(nhắc trễ, lịch gốc 15:00) Báo cáo xong rồi đấy.");
  });

  // Mục 4 (vòng 3, "finishAgentTurn/saveTurnTrace không bị gọi lần 2 khi lỗi
  // ném ra SAU khi đã chốt usage thật") ĐÃ SỬA trong run-scheduled-job.ts
  // (cờ cục bộ `turnFinished` chặn 2 dòng trong catch). KHÔNG tự động test
  // được ở mức tích hợp vì cùng giới hạn mock ESM đã ghi ở describe "Mục 2"
  // phía trên (`blockedByGuard`/`sendAndConclude` đều đã bị chính module này
  // nạp trước khi test kịp mock) - đã xác nhận bằng review code trực tiếp:
  // `turnFinished` được set NGAY SAU dòng finishAgentTurn(result.usage) đầu
  // tiên, và catch chỉ gọi lại finishAgentTurn/saveTurnTrace khi cờ còn false.
});
