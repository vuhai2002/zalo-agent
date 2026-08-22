import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { Hono } from "hono";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import type { ZaloBotClient } from "./zalo-bot-api-client.js";

/**
 * Lịch hẹn CHẠY ĐƯỢC trên tài khoản Zalo Bot - qua cả ba đường vào từng bị
 * chặn (tool, dashboard, job cũ trong DB).
 *
 * File này thay `chan-lich-hen-kenh-bot.test.ts`, vốn khẳng định hành vi
 * NGƯỢC LẠI. Ba lớp chặn đó không phải phán quyết về năng lực nền tảng: Bot
 * API gửi chủ động được (đo thật 10 tin trong 416ms), nhưng scheduler khóa
 * cứng vào zca-js nên tài khoản bot không có đường gửi, và job `once` bị
 * `concludeBlockedNotRun` phục hồi `next_run_at` rồi quay lại MỖI TICK mãi
 * mãi. Chặn là cách chữa triệu chứng; V3.19 chữa gốc.
 *
 * Ca "XÓA account thì dọn luôn lịch hẹn" chuyển nguyên từ file cũ - bất biến
 * đó không liên quan gì tới kênh và vẫn phải đúng.
 */
let dataDir: string;
let app: Hono;
let cookie: string;
let accounts: typeof import("../config/account-store.js");
let agents: typeof import("../config/agent-store.js");
let threads: typeof import("../conversation/thread-store.js");
let database: typeof import("../conversation/database.js");
let manager: typeof import("../zalo/account-manager.js");
let runner: typeof import("./bot-account-runner.js");
let registry: typeof import("../agent/tools/tool-registry.js");
let nangLuc: typeof import("./nang-luc-kenh-bot.js");

const PASSWORD = "mat-khau-lich-bot-123";
let daGui: string[] = [];

before(async () => {
  dataDir = setupTestEnv({ DASHBOARD_PASSWORD: PASSWORD, SCHEDULER_SEND_GAP_MS: "0" });
  const { buildDashboardApp } = await import("../server/dashboard-server.js");
  app = buildDashboardApp();
  accounts = await import("../config/account-store.js");
  agents = await import("../config/agent-store.js");
  threads = await import("../conversation/thread-store.js");
  database = await import("../conversation/database.js");
  manager = await import("../zalo/account-manager.js");
  runner = await import("./bot-account-runner.js");
  registry = await import("../agent/tools/tool-registry.js");
  nangLuc = await import("./nang-luc-kenh-bot.js");
  agents.ensureDefaultAgent();

  const login = await app.request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password: PASSWORD }),
    headers: { "content-type": "application/json" },
  });
  cookie = login.headers.get("set-cookie")!.split(";")[0]!;
});

