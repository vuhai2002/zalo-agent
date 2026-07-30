import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { API } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
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
function attachOnline(sendMessageImpl?: (msg: string, threadId: string) => unknown): { threadId: string; text: string }[] {
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

function makeJob(overrides: Partial<CreateScheduledJobInput> = {}) {
  return jobStore.createJob({
    accountId: ACC,
    threadId: THREAD,
    threadType: 0,
    name: "job test",
    kind: "message",
    payload: "noi dung mac dinh",
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

describe("runScheduledJob - kind=message", () => {
  it("gửi được, 0 lượt agent, ghi history + run 'ok'", async () => {
    const sent = attachOnline();
    const job = makeJob({ payload: "Nhac hop luc 3h chieu nay" });
    const before = agentTurnCount(THREAD);

    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt! });

    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.text, "Nhac hop luc 3h chieu nay");
    assert.equal(sent[0]!.threadId, THREAD);
    assert.equal(agentTurnCount(THREAD), before, "job kind=message không được tạo agent_turns nào");

    const history = historyStore.getRecentMessages(ACC, THREAD);
    assert.equal(history.at(-1)!.role, "assistant");
    assert.equal(history.at(-1)!.content, "Nhac hop luc 3h chieu nay");

    const run = lastRunOf(job.id);
    assert.equal(run.status, "ok");

    const updated = jobStore.getJobUnscoped(job.id)!;
    assert.equal(updated.lastStatus, "ok");
    assert.equal(updated.runCount, 1);
  });

  it("account không chạy (chưa attach) thì skip ngay, không gửi gì, run 'skipped' kèm lý do", async () => {
    const job = makeJob({ accountId: "acc-chua-tung-online", threadId: "t-bat-ky" });

    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt! });

    const run = lastRunOf(job.id);
    assert.equal(run.status, "skipped");
    assert.match(run.detail, /không chạy/);
  });

  it("gửi hỏng (zca-js ném lỗi) thì run 'error', last_error có nội dung, KHÔNG ghi history", async () => {
    attachOnline(() => {
      throw new Error("mang rot giua chung");
    });
    const job = makeJob({ payload: "Tin se khong bao gio toi noi" });
    const historyBefore = historyStore.getRecentMessages(ACC, THREAD).length;

    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt! });

    const run = lastRunOf(job.id);
    assert.equal(run.status, "error");
    assert.match(run.detail, /mang rot giua chung/);
    assert.equal(jobStore.getJobUnscoped(job.id)!.lastError, run.detail);

    const historyAfter = historyStore.getRecentMessages(ACC, THREAD);
    assert.equal(historyAfter.length, historyBefore, "gửi hỏng thì KHÔNG được ghi thêm gì vào history");
  });

  it("late=true: nguyên văn payload được thêm tiền tố '(nhắc trễ, lịch gốc HH:MM)'", async () => {
    const sent = attachOnline();
    const job = makeJob({ payload: "Nho hop" });

    // 08:00Z = 15:00 giờ VN (BOT_TIMEZONE mặc định, job không pin timezone riêng)
    await runJob.runScheduledJob(job, { late: true, scheduledFor: "2026-08-01T08:00:00.000Z" });

    assert.equal(sent[0]!.text, "(nhắc trễ, lịch gốc 15:00) Nho hop");
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
      payload: "nhac lap lai",
      schedule: { kind: "every", minutes: 30 },
    });

    for (let i = 0; i < 10; i++) {
      await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt! });
      assert.equal(lastRunOf(job.id).status, "ok", `tin thứ ${i + 1} (trong trần 10) phải gửi được`);
    }
    assert.equal(sent.length, 10);

    // Tin thứ 11: chạm trần -> bị chặn + có thêm 1 tin THÔNG BÁO (không phải payload)
    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt! });
    assert.equal(lastRunOf(job.id).status, "skipped", "tin thứ 11 phải bị chặn");
    assert.equal(sent.length, 11, "phải có thêm đúng 1 tin - câu thông báo chạm trần");
    assert.notEqual(sent.at(-1)!.text, "nhac lap lai", "tin thêm phải là câu THÔNG BÁO, không phải payload gốc");

    // Tin thứ 12 cùng ngày: vẫn bị chặn nhưng KHÔNG lặp lại câu thông báo
    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt! });
    assert.equal(lastRunOf(job.id).status, "skipped");
    assert.equal(sent.length, 11, "câu thông báo không được lặp lại trong cùng ngày");
  });
});

