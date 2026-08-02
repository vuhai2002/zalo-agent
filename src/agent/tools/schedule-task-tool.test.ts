import assert from "node:assert/strict";
import { loiCuaTool } from "./tool-failure-result-test-helper.js";
import { after, before, describe, it } from "node:test";
import { DateTime } from "luxon";
import type { API } from "zca-js";
import { fakeAgentProfile } from "../../shared/fake-agent-profile.js";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";
import type { ParsedMessage } from "../../zalo/zalo-message-parser.js";

// Mốc "once" phải luôn ở TƯƠNG LAI so với giờ chạy test thật (parseSchedule từ
// chối mốc quá khứ) - +7 ngày cách xa hiện tại đủ để không tự "hết hạn" theo
// thời gian, khác bản cũ hardcode "2026-08-01" từng tự rơi vào quá khứ đúng
// ngày đó và làm test đỏ vĩnh viễn từ hôm sau.
const ONCE_TEST_MOMENT = DateTime.now()
  .setZone("Asia/Ho_Chi_Minh")
  .plus({ days: 7 })
  .set({ minute: 0, second: 0, millisecond: 0 });
const ONCE_TEST_DATE = ONCE_TEST_MOMENT.toFormat("yyyy-LL-dd");
const ONCE_TEST_TIME = ONCE_TEST_MOMENT.toFormat("HH:mm");
const ONCE_TEST_DATE_VN = ONCE_TEST_MOMENT.toFormat("dd/LL/yyyy");
const ONCE_TEST_RUN_AT_UTC = ONCE_TEST_MOMENT.toUTC().toJSDate().toISOString();

// Kéo theo env + DB nên phải setupTestEnv trước, import động sau
let dataDir: string;
let toolModule: typeof import("./schedule-task-tool.js");
let store: typeof import("../../scheduler/scheduled-job-store.js");
let tuning: typeof import("../../config/runtime-tuning-settings.js");
let database: typeof import("../../conversation/database.js");
type ToolContext = import("./tool-registry.js").ToolContext;

