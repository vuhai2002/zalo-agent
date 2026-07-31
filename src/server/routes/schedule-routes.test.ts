import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Hono } from "hono";
import type { API } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";
// import type bị xóa lúc chạy nên không kéo module lên trước setupTestEnv
import type { AccountConfig } from "../../config/account-store.js";
import type { ScheduledJob } from "../../scheduler/scheduled-job-store.js";

/**
 * API /api/schedule - trang Lịch hẹn trên dashboard.
 *
 * Trọng tâm 2 nhóm test: (1) IDOR - job của thread B không thao tác được bằng
 * accountId/threadId của thread A dù biết đúng id (12 hex); (2) "Chạy thử
 * ngay" KHÔNG được làm lệch lịch thật - đo trực tiếp next_run_at/enabled/
 * run_count TRƯỚC và SAU khi trial-run, kể cả khi gửi thành công.
 */

let dataDir: string;
let app: Hono;
let cookie: string;
let accountStore: typeof import("../../config/account-store.js");
let threadStore: typeof import("../../conversation/thread-store.js");
let accountManager: typeof import("../../zalo/account-manager.js");
let database: typeof import("../../conversation/database.js");

const ACC = "acc-schedule-route";
const THREAD = "t-schedule-route";
const THREAD_KHAC = "t-schedule-route-khac";
const PASSWORD = "mat-khau-schedule-123";

before(async () => {
  // Gap = 0 để test không phải đợi hàng đợi rải đều toàn cục (mặc định 20s)
  dataDir = setupTestEnv({ DASHBOARD_PASSWORD: PASSWORD, SCHEDULER_SEND_GAP_MS: "0" });
  const { buildDashboardApp } = await import("../dashboard-server.js");
  app = buildDashboardApp();
  accountStore = await import("../../config/account-store.js");
  threadStore = await import("../../conversation/thread-store.js");
  accountManager = await import("../../zalo/account-manager.js");
  database = await import("../../conversation/database.js");

  accountStore.createAccount({ id: ACC, label: "Test" });
  threadStore.recordThreadActivity({
    accountId: ACC,
    threadId: THREAD,
    threadType: 0,
    displayName: "",
    lastSenderName: "",
  });
  threadStore.recordThreadActivity({
    accountId: ACC,
    threadId: THREAD_KHAC,
    threadType: 0,
    displayName: "",
    lastSenderName: "",
  });

  const login = await app.request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password: PASSWORD }),
    headers: { "content-type": "application/json" },
  });
  cookie = login.headers.get("set-cookie")!.split(";")[0]!;
});

after(() => {
  accountManager.stopAllAccounts();
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

/** Online hoá ACC qua đúng đường attachAccount thật, sendMessage là hàm GIẢ DUY NHẤT chạm "mạng" */
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
    listener: { on: () => {}, onConnected: () => {}, onError: () => {}, onClosed: () => {}, start: () => {}, stop: () => {} },
    sendMessage: async (payload: { msg: string }, threadId: string) => {
      sent.push({ threadId, text: payload.msg });
      return { msgId: `m-${sent.length}` };
    },
  } as unknown as API;
  accountManager.attachAccount(config, api);
  return sent;
}

const authed = (path: string, init: RequestInit = {}) =>
  app.request(path, { ...init, headers: { cookie, "content-type": "application/json", ...(init.headers ?? {}) } });

async function taoJob(overrides: Record<string, unknown> = {}): Promise<ScheduledJob> {
  const res = await authed("/api/schedule", {
    method: "POST",
    body: JSON.stringify({
      accountId: ACC,
      threadId: THREAD,
      threadType: 0,
      name: "Job test",
      kind: "message",
      payload: "Nhắc nhở thử nghiệm",
      schedule: { kind: "once", inMinutes: 120 },
      ...overrides,
    }),
  });
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  return ((await res.json()) as { job: ScheduledJob }).job;
}

describe("GET /api/schedule", () => {
  it("chưa login -> 401", async () => {
    assert.equal((await app.request("/api/schedule")).status, 401);
  });

  it("trả kèm timezone", async () => {
    const res = await authed("/api/schedule?accountId=" + ACC);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { items: unknown[]; timezone: string };
    assert.ok(body.timezone.length > 0);
    assert.ok(Array.isArray(body.items));
  });
});

