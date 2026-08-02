import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { API } from "zca-js";
import { fakeAgentProfile } from "../../shared/fake-agent-profile.js";
import { loiCuaTool } from "./tool-failure-result-test-helper.js";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";
import type { ParsedMessage } from "../../zalo/zalo-message-parser.js";

/**
 * Test riêng, CÔ LẬP HẲN 1 FILE - ép nhánh catch bao ngoài của
 * `schedule-task-tool.ts` chạy bằng lỗi SQL THẬT, đúng mẫu đã có sẵn ở
 * `scheduled-job-send.test.ts` (DROP hẳn bảng thay vì mock `node:test`'s
 * `mock.method`, vì named export ESM là binding `configurable:false` một khi
 * có consumer khác đã resolve nó).
 *
 * `scheduled-job-store.ts` `db.prepare(...)` các câu lệnh Ở CẤP MODULE (chạy
 * ngay lúc import, TRƯỚC dòng DROP TABLE ở `before()` dưới đây) - DROP xong
 * các statement đã prepare vẫn còn, nhưng THI HÀNH (`.all()`/`.get()`/`.run()`)
 * sẽ ném lỗi SQL thật ("no such table: scheduled_jobs"), không cần mock gì cả.
 *
 * AN TOÀN vì `setupTestEnv()` tạo `mkdtemp` RIÊNG cho MỖI LẦN GỌI (mỗi file
 * test gọi đúng 1 lần ở `before()`), và `node --test` chạy MỖI FILE một
 * process - phá bảng trong DB của FILE NÀY không đụng gì tới DB của file khác.
 */

let dataDir: string;
let toolModule: typeof import("./schedule-task-tool.js");
let database: typeof import("../../conversation/database.js");
type ToolContext = import("./tool-registry.js").ToolContext;

before(async () => {
  dataDir = setupTestEnv();
  toolModule = await import("./schedule-task-tool.js");
  database = await import("../../conversation/database.js");

  // Mọi câu lệnh chạm bảng scheduled_jobs (listJobsForThread, getJob,
  // createJob...) từ đây trở đi ném lỗi SQL thật.
  database.db.exec("DROP TABLE scheduled_jobs");
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

function makeCtx(): ToolContext {
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
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const run = (ctx: ToolContext, input: unknown): Promise<string> =>
  (toolModule.createScheduleTaskTool(ctx) as any).execute(input, {});

describe("schedule_task - lỗi SQL thật (bảng bị DROP) đi vào nhánh catch bao ngoài", () => {
  it("action='list' đụng bảng đã mất: TRẢ VỀ chuỗi lỗi cho model đọc, KHÔNG throw ra agent loop", async () => {
    // Nếu try/catch của schedule-task-tool.ts sai chỗ hoặc thiếu, `await` ở
    // đây sẽ tự ném lỗi và cả test này fail (không cần assert.rejects riêng)
    const result = await run(makeCtx(), { action: "list" });

    // `loiCuaTool` khẳng định luôn hai điều: KHÔNG ném ra agent loop (tới được
    // dòng này là đã trả về), và nhánh hỏng có đánh dấu để guard đếm được
    const loi = loiCuaTool(result);
    assert.match(loi, /thất bại/i, "phải là câu lỗi đọc được cho model, không phải chuỗi rỗng hay JSON lỗi thô");
    assert.match(
      loi.toLowerCase(),
      /no such table/,
      "lý do phải là lỗi SQL thật (bảng scheduled_jobs đã bị drop), không phải câu chung chung bịa ra",
    );
  });

  it("action='create' cũng qua đúng nhánh catch (bước kiểm trần gọi listJobsForThread trước khi ghi)", async () => {
    const result = await run(makeCtx(), {
      action: "create",
      name: "x",
      kind: "message",
      payload: "y",
      schedule: { kind: "every", minutes: 30 },
    });

    assert.match(loiCuaTool(result).toLowerCase(), /no such table/);
  });
});
