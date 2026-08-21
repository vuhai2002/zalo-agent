import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import { thanhKetQuaStream, type KetQuaGenerate } from "../agent/streaming-model-test-helper.js";
// import type bị xóa lúc chạy nên không kéo module chạm DB lên trước setupTestEnv
import type { CreateScheduledJobInput } from "./scheduled-job-store.js";
import type { ZaloBotClient } from "../zalo-bot/zalo-bot-api-client.js";

/**
 * Lịch hẹn chạy THẬT trên tài khoản Zalo Bot.
 *
 * Đây là mối nối chưa ai canh: `run-scheduled-job.test.ts` luôn chạy với kênh
 * cá nhân đủ năng lực, còn các test kênh bot thì đo từng mảnh rời (parser,
 * vòng poll, bảng chặn). Chưa ai chứng minh scheduler gửi được qua một kênh
 * KHÔNG có `api` zca-js.
 *
 * Khuôn giống `run-scheduled-job.test.ts`: DB thật, account-manager thật, chỉ
 * giả đường ra mạng (client Bot API) và model LLM.
 *
 * CẢNH BÁO AN TOÀN: client Bot API LUÔN LÀ hàm giả trong file này - không bao
 * giờ chạm `bot-api.zaloplatforms.com`.
 */
let dataDir: string;
let runJob: typeof import("./run-scheduled-job.js");
let capGuard: typeof import("./scheduled-job-cap-guard.js");
let accountManager: typeof import("../zalo/account-manager.js");
let accountStore: typeof import("../config/account-store.js");
let agentStore: typeof import("../config/agent-store.js");
let threadStore: typeof import("../conversation/thread-store.js");
let jobStore: typeof import("./scheduled-job-store.js");
let runLogStore: typeof import("./job-run-log-store.js");
let historyStore: typeof import("../conversation/history-store.js");
let database: typeof import("../conversation/database.js");
let guard: typeof import("./proactive-send-guard.js");
let botRunner: typeof import("../zalo-bot/bot-account-runner.js");
let registry: typeof import("../agent/tools/tool-registry.js");
let tuning: typeof import("../config/runtime-tuning-settings.js");
let kbSources: typeof import("../knowledge/kb-source-store.js");
let kbBinding: typeof import("../knowledge/kb-agent-binding.js");

const ACC = "acc-lich-bot";
const THREAD = "chat-lich-bot";

/** Tin đã ra "mạng" qua client Bot API giả */
let daGui: { chatId: string; text: string }[] = [];

before(async () => {
  // SCHEDULER_SEND_GAP_MS mặc định 20000ms (rải đều toàn cục) - không hạ thì
  // ca trần ngày mất hàng phút và treo cả test runner.
  dataDir = setupTestEnv({ SCHEDULER_SEND_GAP_MS: "0" });
  runJob = await import("./run-scheduled-job.js");
  capGuard = await import("./scheduled-job-cap-guard.js");
  accountManager = await import("../zalo/account-manager.js");
  accountStore = await import("../config/account-store.js");
  agentStore = await import("../config/agent-store.js");
  threadStore = await import("../conversation/thread-store.js");
  jobStore = await import("./scheduled-job-store.js");
  runLogStore = await import("./job-run-log-store.js");
  historyStore = await import("../conversation/history-store.js");
  database = await import("../conversation/database.js");
  guard = await import("./proactive-send-guard.js");
  botRunner = await import("../zalo-bot/bot-account-runner.js");
  registry = await import("../agent/tools/tool-registry.js");
  tuning = await import("../config/runtime-tuning-settings.js");
  kbSources = await import("../knowledge/kb-source-store.js");
  kbBinding = await import("../knowledge/kb-agent-binding.js");

  agentStore.ensureDefaultAgent();
  threadStore.recordThreadActivity({
    accountId: ACC,
    threadId: THREAD,
    threadType: 0,
    displayName: "Người nhắn bot",
    lastSenderName: "Người nhắn bot",
  });
});

beforeEach(() => {
  guard.resetProactiveSendCounters();
  daGui = [];
});