describe("POST /api/schedule", () => {
  it("chưa login -> 401", async () => {
    const res = await app.request("/api/schedule", { method: "POST", body: "{}" });
    assert.equal(res.status, 401);
  });

  it("tạo job kind=message thành công, xuất hiện trong danh sách", async () => {
    const job = await taoJob({ name: "Nhắc họp" });
    assert.equal(job.name, "Nhắc họp");
    assert.equal(job.enabled, true);
    assert.equal(job.runCount, 0);
    assert.ok(job.nextRunAt);

    const list = await authed("/api/schedule?accountId=" + ACC);
    const body = (await list.json()) as { items: ScheduledJob[] };
    assert.ok(body.items.some((j) => j.id === job.id));
  });

  it("account không tồn tại -> 400", async () => {
    const res = await authed("/api/schedule", {
      method: "POST",
      body: JSON.stringify({
        accountId: "acc-khong-ton-tai",
        threadId: THREAD,
        threadType: 0,
        name: "x",
        kind: "message",
        payload: "x",
        schedule: { kind: "once", inMinutes: 60 },
      }),
    });
    assert.equal(res.status, 400);
  });

  it("thread chưa từng ghi nhận -> 400", async () => {
    const res = await authed("/api/schedule", {
      method: "POST",
      body: JSON.stringify({
        accountId: ACC,
        threadId: "t-chua-tung-thay",
        threadType: 0,
        name: "x",
        kind: "message",
        payload: "x",
        schedule: { kind: "once", inMinutes: 60 },
      }),
    });
    assert.equal(res.status, 400);
  });

  it("lịch every quá dày (dưới ngưỡng chống spam) bị chặn -> 400 kèm lý do", async () => {
    const res = await authed("/api/schedule", {
      method: "POST",
      body: JSON.stringify({
        accountId: ACC,
        threadId: THREAD,
        threadType: 0,
        name: "x",
        kind: "message",
        payload: "x",
        schedule: { kind: "every", minutes: 1 },
      }),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json() as { error: string }).error, /spam/);
  });

  it("inMinutes vượt trần -> 400 có lý do rõ ràng, KHÔNG phải 500 (Mục M3: schema chặn trước khi chạm new Date() gây RangeError)", async () => {
    const res = await authed("/api/schedule", {
      method: "POST",
      body: JSON.stringify({
        accountId: ACC,
        threadId: THREAD,
        threadType: 0,
        name: "x",
        kind: "message",
        payload: "x",
        schedule: { kind: "once", inMinutes: 999_999_999 },
      }),
    });
    assert.equal(res.status, 400);
  });

  it("every.minutes vượt trần 525600 -> 400 kèm lý do đọc được, KHÔNG phải 500 (cùng lỗ RangeError đã vá cho inMinutes)", async () => {
    const res = await authed("/api/schedule", {
      method: "POST",
      body: JSON.stringify({
        accountId: ACC,
        threadId: THREAD,
        threadType: 0,
        name: "x",
        kind: "message",
        payload: "x",
        schedule: { kind: "every", minutes: 999_999_999 },
      }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.ok(body.error.length > 0, "phải kèm câu lỗi đọc được, không phải thân rỗng của lỗi 500");
  });
});

describe("PATCH /api/schedule/:id", () => {
  it("chưa login -> 401", async () => {
    const job = await taoJob();
    const res = await app.request(`/api/schedule/${job.id}`, { method: "PATCH", body: "{}" });
    assert.equal(res.status, 401);
  });

  it("sửa tên/nội dung thành công", async () => {
    const job = await taoJob({ name: "Trước khi sửa" });
    const res = await authed(`/api/schedule/${job.id}`, {
      method: "PATCH",
      body: JSON.stringify({ accountId: ACC, threadId: THREAD, name: "Đã sửa", payload: "Nội dung mới" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { job: ScheduledJob };
    assert.equal(body.job.name, "Đã sửa");
    assert.equal(body.job.payload, "Nội dung mới");
  });

  it("bật/tắt qua enabled", async () => {
    const job = await taoJob();
    const res = await authed(`/api/schedule/${job.id}`, {
      method: "PATCH",
      body: JSON.stringify({ accountId: ACC, threadId: THREAD, enabled: false }),
    });
    const body = (await res.json()) as { job: ScheduledJob };
    assert.equal(body.job.enabled, false);
  });

  it("bật LẠI job đang tắt phải qua đúng trần SCHEDULER_MAX_JOBS_PER_THREAD - tạo đủ trần, tắt bớt, tạo thêm rồi bật lại hết phải bị chặn (Mục M4)", async () => {
    const tuning = await import("../../config/runtime-tuning-settings.js");
    tuning.setTuning("SCHEDULER_MAX_JOBS_PER_THREAD", 2);
    try {
      const threadId = "t-m4-cap-enable";
      threadStore.recordThreadActivity({ accountId: ACC, threadId, threadType: 0, displayName: "", lastSenderName: "" });

      const job1 = await taoJob({ threadId, name: "job 1" });
      await taoJob({ threadId, name: "job 2" }); // đủ 2 job bật - chạm trần

      // Tắt job1 để "có chỗ trống" (1 job đang bật), rồi lấp lại đủ trần bằng job3
      await authed(`/api/schedule/${job1.id}`, {
        method: "PATCH",
        body: JSON.stringify({ accountId: ACC, threadId, enabled: false }),
      });
      await taoJob({ threadId, name: "job 3" }); // lại đủ 2 job bật (job2 + job3)

      // Bật lại job1 -> sẽ thành 3 job bật cùng lúc, vượt trần 2 - PHẢI bị chặn
      const res = await authed(`/api/schedule/${job1.id}`, {
        method: "PATCH",
        body: JSON.stringify({ accountId: ACC, threadId, enabled: true }),
      });
      assert.equal(res.status, 400);
      assert.match((await res.json() as { error: string }).error, /trần/);

      const check = (await (await authed(`/api/schedule?accountId=${ACC}`)).json()) as { items: ScheduledJob[] };
      assert.equal(
        check.items.find((j) => j.id === job1.id)?.enabled,
        false,
        "job1 phải VẪN còn tắt - PATCH bị chặn không được lén bật lên",
      );
    } finally {
      tuning.setTuning("SCHEDULER_MAX_JOBS_PER_THREAD", null);
    }
  });

  it("job không tồn tại -> 404", async () => {
    const res = await authed("/api/schedule/khong-ton-tai", {
      method: "PATCH",
      body: JSON.stringify({ accountId: ACC, threadId: THREAD, name: "x" }),
    });
    assert.equal(res.status, 404);
  });

  it("job của THREAD KHÁC -> 404, không sửa được (IDOR)", async () => {
    const job = await taoJob({ name: "Của thread A" });
    const res = await authed(`/api/schedule/${job.id}`, {
      method: "PATCH",
      body: JSON.stringify({ accountId: ACC, threadId: THREAD_KHAC, name: "Bị đổi trộm" }),
    });
    assert.equal(res.status, 404, "sai threadId phải coi như không tồn tại");

    const check = await authed(`/api/schedule?accountId=${ACC}`);
    const found = ((await check.json()) as { items: ScheduledJob[] }).items.find((j) => j.id === job.id);
    assert.equal(found?.name, "Của thread A", "tên KHÔNG được đổi qua đường IDOR");
  });
});

describe("DELETE /api/schedule/:id", () => {
  it("chưa login -> 401", async () => {
    const job = await taoJob();
    assert.equal((await app.request(`/api/schedule/${job.id}`, { method: "DELETE" })).status, 401);
  });

  it("xóa thành công", async () => {
    const job = await taoJob();
    const res = await authed(`/api/schedule/${job.id}?accountId=${ACC}&threadId=${THREAD}`, { method: "DELETE" });
    assert.equal(res.status, 200);

    const check = await authed(`/api/schedule?accountId=${ACC}`);
    const found = ((await check.json()) as { items: ScheduledJob[] }).items.find((j) => j.id === job.id);
    assert.equal(found, undefined);
  });

  it("job của THREAD KHÁC -> 404, job vẫn còn nguyên (IDOR)", async () => {
    const job = await taoJob();
    const res = await authed(`/api/schedule/${job.id}?accountId=${ACC}&threadId=${THREAD_KHAC}`, {
      method: "DELETE",
    });
    assert.equal(res.status, 404);

    const check = await authed(`/api/schedule?accountId=${ACC}`);
    const found = ((await check.json()) as { items: ScheduledJob[] }).items.find((j) => j.id === job.id);
    assert.ok(found, "job KHÔNG được biến mất qua đường IDOR");
  });
});

describe("POST /api/schedule/:id/run - Chạy thử ngay", () => {
  it("chưa login -> 401", async () => {
    const job = await taoJob();
    assert.equal((await app.request(`/api/schedule/${job.id}/run`, { method: "POST", body: "{}" })).status, 401);
  });

  it("job của THREAD KHÁC -> 404, không chạy thử được (IDOR)", async () => {
    const job = await taoJob();
    const res = await authed(`/api/schedule/${job.id}/run`, {
      method: "POST",
      body: JSON.stringify({ accountId: ACC, threadId: THREAD_KHAC }),
    });
    assert.equal(res.status, 404);
  });

  it("gửi thật NHƯNG next_run_at/enabled/run_count của job KHÔNG đổi, kể cả gửi 2 lần liên tiếp", async () => {
    const sent = attachOnline();
    const job = await taoJob({ name: "Job chạy thử", payload: "Tin chạy thử nghiệm" });

    const runRes1 = await authed(`/api/schedule/${job.id}/run`, {
      method: "POST",
      body: JSON.stringify({ accountId: ACC, threadId: THREAD }),
    });
    assert.equal(runRes1.status, 200);
    const run1 = (await runRes1.json()) as { run: { status: string } | null };
    assert.equal(run1.run?.status, "ok");
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.text, "Tin chạy thử nghiệm");

    const after1 = ((await (await authed(`/api/schedule?accountId=${ACC}`)).json()) as { items: ScheduledJob[] }).items.find(
      (j) => j.id === job.id,
    )!;
    assert.equal(after1.nextRunAt, job.nextRunAt, "next_run_at KHÔNG được đổi sau khi chạy thử");
    assert.equal(after1.enabled, true, "job 'once' KHÔNG được tự tắt sau khi chạy thử (bug: maxRuns=1 dùng hết suất)");
    assert.equal(after1.runCount, 0, "run_count KHÔNG được tăng - đây không phải lần chạy THẬT");

    // Chạy thử lần 2 - vẫn phải gửi được và vẫn không đổi gì
    const runRes2 = await authed(`/api/schedule/${job.id}/run`, {
      method: "POST",
      body: JSON.stringify({ accountId: ACC, threadId: THREAD }),
    });
    assert.equal((await runRes2.json() as { run: { status: string } | null }).run?.status, "ok");
    assert.equal(sent.length, 2, "lần chạy thử thứ 2 vẫn phải gửi được - suất chưa hề bị dùng ở lần 1");

    const after2 = ((await (await authed(`/api/schedule?accountId=${ACC}`)).json()) as { items: ScheduledJob[] }).items.find(
      (j) => j.id === job.id,
    )!;
    assert.equal(after2.nextRunAt, job.nextRunAt);
    assert.equal(after2.enabled, true);
    assert.equal(after2.runCount, 0);
  });

  it("job còn 1 lượt 'running' (tick thật đang dispatch dở, chưa chốt sổ) -> 409, không được chạy thử chồng lên (I3)", async () => {
    const runLogStore = await import("../../scheduler/job-run-log-store.js");
    attachOnline();
    const job = await taoJob({ name: "Job đang chạy dở" });
    const runId = runLogStore.openRun(job.id); // mô phỏng tick thật đã dispatch, chưa finishRun

    const res = await authed(`/api/schedule/${job.id}/run`, {
      method: "POST",
      body: JSON.stringify({ accountId: ACC, threadId: THREAD }),
    });
    assert.equal(res.status, 409);
    assert.match((await res.json() as { error: string }).error, /đang chạy/);

    runLogStore.finishRun(runId, { status: "ok" }); // chốt sổ để không để lại dòng 'running' mồ côi
  });
});

describe("GET /api/schedule/:id/runs", () => {
  it("chưa login -> 401", async () => {
    const job = await taoJob();
    assert.equal((await app.request(`/api/schedule/${job.id}/runs?accountId=${ACC}&threadId=${THREAD}`)).status, 401);
  });

  it("job của THREAD KHÁC -> 404 (IDOR)", async () => {
    const job = await taoJob();
    const res = await authed(`/api/schedule/${job.id}/runs?accountId=${ACC}&threadId=${THREAD_KHAC}`);
    assert.equal(res.status, 404);
  });

  it("trả lịch sử sau khi chạy thử, kèm turn_id null cho job kind=message", async () => {
    attachOnline();
    const job = await taoJob({ name: "Job có lịch sử" });
    await authed(`/api/schedule/${job.id}/run`, {
      method: "POST",
      body: JSON.stringify({ accountId: ACC, threadId: THREAD }),
    });

    const res = await authed(`/api/schedule/${job.id}/runs?accountId=${ACC}&threadId=${THREAD}`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { runs: { status: string; turnId: number | null }[] };
    assert.ok(body.runs.length >= 1);
    assert.equal(body.runs[0]!.status, "ok");
    assert.equal(body.runs[0]!.turnId, null, "kind=message không chạm agent nên không có turn_id");
  });
});
