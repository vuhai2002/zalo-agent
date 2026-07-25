import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let usage: typeof import("./usage-store.js");
let database: typeof import("./database.js");

before(async () => {
  dataDir = setupTestEnv();
  usage = await import("./usage-store.js");
  database = await import("./database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

describe("usage-store", () => {
  it("ghi và tổng hợp usage theo thread", () => {
    usage.recordAgentTurn("acc-1", "t-1", { inputTokens: 100, outputTokens: 20, totalTokens: 120, steps: 1 });
    usage.recordAgentTurn("acc-1", "t-1", { inputTokens: 200, outputTokens: 30, totalTokens: 230, steps: 3 });
    usage.recordAgentTurn("acc-1", "t-khac", { inputTokens: 50, outputTokens: 5, totalTokens: 55, steps: 1 });

    const totals = usage.getThreadUsageTotals("acc-1", "t-1");
    assert.equal(totals.turns, 2);
    assert.equal(totals.totalTokens, 350);
  });

  it("thread chưa có lượt nào trả về 0", () => {
    const totals = usage.getThreadUsageTotals("acc-1", "t-trong");
    assert.deepEqual(totals, { turns: 0, totalTokens: 0 });
  });

  it("thống kê theo ngày gộp đúng và lọc theo account", () => {
    usage.recordAgentTurn("acc-daily", "t-1", { inputTokens: 10, outputTokens: 1, totalTokens: 11, steps: 1 });
    usage.recordAgentTurn("acc-daily", "t-2", { inputTokens: 20, outputTokens: 2, totalTokens: 22, steps: 1 });

    const days = usage.getDailyUsage("acc-daily", "2000-01-01");
    assert.equal(days.length, 1); // cùng ngày hôm nay
    assert.equal(days[0]!.turns, 2);
    assert.equal(days[0]!.inputTokens, 30);
    assert.equal(days[0]!.outputTokens, 3);

    // Mốc since ở tương lai -> không có gì
    assert.equal(usage.getDailyUsage("acc-daily", "2999-01-01").length, 0);
  });
});