after(() => {
  accountManager.stopAllAccounts();
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

/**
 * Client Bot API GIẢ. `getUpdates` TREO vĩnh viễn - vòng poll thật không có
 * sàn nhịp, một fake trả `null` tức thì sẽ quay CPU suốt cả file test.
 */
function clientBotGia(guiImpl?: (text: string) => void): ZaloBotClient {
  return {
    getMe: async () => ({ id: "bot-1", display_name: "Bot thử" }),
    getWebhookInfo: async () => ({}),
    deleteWebhook: async () => ({}),
    getUpdates: () => new Promise<null>(() => {}),
    sendMessage: async (chatId: string, text: string) => {
      daGui.push({ chatId, text });
      guiImpl?.(text);
      return { message_id: `m-${daGui.length}` };
    },
    sendPhoto: async () => ({}),
    sendChatAction: async () => ({}),
  } as unknown as ZaloBotClient;
}

/** Đưa ACC lên "online" như tài khoản BOT, qua ĐÚNG `startAccount` thật */
async function botOnline(guiImpl?: (text: string) => void): Promise<void> {
  if (!accountStore.getAccount(ACC)) {
    accountStore.createAccount({ id: ACC, label: "Bot" });
    accountStore.datLoaiKenh(ACC, "bot");
    accountStore.datBotToken(ACC, "123:abcdefghijklmnop");
  }
  accountStore.updateAccount(ACC, { enabled: true });
  const khoiPhuc = botRunner.tiemClientRunnerChoTest(() => clientBotGia(guiImpl));
  try {
    await accountManager.startAccount(ACC);
  } finally {
    khoiPhuc();
  }
}

function makeJob(overrides: Partial<CreateScheduledJobInput> = {}) {
  return jobStore.createJob({
    accountId: ACC,
    threadId: THREAD,
    threadType: 0,
    name: "job bot",
    kind: "message",
    payload: "nội dung mặc định",
    schedule: { kind: "once", runAtUtc: "2026-08-01T08:00:00.000Z" },
    createdBy: "user-1",
    now: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  });
}

const lastRunOf = (jobId: string) => runLogStore.listRuns(jobId, 1)[0]!;

const traLoi = (chu: string) =>
  ({
    finishReason: "stop",
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    content: [{ type: "text", text: chu }],
    warnings: [],
  }) as unknown as KetQuaGenerate;

const modelGia = (chu: string) =>
  new MockLanguageModelV4({ doStream: async () => thanhKetQuaStream(traLoi(chu)) });

describe("lịch hẹn trên tài khoản Zalo Bot", () => {
  it("job kind=message gửi THẬT qua Bot API, ghi history, run 'ok'", async () => {
    await botOnline();
    const job = makeJob({ payload: "Nhắc uống nước lúc 3h" });

    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, now: new Date() });

    assert.deepEqual(daGui, [{ chatId: THREAD, text: "Nhắc uống nước lúc 3h" }]);
    assert.equal(lastRunOf(job.id).status, "ok");

    const history = historyStore.getRecentMessages(ACC, THREAD);
    assert.equal(history.at(-1)!.role, "assistant");
    assert.equal(history.at(-1)!.content, "Nhắc uống nước lúc 3h");
  });

  it("trần ký tự của KÊNH thắng trần chung - Bot API ép cứng 2000 phía server", async () => {
    // `ZALO_MAX_MESSAGE_CHARS` chỉnh được tới 4000 trên dashboard. Dùng chung
    // một con số thì ai nới cho kênh cá nhân là kênh bot MẤT TRỌN câu trả lời
    // (server chối nguyên tin, không cắt bớt). Ca này chứng minh
    // `tranKyTuMotTin` của kênh thật sự đi qua được tới bộ cắt.
    //
    // PHẢI nới qua `setTuning` (bảng `runtime_settings`), KHÔNG phải
    // `process.env`: env được Zod đọc MỘT LẦN ở module scope, gán sau khi
    // module đã nạp là không có tác dụng. Bản đầu của ca này viết bằng
    // `process.env` và XANH GIẢ - mặc định vốn đã là 2000, trùng đúng trần của
    // kênh bot, nên nó chẻ 2 tin vì lý do hoàn toàn khác thứ đang đo.
    tuning.setTuning("ZALO_MAX_MESSAGE_CHARS", 4000);
    try {
      assert.equal(tuning.getTuning("ZALO_MAX_MESSAGE_CHARS"), 4000, "nới trần chung thất bại - ca này sẽ đo nhầm");
      await botOnline();
      // Toàn dấu cách + chữ để bộ cắt có chỗ cắt tự nhiên, không phải cắt giữa từ
      const dai = Array.from({ length: 500 }, (_, i) => `cau${i}`).join(" ");
      assert.ok(dai.length > 2000 && dai.length < 4000, `chuỗi thử phải nằm giữa 2 trần, đang ${dai.length}`);
      const job = makeJob({ payload: dai });

      await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, now: new Date() });

      assert.equal(daGui.length, 2, "trần 2000 của kênh bot bị bỏ qua - đang dùng trần chung 4000");
      assert.ok(daGui[0]!.text.length <= 2000, `tin đầu ${daGui[0]!.text.length} ký tự, vượt trần nền tảng`);
    } finally {
      tuning.setTuning("ZALO_MAX_MESSAGE_CHARS", null);
    }
  });

  it("job kind=agent chạy được với `api: null` - lượt cô lập không cần zca-js", async () => {
    await botOnline();
    const job = makeJob({ kind: "agent", payload: "Tóm tắt tin công nghệ hôm nay" });

    await runJob.runScheduledJob(job, {
      late: false,
      scheduledFor: job.nextRunAt!,
      now: new Date(),
      resolveModel: () => modelGia("Hôm nay có 3 tin đáng chú ý."),
    });

    assert.equal(daGui.at(-1)?.text, "Hôm nay có 3 tin đáng chú ý.");
    assert.equal(lastRunOf(job.id).status, "ok");

    const turns = database.db
      .prepare("SELECT COUNT(*) AS n FROM agent_turns WHERE thread_id = ? AND source = 'schedule'")
      .get(THREAD) as { n: number };
    assert.equal(turns.n, 1, "lượt agent theo lịch phải để lại đúng 1 dòng usage");
  });

  it("lượt theo lịch trên kênh bot còn ĐÚNG 4 tool tra cứu", async () => {
    // Hai lớp lọc CHỒNG nhau: `runsInScheduledTurn: false` (9 tool) và bảng
    // chặn của kênh bot. Ca này khoá con số lại - `ToolContext.api` để `null`
    // chỉ an toàn chừng nào không tool nào còn cần nó.
    await botOnline();
    const agent = agentStore.listAgents()[0]!;

    // Phải GÁN nguồn KB thì `kb_search` mới vào danh sách: mặc định agent
    // KHÔNG đọc được nguồn nào (`agent_kb_sources` rỗng nghĩa là ĐÓNG). Bản
    // đầu của ca này quên bước đó và đỏ với 3 key - đúng hành vi, sai kỳ vọng.
    const nguon = kbSources.taoNguon({ ten: "Bảng giá", loai: "text", noiDungGoc: "giá 100k" });
    kbBinding.datNguonChoAgent(agent.id, [nguon.id]);

    const scope = { account: accountStore.getAccount(ACC)!, agent };
    const keys = registry.listAvailableTools(scope, { isolated: true }).map((t) => t.key).sort();

    assert.deepEqual(keys, ["get_datetime", "kb_search", "web_fetch", "web_search"]);
    assert.ok(!keys.includes("schedule_task"), "job không được đẻ job");
    assert.ok(!keys.includes("get_group_info"), "getChat/getChatMember trả 404 trên Bot API");

    kbBinding.xoaGanNguonCuaAgent(agent.id);
  });

  it("account bot ĐANG TẮT: skip và GIỮ suất chạy, không tắt job", async () => {
    // Đây là ca chứng minh nhánh `tatJobKhongCanPhamVi` cũ đã đi đúng chỗ:
    // "tài khoản bot" và "account không chạy" giờ là HAI chuyện khác nhau. Bản
    // cũ gộp làm một nên job của bot bị TẮT HẲN kể cả khi bot đang chạy tốt.
    accountManager.stopAllAccounts();
    const job = makeJob({ payload: "gửi khi bot tắt" });

    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, now: new Date() });

    assert.equal(daGui.length, 0);
    const run = lastRunOf(job.id);
    assert.equal(run.status, "skipped");
    assert.match(run.detail, /không chạy/);

    const sau = jobStore.getJobUnscoped(job.id)!;
    assert.equal(sau.enabled, true, "job bị TẮT vì account tạm dừng - lời nhắc mất vĩnh viễn");
    assert.equal(
      sau.nextRunAt,
      job.nextRunAt,
      "`once` phải được phục hồi ĐÚNG mốc cũ để tick sau thử lại",
    );
  });

  it("job `every` trên bot chạy xong vẫn BẬT và có mốc kế - không bị tắt như bản cũ", async () => {
    await botOnline();
    const job = makeJob({ kind: "message", payload: "nhắc định kỳ", schedule: { kind: "every", minutes: 30 } });

    await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, now: new Date() });

    assert.equal(daGui.length, 1);
    const sau = jobStore.getJobUnscoped(job.id)!;
    assert.equal(sau.enabled, true);
    assert.ok(sau.nextRunAt, "job `every` mất mốc kế là chết lặng, không tick nào nhặt lại được");
  });

  it("trần tin chủ động mỗi ngày vẫn đếm trên kênh bot", async () => {
    // Cùng lý do với ca trần ký tự: `setTuning` chứ không `process.env`.
    tuning.setTuning("SCHEDULER_MAX_PROACTIVE_PER_DAY", 2);
    try {
      assert.equal(tuning.getTuning("SCHEDULER_MAX_PROACTIVE_PER_DAY"), 2);
      await botOnline();
      const now = new Date("2026-08-01T08:00:00.000Z");
      for (let i = 0; i < 3; i += 1) {
        const job = makeJob({ payload: `tin ${i}` });
        await runJob.runScheduledJob(job, { late: false, scheduledFor: job.nextRunAt!, now });
      }
      // Đếm theo NỘI DUNG JOB, không đếm `daGui.length`: lượt bị chặn còn gửi
      // thêm CÂU BÁO TRẦN, nên tổng số tin là 3. Bản đầu của ca này khẳng định
      // `daGui.length === 2` và đỏ vì đếm nhầm câu báo trần thành tin của job -
      // đúng hành vi, sai phép đo.
      const tinCuaJob = daGui.filter((t) => /^tin \d$/.test(t.text));
      assert.deepEqual(
        tinCuaJob.map((t) => t.text),
        ["tin 0", "tin 1"],
        "trần ngày không áp cho kênh bot - bot nhắn không giới hạn",
      );
      assert.ok(
        daGui.some((t) => t.text.includes("tạm dừng để tránh làm phiền")),
        "chạm trần mà người nhắn không được báo gì",
      );
    } finally {
      tuning.setTuning("SCHEDULER_MAX_PROACTIVE_PER_DAY", null);
    }
  });

  it("thông báo CHẠM TRẦN NGÀY gửi được trên kênh bot (lỗ câm của cap-guard)", async () => {
    // `concludeCapBlockedAtTick` tự dựng target riêng. Bản cũ dựng bằng
    // `duongGuiZcaJs(getRunningAccountApi(...))`, nên với tài khoản bot thì
    // target là undefined -> `notifyCapHitOnce` thành false -> KHÔNG AI ĐƯỢC
    // BÁO. Hỏng câm, và sửa mỗi đường gửi chính sẽ bỏ sót đúng chỗ này.
    await botOnline();
    const job = makeJob({ payload: "nội dung không quan trọng" });

    await capGuard.concludeCapBlockedAtTick(
      job,
      "Đã đạt trần tin nhắn chủ động hôm nay.",
      true,
      "Asia/Ho_Chi_Minh",
      new Date("2026-08-01T08:00:00.000Z"),
    );

    assert.equal(daGui.length, 1, "chạm trần ngày mà không ai được báo trên kênh bot");
    assert.equal(daGui[0]!.chatId, THREAD);
  });
});
