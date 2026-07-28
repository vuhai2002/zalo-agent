import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import type { StepTrace } from "./agent-step-trace.js";

let dataDir: string;
let store: typeof import("./agent-trace-store.js");
let usage: typeof import("../conversation/usage-store.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv({ AGENT_TRACE_RETENTION_DAYS: "7" });
  store = await import("./agent-trace-store.js");
  usage = await import("../conversation/usage-store.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(() => {
  // Dọn cả `threads`: test tên hiển thị chèn thread, không dọn thì test sau
  // thấy tên sót lại của test trước
  database.db.exec("DELETE FROM agent_steps; DELETE FROM agent_turns; DELETE FROM threads;");
});

function buoc(n: number, extra: Partial<StepTrace> = {}): StepTrace {
  return {
    stepNumber: n,
    text: `noi gi do ${n}`,
    reasoning: "",
    toolCalls: [],
    toolResults: [],
    finishReason: "stop",
    warnings: [],
    inputTokens: 100 * n,
    outputTokens: 10 * n,
    ...extra,
  };
}

function ghiLuot(): number {
  return usage.recordAgentTurn("acc-1", "t-1", {
    inputTokens: 1000,
    outputTokens: 100,
    totalTokens: 1100,
    steps: 2,
  });
}

describe("recordAgentTurn trả về id để nối trace", () => {
  it("id là số dương và tăng dần", () => {
    const a = ghiLuot();
    const b = ghiLuot();
    assert.ok(a > 0);
    assert.ok(b > a, "lượt sau phải có id lớn hơn");
  });
});

describe("agent-trace-store", () => {
  it("lưu rồi đọc lại đúng thứ tự step", () => {
    const turnId = ghiLuot();
    store.saveTurnTrace(turnId, [buoc(1), buoc(2), buoc(3)]);

    const doc = store.getTurnTrace(turnId);
    assert.deepEqual(
      doc.map((s) => s.stepNumber),
      [1, 2, 3],
    );
    assert.equal(doc[0]!.text, "noi gi do 1");
  });

  it("giữ nguyên toolCalls, warnings, reasoning qua vòng lưu/đọc", () => {
    const turnId = ghiLuot();
    store.saveTurnTrace(turnId, [
      buoc(1, {
        reasoning: "Ta cần cộng 2 và 3",
        toolCalls: [{ name: "create_image", input: '{"mode":"ve_moi"}' }],
        toolResults: [{ name: "create_image", output: "Đã vẽ và GỬI ảnh" }],
        warnings: ["unsupported-setting - size"],
      }),
    ]);

    const s = store.getTurnTrace(turnId)[0]!;
    assert.equal(s.reasoning, "Ta cần cộng 2 và 3");
    assert.deepEqual(s.toolCalls, [{ name: "create_image", input: '{"mode":"ve_moi"}' }]);
    assert.deepEqual(s.toolResults, [{ name: "create_image", output: "Đã vẽ và GỬI ảnh" }]);
    assert.deepEqual(s.warnings, ["unsupported-setting - size"]);
  });

  it("lượt không có step nào thì không ghi gì, không throw", () => {
    const turnId = ghiLuot();
    store.saveTurnTrace(turnId, []);
    assert.deepEqual(store.getTurnTrace(turnId), []);
  });

  it("đọc trace của lượt không tồn tại trả mảng rỗng", () => {
    assert.deepEqual(store.getTurnTrace(999999), []);
  });

  it("liệt kê các lượt gần đây của thread kèm số step - cho dashboard", () => {
    const a = ghiLuot();
    store.saveTurnTrace(a, [buoc(1), buoc(2)]);
    const b = ghiLuot();
    store.saveTurnTrace(b, [buoc(1)]);

    const luot = store.getRecentTurns("acc-1", "t-1", 10);
    assert.equal(luot.length, 2);
    assert.equal(luot[0]!.id, b, "mới nhất đứng đầu");
    assert.equal(luot[0]!.stepCount, 1);
    assert.equal(luot[1]!.stepCount, 2);
  });

  it("thread khác không lẫn vào nhau", () => {
    const a = ghiLuot();
    store.saveTurnTrace(a, [buoc(1)]);
    const b = usage.recordAgentTurn("acc-1", "t-KHAC", {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      steps: 1,
    });
    store.saveTurnTrace(b, [buoc(1)]);

    assert.equal(store.getRecentTurns("acc-1", "t-1", 10).length, 1);
  });
});

describe("liệt kê lượt toàn hệ thống - cho trang Trace ở sidebar", () => {
  it("gộp lượt của MỌI thread, mới nhất đứng đầu, kèm tên hiển thị", () => {
    database.db
      .prepare(
        `INSERT INTO threads (account_id, thread_id, thread_type, display_name, message_count)
         VALUES ('acc-1', 't-1', 0, 'Anh Hải', 5)`,
      )
      .run();

    const a = ghiLuot();
    store.saveTurnTrace(a, [buoc(1)]);
    const b = usage.recordAgentTurn("acc-1", "t-KHAC", {
      inputTokens: 5,
      outputTokens: 5,
      totalTokens: 10,
      steps: 1,
    });
    store.saveTurnTrace(b, [buoc(1), buoc(2)]);

    const luot = store.getRecentTurnsAllThreads(10);

    assert.equal(luot.length, 2);
    assert.equal(luot[0]!.id, b, "mới nhất đứng đầu");
    assert.equal(luot[0]!.threadId, "t-KHAC");
    assert.equal(luot[0]!.stepCount, 2);
    assert.equal(luot[1]!.displayName, "Anh Hải", "thread có tên thì hiện tên");
  });

  it("thread chưa có tên thì rơi về threadId, không để trống", () => {
    const a = ghiLuot();
    store.saveTurnTrace(a, [buoc(1)]);
    assert.equal(store.getRecentTurnsAllThreads(10)[0]!.displayName, "t-1");
  });

  it("CHỈ liệt kê lượt CÓ trace - lượt không trace lên danh sách là bấm vào rỗng", () => {
    ghiLuot(); // không lưu trace
    const b = ghiLuot();
    store.saveTurnTrace(b, [buoc(1)]);

    const luot = store.getRecentTurnsAllThreads(10);
    assert.equal(luot.length, 1);
    assert.equal(luot[0]!.id, b);
  });
});

describe("dọn trace cũ - trace phình nhanh hơn mọi bảng khác", () => {
  it("xóa trace quá hạn, GIỮ trace còn hạn", () => {
    const cu = ghiLuot();
    store.saveTurnTrace(cu, [buoc(1)]);
    const moi = ghiLuot();
    store.saveTurnTrace(moi, [buoc(1)]);

    // Lùi ngày tường minh thay vì chờ thời gian trôi (bài học test chập chờn)
    const muoiNgayTruoc = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    database.db.prepare("UPDATE agent_steps SET created_at = ? WHERE turn_id = ?").run(muoiNgayTruoc, cu);

    const xoa = store.pruneOldTraces(7);

    assert.equal(xoa, 1);
    assert.deepEqual(store.getTurnTrace(cu), [], "trace 10 ngày tuổi phải bị dọn");
    assert.equal(store.getTurnTrace(moi).length, 1, "trace còn hạn phải được giữ");
  });
});
