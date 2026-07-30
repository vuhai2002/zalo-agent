import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
// import type bị xóa lúc chạy nên không kéo module lên trước setupTestEnv
import type { AgentTurnUsage } from "./usage-store.js";

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

/** Lượt trọn vẹn: mở rồi chốt - hai bước tách rời đúng như production */
function ghiLuot(accountId: string, threadId: string, u: AgentTurnUsage): number {
  const turnId = usage.openAgentTurn(accountId, threadId);
  usage.finishAgentTurn(turnId, u);
  return turnId;
}

describe("usage-store", () => {
  it("openAgentTurn không truyền source thì cột source ghi 'message' - lời gọi cũ không phải sửa", () => {
    const turnId = usage.openAgentTurn("acc-source", "t-1");
    const row = database.db.prepare("SELECT source FROM agent_turns WHERE id = ?").get(turnId) as {
      source: string;
    };
    assert.equal(row.source, "message");
  });

  it("openAgentTurn truyền source='schedule' thì ghi đúng giá trị đó", () => {
    const turnId = usage.openAgentTurn("acc-source", "t-1", "schedule");
    const row = database.db.prepare("SELECT source FROM agent_turns WHERE id = ?").get(turnId) as {
      source: string;
    };
    assert.equal(row.source, "schedule");
  });

  it("ghi và tổng hợp usage theo thread", () => {
    ghiLuot("acc-1", "t-1", { inputTokens: 100, outputTokens: 20, totalTokens: 120, steps: 1 });
    ghiLuot("acc-1", "t-1", { inputTokens: 200, outputTokens: 30, totalTokens: 230, steps: 3 });
    ghiLuot("acc-1", "t-khac", { inputTokens: 50, outputTokens: 5, totalTokens: 55, steps: 1 });

    const totals = usage.getThreadUsageTotals("acc-1", "t-1");
    assert.equal(totals.turns, 2);
    assert.equal(totals.totalTokens, 350);
  });

  it("thread chưa có lượt nào trả về 0", () => {
    const totals = usage.getThreadUsageTotals("acc-1", "t-trong");
    assert.deepEqual(totals, { turns: 0, totalTokens: 0 });
  });

  it("thống kê theo ngày gộp đúng và lọc theo account", () => {
    ghiLuot("acc-daily", "t-1", { inputTokens: 10, outputTokens: 1, totalTokens: 11, steps: 1 });
    ghiLuot("acc-daily", "t-2", { inputTokens: 20, outputTokens: 2, totalTokens: 22, steps: 1 });

    const days = usage.getDailyUsage("acc-daily", "2000-01-01", "Asia/Ho_Chi_Minh");
    assert.equal(days.length, 1); // cùng ngày hôm nay
    assert.equal(days[0]!.turns, 2);
    assert.equal(days[0]!.inputTokens, 30);
    assert.equal(days[0]!.outputTokens, 3);

    // Mốc since ở tương lai -> không có gì
    assert.equal(usage.getDailyUsage("acc-daily", "2999-01-01", "Asia/Ho_Chi_Minh").length, 0);
  });

  it("gom theo ngày VN, không phải ngày UTC - đúng bug overview đang vá", () => {
    // Chèn thẳng qua db (không qua openAgentTurn) để ép created_at về đúng mốc
    // 20:00Z 30/07 = 03:00 sáng 31/07 giờ VN. substr(created_at,1,10) kiểu cũ
    // sẽ gom vào '2026-07-30'; dayKeyOf phải gom đúng vào ngày VN '2026-07-31'.
    const insertAt = database.db.prepare(`
      INSERT INTO agent_turns (account_id, thread_id, input_tokens, output_tokens, total_tokens, steps, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertAt.run("acc-vn-boundary", "t-1", 5, 1, 6, 1, "2026-07-30T20:00:00.000Z");

    const daysVn = usage.getDailyUsage("acc-vn-boundary", "2000-01-01", "Asia/Ho_Chi_Minh");
    assert.equal(daysVn.length, 1);
    assert.equal(daysVn[0]!.day, "2026-07-31");

    const daysUtc = usage.getDailyUsage("acc-vn-boundary", "2000-01-01", "UTC");
    assert.equal(daysUtc[0]!.day, "2026-07-30");
  });
});