describe("runScheduledJob - không giữ khoá thread khi đang chờ hàng đợi toàn cục (Finding 3)", () => {
  it("tin THẬT trên CÙNG thread chạy được ngay dù job đang xếp hàng ở hàng đợi toàn cục", async () => {
    const guard = await import("./proactive-send-guard.js");
    const messageBatcher = await import("../middleware/message-batcher.js");
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    attachOnline();
    const threadKey = `${ACC}:${THREAD}`;
    const job = makeJob({ payload: "cham vi hang doi toan cuc" });

    // Chiếm hàng đợi toàn cục bằng 1 việc "chậm" 200ms - job dispatch NGAY SAU
    // đây sẽ phải XẾP HÀNG sau việc này trong enqueueProactiveSend.
    void guard.enqueueProactiveSend(() => sleep(200));

    // Dispatch job (KHÔNG await) - nó sẽ vào deliverProactively và phải CHỜ
    // tới lượt ở hàng đợi toàn cục (~200ms) trước khi được vào xâu thread.
    void runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt! });
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

    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt! });

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

  function mockModel(result: () => unknown) {
    const calls: Parameters<MockLanguageModelV4["doGenerate"]>[0][] = [];
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        calls.push(options);
        const r = result();
        if (r instanceof Error) throw r;
        return r as Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;
      },
    });
    return { model, calls };
  }

  it("chạy được (có nội dung) -> gửi + agent_turns.source='schedule' + có trace + run 'ok'", async () => {
    const sent = attachOnline();
    const job = makeJob({ kind: "agent", payload: "Tom tat tin cong nghe hom nay" });
    const { model } = mockModel(() => traLoi("Hom nay co 3 tin dang chu y ve AI."));
    const before = agentTurnCount(THREAD);

    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, resolveModel: () => model });

    assert.equal(sent.at(-1)!.text, "Hom nay co 3 tin dang chu y ve AI.");
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
    assert.equal(history.at(-1)!.content, "Hom nay co 3 tin dang chu y ve AI.");
  });

  it("trả [SILENT] thì KHÔNG gửi gì, run ghi 'silent' - nhưng agent_turns vẫn có (đã chạy, chỉ chọn im)", async () => {
    const sent = attachOnline();
    const job = makeJob({ kind: "agent", payload: "Theo doi gia vang, co gi moi thi bao" });
    const { model } = mockModel(() => traLoi("[SILENT]"));
    const before = agentTurnCount(THREAD);

    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, resolveModel: () => model });

    assert.equal(sent.length, 0, "không được gửi gì khi model chọn im lặng");
    assert.equal(agentTurnCount(THREAD), before + 1, "vẫn phải có agent_turns - job ĐÃ chạy, chỉ là không gửi");
    assert.equal(lastRunOf(job.id).status, "silent");
  });

  it("provider ném lỗi thì run 'error', last_error có nội dung, KHÔNG gửi gì", async () => {
    const sent = attachOnline();
    const job = makeJob({ kind: "agent", payload: "Viec se khong bao gio xong" });
    const { model } = mockModel(
      () =>
        new APICallError({
          message: "500 tu router",
          url: "https://router/v1/chat",
          requestBodyValues: {},
          statusCode: 500,
          isRetryable: false,
        }),
    );

    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, resolveModel: () => model });

    assert.equal(sent.length, 0);
    const run = lastRunOf(job.id);
    assert.equal(run.status, "error");
    assert.match(run.detail, /500 tu router/);
    assert.match(jobStore.getJobUnscoped(job.id)!.lastError ?? "", /500 tu router/);
  });

  it("isolated:true xuyên suốt tới schema tool gửi model - loại add_reaction, save_memory", async () => {
    attachOnline();
    const job = makeJob({ kind: "agent", payload: "Bao cao gi do" });
    const { model, calls } = mockModel(() => traLoi("ok"));

    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, resolveModel: () => model });

    const toolKeys = calls[0]!.tools?.map((t) => t.name) ?? [];
    assert.ok(!toolKeys.includes("add_reaction"), "add_reaction không được có trong lượt theo lịch");
    assert.ok(!toolKeys.includes("save_memory"), "save_memory không được có trong lượt theo lịch");
  });

  it("late=true: câu trả lời của agent được thêm tiền tố '(nhắc trễ, lịch gốc HH:MM)' trước khi gửi", async () => {
    const sent = attachOnline();
    const job = makeJob({ kind: "agent", payload: "Bao cao dinh ky" });
    const { model } = mockModel(() => traLoi("Bao cao xong roi day."));

    await runJob.runScheduledJob(job, {
      late: true,
      scheduledFor: "2026-08-01T08:00:00.000Z", // 15:00 giờ VN
      resolveModel: () => model,
    });

    assert.equal(sent.at(-1)!.text, "(nhắc trễ, lịch gốc 15:00) Bao cao xong roi day.");
  });
});