before(async () => {
  dataDir = setupTestEnv();
  toolModule = await import("./schedule-task-tool.js");
  store = await import("../../scheduler/scheduled-job-store.js");
  tuning = await import("../../config/runtime-tuning-settings.js");
  database = await import("../../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

function msg(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    accountId: "acc-1",
    threadId: "t-1",
    threadType: 1,
    isGroup: true,
    senderId: "u-1",
    senderName: "Hải",
    text: "",
    images: [],
    msgId: "m1",
    cliMsgId: "c1",
    isSelf: false,
    mentionsMe: true,
    rawData: {},
    ...overrides,
  };
}

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    api: {} as API,
    account: {
      id: "acc-1",
      label: "Test",
      enabled: true,
      agentId: "agent-test",
      allowlist: { mode: "all" as const, userIds: [] },
      groupRequireMention: true,
      respondToGroups: true,
      groupPassiveListen: true,
      autoReactEnabled: true,
      autoReactIcon: "heart",
      typingIndicatorEnabled: true,
      disabledTools: [],
    },
    agent: fakeAgentProfile(),
    message: msg(),
    batch: [],
    ...overrides,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const run = (ctx: ToolContext, input: unknown): Promise<string> =>
  (toolModule.createScheduleTaskTool(ctx) as any).execute(input, {});

describe("schedule_task - action create", () => {
  it("once date+time quy đổi đúng UTC (BOT_TIMEZONE mặc định Asia/Ho_Chi_Minh), không phụ thuộc TZ tiến trình", async () => {
    const originalTz = process.env.TZ;
    try {
      for (const tz of ["UTC", "America/New_York"]) {
        process.env.TZ = tz;
        const ctx = makeCtx({ message: msg({ threadId: `t-once-${tz}` }) });
        const result = await run(ctx, {
          action: "create",
          name: "Nhắc họp",
          kind: "message",
          payload: "Họp với anh Nam",
          schedule: { kind: "once", date: ONCE_TEST_DATE, time: ONCE_TEST_TIME },
        });

        const [job] = store.listJobsForThread("acc-1", `t-once-${tz}`);
        assert.equal(job?.runAt, ONCE_TEST_RUN_AT_UTC, `TZ=${tz} phải ra đúng cùng 1 mốc UTC`);
        assert.match(
          result,
          new RegExp(`${ONCE_TEST_TIME} ngày ${ONCE_TEST_DATE_VN.replace(/\//g, "\\/")}`),
          "phải đọc lại đúng mốc giờ cho người dùng xác nhận",
        );
      }
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });

  it("kind='agent' lưu đúng payload là prompt, trả về id để list/cancel sau này dùng", async () => {
    const ctx = makeCtx({ message: msg({ threadId: "t-agent" }) });
    const result = await run(ctx, {
      action: "create",
      name: "Báo cáo sáng",
      kind: "agent",
      payload: "Tóm tắt tin công nghệ nổi bật hôm nay",
      schedule: { kind: "every", minutes: 60 },
    });

    const [job] = store.listJobsForThread("acc-1", "t-agent");
    assert.equal(job?.kind, "agent");
    assert.equal(job?.payload, "Tóm tắt tin công nghệ nổi bật hôm nay");
    assert.match(result, new RegExp(job!.id));
  });

  it("job ghim cứng vào (accountId, threadId) của người tạo - không có tham số đích khác", async () => {
    const ctx = makeCtx({ message: msg({ threadId: "t-pin", senderId: "u-pin" }) });
    await run(ctx, {
      action: "create",
      name: "x",
      kind: "message",
      payload: "y",
      schedule: { kind: "every", minutes: 30 },
    });

    const [job] = store.listJobsForThread("acc-1", "t-pin");
    assert.equal(job?.accountId, "acc-1");
    assert.equal(job?.threadId, "t-pin");
    assert.equal(job?.createdBy, "u-pin");
  });

  it("người NGOÀI allowlist bị từ chối tạo lịch - job không được lưu", async () => {
    const ctx = makeCtx({
      account: { ...makeCtx().account, allowlist: { mode: "list", userIds: ["u-duoc-phep"] } },
      message: msg({ threadId: "t-allowlist-tu-choi", senderId: "u-la" }),
    });

    const result = await run(ctx, {
      action: "create",
      name: "x",
      kind: "message",
      payload: "y",
      schedule: { kind: "every", minutes: 30 },
    });

    assert.match(loiCuaTool(result), /allowlist|danh sách được phép/i);
    assert.equal(store.listJobsForThread("acc-1", "t-allowlist-tu-choi").length, 0, "không được tạo job nào");
  });

  it("người TRONG allowlist tạo được lịch bình thường", async () => {
    const ctx = makeCtx({
      account: { ...makeCtx().account, allowlist: { mode: "list", userIds: ["u-duoc-phep"] } },
      message: msg({ threadId: "t-allowlist-ok", senderId: "u-duoc-phep" }),
    });

    await run(ctx, {
      action: "create",
      name: "x",
      kind: "message",
      payload: "y",
      schedule: { kind: "every", minutes: 30 },
    });

    assert.equal(store.listJobsForThread("acc-1", "t-allowlist-ok").length, 1);
  });

  it("chạm trần SCHEDULER_MAX_JOBS_PER_THREAD job đang bật thì bị từ chối", async () => {
    tuning.setTuning("SCHEDULER_MAX_JOBS_PER_THREAD", 2);
    try {
      const ctx = makeCtx({ message: msg({ threadId: "t-cap" }) });
      const create = (name: string) =>
        run(ctx, { action: "create", name, kind: "message", payload: "p", schedule: { kind: "every", minutes: 30 } });

      await create("job 1");
      await create("job 2");
      const ketQua = await create("job 3 - phải bị chặn");

      assert.match(loiCuaTool(ketQua), /trần|chạm|đủ 2/i);
      assert.equal(store.listJobsForThread("acc-1", "t-cap").length, 2, "job thứ 3 không được lưu");
    } finally {
      tuning.setTuning("SCHEDULER_MAX_JOBS_PER_THREAD", null);
    }
  });

  it("job đã TẮT không tính vào trần - hủy bớt rồi vẫn tạo lại được", async () => {
    tuning.setTuning("SCHEDULER_MAX_JOBS_PER_THREAD", 1);
    try {
      const ctx = makeCtx({ message: msg({ threadId: "t-cap-tat" }) });
      await run(ctx, {
        action: "create",
        name: "job 1",
        kind: "message",
        payload: "p",
        schedule: { kind: "every", minutes: 30 },
      });
      const [job1] = store.listJobsForThread("acc-1", "t-cap-tat");
      store.setEnabled("acc-1", "t-cap-tat", job1!.id, false);

      const ketQua = await run(ctx, {
        action: "create",
        name: "job 2",
        kind: "message",
        payload: "p",
        schedule: { kind: "every", minutes: 30 },
      });
      assert.doesNotMatch(ketQua, /trần|chạm/i, "job đã tắt không được tính vào trần");
    } finally {
      tuning.setTuning("SCHEDULER_MAX_JOBS_PER_THREAD", null);
    }
  });

  it("lịch không hợp lệ (every quá dày) trả câu lỗi có chữ, KHÔNG throw, không lưu job", async () => {
    const ctx = makeCtx({ message: msg({ threadId: "t-invalid-every" }) });
    const result = await run(ctx, {
      action: "create",
      name: "x",
      kind: "message",
      payload: "y",
      schedule: { kind: "every", minutes: 1 },
    });

    assert.match(loiCuaTool(result), /tối thiểu|spam/i);
    assert.equal(store.listJobsForThread("acc-1", "t-invalid-every").length, 0);
  });

  it("lịch once đã ở quá khứ trả câu lỗi có chữ, không lưu job", async () => {
    const ctx = makeCtx({ message: msg({ threadId: "t-invalid-past" }) });
    const result = await run(ctx, {
      action: "create",
      name: "x",
      kind: "message",
      payload: "y",
      schedule: { kind: "once", date: "2020-01-01", time: "08:00" },
    });

    assert.match(loiCuaTool(result), /quá khứ/);
    assert.equal(store.listJobsForThread("acc-1", "t-invalid-past").length, 0);
  });
});

describe("schedule_task - action list", () => {
  it("chỉ liệt kê job của đúng thread, không lẫn thread khác", async () => {
    const ctxA = makeCtx({ message: msg({ threadId: "t-list-a" }) });
    const ctxB = makeCtx({ message: msg({ threadId: "t-list-b" }) });
    await run(ctxA, { action: "create", name: "A1", kind: "message", payload: "p", schedule: { kind: "every", minutes: 30 } });
    await run(ctxB, { action: "create", name: "B1", kind: "message", payload: "p", schedule: { kind: "every", minutes: 30 } });

    const result = await run(ctxA, { action: "list" });
    assert.match(result, /A1/);
    assert.doesNotMatch(result, /B1/, "không được thấy job của thread khác");
  });

  it("thread chưa có job nào thì trả câu rõ ràng, không phải chuỗi rỗng", async () => {
    const ctx = makeCtx({ message: msg({ threadId: "t-list-rong" }) });
    const result = await run(ctx, { action: "list" });
    assert.match(result, /chưa có lịch/i);
  });
});

describe("schedule_task - action cancel", () => {
  it("hủy đúng job của thread mình - job biến mất khỏi list", async () => {
    const ctx = makeCtx({ message: msg({ threadId: "t-cancel-ok" }) });
    await run(ctx, { action: "create", name: "x", kind: "message", payload: "p", schedule: { kind: "every", minutes: 30 } });
    const [job] = store.listJobsForThread("acc-1", "t-cancel-ok");

    const result = await run(ctx, { action: "cancel", id: job!.id });
    assert.match(result, /Đã hủy/);
    assert.equal(store.listJobsForThread("acc-1", "t-cancel-ok").length, 0);
  });

  it("hủy job của THREAD KHÁC bị từ chối - job vẫn còn nguyên (chặn IDOR ở tầng store)", async () => {
    const ctxOwner = makeCtx({ message: msg({ threadId: "t-cancel-chu" }) });
    await run(ctxOwner, {
      action: "create",
      name: "job của chủ",
      kind: "message",
      payload: "p",
      schedule: { kind: "every", minutes: 30 },
    });
    const [job] = store.listJobsForThread("acc-1", "t-cancel-chu");

    const ctxKhac = makeCtx({ message: msg({ threadId: "t-cancel-la" }) });
    const result = await run(ctxKhac, { action: "cancel", id: job!.id });

    assert.match(loiCuaTool(result), /Không tìm thấy/);
    assert.equal(store.getJob("acc-1", "t-cancel-chu", job!.id)?.id, job!.id, "job của chủ vẫn còn nguyên");
  });

  it("id không tồn tại trả câu rõ ràng, không throw", async () => {
    const ctx = makeCtx({ message: msg({ threadId: "t-cancel-khong-ton-tai" }) });
    const result = await run(ctx, { action: "cancel", id: "khong-ton-tai" });
    assert.match(loiCuaTool(result), /Không tìm thấy/);
  });
});

describe("schedule_task - action update", () => {
  it("sửa payload và lịch - đọc lại thấy đúng giá trị mới", async () => {
    const ctx = makeCtx({ message: msg({ threadId: "t-update-ok" }) });
    await run(ctx, {
      action: "create",
      name: "cũ",
      kind: "message",
      payload: "nội dung cũ",
      schedule: { kind: "every", minutes: 30 },
    });
    const [job] = store.listJobsForThread("acc-1", "t-update-ok");

    const result = await run(ctx, {
      action: "update",
      id: job!.id,
      payload: "nội dung mới",
      schedule: { kind: "every", minutes: 60 },
    });

    assert.match(result, /Đã cập nhật/);
    const sau = store.getJob("acc-1", "t-update-ok", job!.id)!;
    assert.equal(sau.payload, "nội dung mới");
    assert.equal(sau.everyMinutes, 60);
  });

  it("sửa job của THREAD KHÁC bị từ chối - job vẫn còn nguyên giá trị cũ", async () => {
    const ctxOwner = makeCtx({ message: msg({ threadId: "t-update-chu" }) });
    await run(ctxOwner, {
      action: "create",
      name: "cũ",
      kind: "message",
      payload: "nội dung cũ",
      schedule: { kind: "every", minutes: 30 },
    });
    const [job] = store.listJobsForThread("acc-1", "t-update-chu");

    const ctxKhac = makeCtx({ message: msg({ threadId: "t-update-la" }) });
    const result = await run(ctxKhac, { action: "update", id: job!.id, payload: "bị đổi trái phép" });

    assert.match(loiCuaTool(result), /Không tìm thấy/);
    assert.equal(store.getJob("acc-1", "t-update-chu", job!.id)?.payload, "nội dung cũ");
  });

  it("đổi sang lịch không hợp lệ thì báo lỗi, KHÔNG áp phần thay đổi khác (all-or-nothing)", async () => {
    const ctx = makeCtx({ message: msg({ threadId: "t-update-invalid" }) });
    await run(ctx, {
      action: "create",
      name: "cũ",
      kind: "message",
      payload: "nội dung cũ",
      schedule: { kind: "every", minutes: 30 },
    });
    const [job] = store.listJobsForThread("acc-1", "t-update-invalid");

    const result = await run(ctx, {
      action: "update",
      id: job!.id,
      payload: "nội dung mới lẽ ra không được áp dụng",
      schedule: { kind: "every", minutes: 1 },
    });

    assert.match(loiCuaTool(result), /tối thiểu|spam/i);
    const sau = store.getJob("acc-1", "t-update-invalid", job!.id)!;
    assert.equal(sau.payload, "nội dung cũ", "lịch hỏng thì payload cũng không được đổi");
    assert.equal(sau.everyMinutes, 30);
  });
});

describe("schedule_task - schema đầu vào (đi qua inputSchema thật)", () => {
  const parse = (input: unknown) => (toolModule.createScheduleTaskTool(makeCtx()) as any).inputSchema.safeParse(input);

  it("action lạ bị chặn ngay ở schema", () => {
    assert.equal(parse({ action: "delete" }).success, false);
  });

  it("create thiếu schedule bị chặn ngay ở schema", () => {
    assert.equal(parse({ action: "create", name: "x", kind: "message", payload: "y" }).success, false);
  });

  it("schedule.kind='once' nhận cả 2 dạng date+time và inMinutes (không phải discriminatedUnion, không ném lỗi)", () => {
    assert.equal(
      parse({
        action: "create",
        name: "x",
        kind: "message",
        payload: "y",
        schedule: { kind: "once", date: "2026-08-01", time: "15:00" },
      }).success,
      true,
    );
    assert.equal(
      parse({
        action: "create",
        name: "x",
        kind: "message",
        payload: "y",
        schedule: { kind: "once", inMinutes: 30 },
      }).success,
      true,
    );
  });

  it("cancel thiếu id bị chặn ngay ở schema", () => {
    assert.equal(parse({ action: "cancel" }).success, false);
  });

  it("inMinutes vượt trần 525600 (1 năm) bị chặn ngay ở schema, không lọt xuống tới new Date() gây RangeError (Mục M3)", () => {
    assert.equal(
      parse({
        action: "create",
        name: "x",
        kind: "message",
        payload: "y",
        schedule: { kind: "once", inMinutes: 999_999_999 },
      }).success,
      false,
    );
  });
});
