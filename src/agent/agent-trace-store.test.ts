import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import { traceLuotHong } from "./failed-turn-trace.js";
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
    attempt: 1,
    text: `noi gi do ${n}`,
    reasoning: "",
    toolCalls: [],
    toolResults: [],
    toolErrors: [],
    finishReason: "stop",
    warnings: [],
    inputTokens: 100 * n,
    outputTokens: 10 * n,
    ...extra,
  };
}

/** Một lượt trọn vẹn: mở lượt rồi chốt usage - đúng đường production đi */
function ghiLuot(threadId = "t-1", steps = 2): number {
  const turnId = usage.openAgentTurn("acc-1", threadId);
  usage.finishAgentTurn(turnId, {
    inputTokens: 1000,
    outputTokens: 100,
    totalTokens: 1100,
    steps,
  });
  return turnId;
}

describe("openAgentTurn trả về id để nối trace", () => {
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
    const b = ghiLuot("t-KHAC", 1);
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
    const b = ghiLuot("t-KHAC", 1);
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

/**
 * Lỗi tool phải sống sót qua vòng ghi-đọc DB. Cột `tool_errors` thêm bằng ALTER
 * nên dòng ghi trước khi có cột đọc ra chuỗi mặc định '[]', không phải NULL.
 */
describe("saveTurnTrace - lần chạy lại", () => {
  it("giữ đúng attempt và xếp lần 1 trước lần 2, không trộn theo step_number", () => {
    const turnId = ghiLuot("t-retry", 2);
    // Lượt có retry: mỗi lần chạy đánh số step lại từ 1
    store.saveTurnTrace(turnId, [
      buoc(1, { attempt: 1 }),
      buoc(2, { attempt: 1 }),
      buoc(1, { attempt: 2 }),
    ]);

    const doc = store.getTurnTrace(turnId);
    assert.deepEqual(
      doc.map((s) => [s.attempt, s.stepNumber]),
      [
        [1, 1],
        [1, 2],
        [2, 1],
      ],
      "xếp theo step_number đơn thuần sẽ ra 1,1,2 - đọc như model lặp",
    );
  });

  it("dòng ghi trước khi có cột attempt đọc ra 1, không phải undefined", () => {
    const turnId = ghiLuot("t-cu", 1);
    database.db
      .prepare("INSERT INTO agent_steps (turn_id, step_number, text) VALUES (?, 1, 'cu')")
      .run(turnId);
    assert.equal(store.getTurnTrace(turnId)[0]!.attempt, 1);
  });
});

describe("saveTurnTrace - lỗi tool", () => {
  it("ghi và đọc lại được lỗi tool", () => {
    const turnId = ghiLuot("thread-loi", 1);
    store.saveTurnTrace(turnId, [
      buoc(1, { toolErrors: [{ name: "create_image", error: "prompt vượt 4000 ký tự" }] }),
    ]);
    const doc = store.getTurnTrace(turnId);
    assert.deepEqual(doc[0]!.toolErrors, [{ name: "create_image", error: "prompt vượt 4000 ký tự" }]);
  });

  it("dòng cũ không có lỗi tool đọc ra mảng rỗng, không phải undefined", () => {
    const turnId = ghiLuot("thread-cu", 1);
    store.saveTurnTrace(turnId, [buoc(1)]);
    assert.deepEqual(store.getTurnTrace(turnId)[0]!.toolErrors, []);
  });
});

describe("lượt hỏng trước khi chạy step nào vẫn lên được trang Trace", () => {
  it("có trace tổng hợp thì lên danh sách VÀ bấm vào đọc được lý do", () => {
    // INNER JOIN sang agent_steps là CỐ Ý (ca ngay trên canh điều đó). Nên cách
    // để lượt chết ngay lần gọi đầu không biến mất là cho nó CÓ trace, chứ không
    // phải nới JOIN - nới thì chỉ đổi "biến mất" thành "bấm vào rỗng".
    const id = ghiLuot();
    store.saveTurnTrace(id, [
      traceLuotHong({ loai: "loi-provider", loai_loi: "cau_hinh", thongDiep: "Chưa cấu hình model" }),
    ]);

    const luot = store.getRecentTurnsAllThreads(10);
    assert.ok(luot.some((l) => l.id === id), "lượt hỏng phải lên danh sách");

    const buoc = store.getTurnTrace(id);
    assert.equal(buoc.length, 1);
    assert.equal(buoc[0]!.finishReason, "error:cau_hinh");
    assert.match(buoc[0]!.text, /Chưa cấu hình model/);
  });

  it("ba loại lượt hỏng phân biệt được bằng finishReason", () => {
    // Trước đây cả ba chỉ để lại một dòng log; trên UI nhìn y hệt nhau (hoặc
    // y hệt một lượt thành công, với ca chặn rò prompt).
    const ma = [
      traceLuotHong({ loai: "loi-provider", loai_loi: "auth", thongDiep: "x" }).finishReason,
      traceLuotHong({ loai: "guard-chan", ma: "loi-giong-het", thongDiep: "y" }).finishReason,
      traceLuotHong({ loai: "chan-ro-prompt" }).finishReason,
    ];
    assert.deepEqual(ma, ["error:auth", "blocked:loi-giong-het", "blocked:prompt-leak"]);
    assert.equal(new Set(ma).size, 3);
  });
});