after(() => {
  manager.stopAllAccounts();
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(() => {
  manager.stopAllAccounts();
  daGui = [];
  for (const t of ["scheduled_jobs", "scheduled_job_runs", "threads", "accounts"]) {
    database.db.exec(`DELETE FROM ${t}`);
  }
});

function dungAccount(id: string, loai: "ca_nhan" | "bot") {
  accounts.createAccount({ id, label: id });
  if (loai === "bot") {
    accounts.datLoaiKenh(id, "bot");
    accounts.datBotToken(id, "123:abcdefghijklmnop");
  }
  // Thread phải có thật, không thì route chặn ở bước khác và ca này đo nhầm
  threads.recordThreadActivity({
    accountId: id,
    threadId: "t1",
    threadType: 0,
    displayName: "Người thử",
    lastSenderName: "Người thử",
  });
}

/** `getUpdates` treo vĩnh viễn - vòng poll thật không có sàn nhịp */
async function botOnline(id: string): Promise<void> {
  const client = {
    getMe: async () => ({ id: "bot-1", display_name: "Bot" }),
    getWebhookInfo: async () => ({}),
    deleteWebhook: async () => ({}),
    getUpdates: () => new Promise<null>(() => {}),
    sendMessage: async (_chatId: string, text: string) => {
      daGui.push(text);
      return { message_id: `m-${daGui.length}` };
    },
    sendPhoto: async () => ({}),
    sendChatAction: async () => ({}),
  } as unknown as ZaloBotClient;

  const khoiPhuc = runner.tiemClientRunnerChoTest(() => client);
  try {
    await manager.startAccount(id);
  } finally {
    khoiPhuc();
  }
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

describe("lịch hẹn trên tài khoản bot - ba đường vào", () => {
  it("dashboard TẠO ĐƯỢC lịch cho tài khoản bot", async () => {
    dungAccount("acc-bot", "bot");
    const res = await taoLich("acc-bot");
    assert.equal(res.status, 201, `route vẫn chặn tài khoản bot: ${await res.text()}`);
  });

  it("tài khoản CÁ NHÂN vẫn tạo được - không chặn nhầm", async () => {
    dungAccount("acc-thuong", "ca_nhan");
    const res = await taoLich("acc-thuong");
    assert.equal(res.status, 201, `tài khoản cá nhân bị chặn nhầm: ${await res.text()}`);
  });

  it("`schedule_task` CÓ trong tool của lượt chat trên bot, và trang Tools hiện dùng được", async () => {
    dungAccount("acc-bot", "bot");
    const agent = agents.listAgents()[0]!;
    const keys = registry
      .listAvailableTools({ account: accounts.getAccount("acc-bot")!, agent })
      .map((t) => t.key);
    assert.ok(keys.includes("schedule_task"), "model chạy trên tài khoản bot không nhận được schedule_task");

    const res = await app.request("/api/tools?accountId=acc-bot", { headers: { cookie } });
    const body = (await res.json()) as { items: { key: string; available: boolean; unavailableHint?: string }[] };
    const dong = body.items.find((t) => t.key === "schedule_task")!;
    assert.equal(dong.available, true, "trang Tools vẫn hiện 'Chưa dùng được' cho lịch hẹn");
    assert.equal(dong.unavailableHint, undefined);
  });

  it("bảng chặn của kênh bot còn ĐÚNG 8 mục, không còn `schedule_task`", async () => {
    // Con số này nằm rải trong README/README.en/system-architecture - đổi ở
    // đây mà quên phần chữ là tài liệu nói dối về chính sản phẩm.
    //
    // 7 -> 8 ở V3.21: thêm `tai_video` (Bot API không có method gửi video).
    assert.equal(Object.keys(nangLuc.TOOL_KHONG_CHAY_TREN_BOT).length, 8);
    assert.equal(nangLuc.toolChayDuocTrenBot("schedule_task"), true);
    assert.equal(nangLuc.toolChayDuocTrenBot("send_file"), false);
  });

  it("persona kênh bot KHÔNG nói bot không đặt được lịch", async () => {
    // Câu persona hiện chỉ liệt kê file/tài liệu/ảnh/cảm xúc/tag/nhóm - không nhắc
    // lịch, nên phase gỡ chặn không phải sửa gì. Ca này canh nợ TƯƠNG LAI: ai
    // thêm chữ "không đặt được lịch" vào đó sẽ làm persona nói dối, mà nói dối
    // kiểu này không test nào khác bắt được.
    assert.doesNotMatch(nangLuc.LUAT_PERSONA_KENH_BOT, /lịch|hẹn|schedule/i);
  });

  it("job CŨ của tài khoản bot giờ CHẠY THẬT, không bị tắt", async () => {
    // Job kiểu này tồn tại nếu được tạo trước khi có phép chặn ở route, hoặc
    // nếu ai đó đổi loại tài khoản. Bản cũ TẮT HẲN nó; giờ nó phải gửi được.
    dungAccount("acc-bot", "bot");
    await botOnline("acc-bot");
    const store = await import("../scheduler/scheduled-job-store.js");
    const runJob = await import("../scheduler/run-scheduled-job.js");

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

    await runJob.runScheduledJob(job, { scheduledFor: job.nextRunAt!, now: new Date(), late: false });

    assert.deepEqual(daGui, ["nhắc uống nước"]);
    assert.equal(store.getJobUnscoped(job.id)?.lastStatus, "ok");
  });

  it("job EVERY của tài khoản bot giữ nguyên lịch sau khi chạy", async () => {
    // `conclude` -> `markRun` chỉ đặt `enabled = 0` khi CHẠM TRẦN số lần chạy,
    // mà trần đó chỉ tồn tại với `once`. Bản cũ phải TẮT TƯỜNG MINH job every
    // của bot vì nó không có đường gửi; giờ không còn lý do đó.
    dungAccount("acc-bot", "bot");
    await botOnline("acc-bot");
    const store = await import("../scheduler/scheduled-job-store.js");
    const runJob = await import("../scheduler/run-scheduled-job.js");

    const job = store.createJob({
      accountId: "acc-bot",
      threadId: "t1",
      threadType: 0,
      name: "Nhắc định kỳ",
      kind: "message",
      payload: "uống nước",
      schedule: { kind: "every", minutes: 30 },
      createdBy: "test",
    });

    await runJob.runScheduledJob(job, { scheduledFor: job.nextRunAt!, now: new Date(), late: false });

    const sau = store.getJobUnscoped(job.id)!;
    assert.deepEqual(daGui, ["uống nước"]);
    assert.equal(sau.enabled, true);
    assert.ok(sau.nextRunAt, "job `every` mất mốc kế là chết lặng, không tick nào nhặt lại được");
  });

  it("XÓA account thì dọn luôn lịch hẹn - job mồ côi không sống dậy được", async () => {
    // Chuyển nguyên từ `chan-lich-hen-kenh-bot.test.ts`: không có khóa ngoại
    // cascade, nên xóa một account rồi tạo lại CÙNG ID sẽ làm job cũ sống dậy
    // dưới cấu hình mới. Bất biến này không liên quan gì tới kênh.
    dungAccount("acc-xoa", "ca_nhan");
    const store = await import("../scheduler/scheduled-job-store.js");
    store.createJob({
      accountId: "acc-xoa",
      threadId: "t1",
      threadType: 0,
      name: "Job sẽ mồ côi",
      kind: "message",
      payload: "x",
      schedule: { kind: "every", minutes: 30 },
      createdBy: "test",
    });
    assert.equal(store.listJobsForThread("acc-xoa", "t1").length, 1);

    accounts.deleteAccount("acc-xoa");
    dungAccount("acc-xoa", "bot");

    assert.deepEqual(
      store.listJobsForThread("acc-xoa", "t1"),
      [],
      "job cũ sống dậy dưới tài khoản bot - bất biến `loai` chốt lúc tạo bị lách",
    );
  });
});
