import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Hono } from "hono";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";

/** API /api/traces - xem lại từng step của lượt agent trên dashboard */

let dataDir: string;
let app: Hono;
let sessionCookie: string;
let usage: typeof import("../../conversation/usage-store.js");
let traceStore: typeof import("../../agent/agent-trace-store.js");

const PASSWORD = "mat-khau-trace-123";

before(async () => {
  dataDir = setupTestEnv({ DASHBOARD_PASSWORD: PASSWORD });
  const { buildDashboardApp } = await import("../dashboard-server.js");
  app = buildDashboardApp();
  usage = await import("../../conversation/usage-store.js");
  traceStore = await import("../../agent/agent-trace-store.js");

  const login = await app.request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password: PASSWORD }),
    headers: { "content-type": "application/json" },
  });
  sessionCookie = login.headers.get("set-cookie")!.split(";")[0]!;
});

after(async () => {
  const { closeDatabase } = await import("../../conversation/database.js");
  closeDatabase();
  cleanupTestEnv(dataDir);
});

const authed = (path: string) => app.request(path, { headers: { cookie: sessionCookie } });

function taoLuotCoTrace(): number {
  const turnId = usage.openAgentTurn("acc-1", "t-1");
  usage.finishAgentTurn(turnId, {
    inputTokens: 900,
    outputTokens: 120,
    totalTokens: 1020,
    steps: 2,
  });
  traceStore.saveTurnTrace(turnId, [
    {
      stepNumber: 1,
      attempt: 1,
      text: "",
      reasoning: "Cần tra web trước",
      toolCalls: [{ name: "web_search", input: '{"q":"giá vàng"}' }],
      toolResults: [{ name: "web_search", output: "3 kết quả" }],
      toolErrors: [],
      finishReason: "tool-calls",
      warnings: ["unsupported-setting - size"],
      inputTokens: 800,
      outputTokens: 40,
    },
    {
      stepNumber: 2,
      attempt: 1,
      text: "Giá vàng hôm nay là...",
      reasoning: "",
      toolCalls: [],
      toolResults: [],
      toolErrors: [],
      finishReason: "stop",
      warnings: [],
      inputTokens: 100,
      outputTokens: 80,
    },
  ]);
  return turnId;
}

describe("/api/traces", () => {
  it("chưa login -> 401", async () => {
    assert.equal((await app.request("/api/traces/acc-1/t-1")).status, 401);
  });

  it("liệt kê các lượt gần đây của thread", async () => {
    const turnId = taoLuotCoTrace();
    const res = await authed("/api/traces/acc-1/t-1");
    assert.equal(res.status, 200);

    const body = (await res.json()) as { turns: { id: number; stepCount: number }[] };
    assert.ok(body.turns.length >= 1);
    assert.equal(body.turns[0]!.id, turnId);
    assert.equal(body.turns[0]!.stepCount, 2);
  });

  it("đọc trace chi tiết 1 lượt - có tool call, warnings, reasoning", async () => {
    const turnId = taoLuotCoTrace();
    const res = await authed(`/api/traces/turn/${turnId}`);
    assert.equal(res.status, 200);

    const body = (await res.json()) as {
      steps: {
        stepNumber: number;
        reasoning: string;
        toolCalls: { name: string }[];
        warnings: string[];
      }[];
    };
    assert.equal(body.steps.length, 2);
    assert.equal(body.steps[0]!.reasoning, "Cần tra web trước");
    assert.equal(body.steps[0]!.toolCalls[0]!.name, "web_search");
    assert.deepEqual(body.steps[0]!.warnings, ["unsupported-setting - size"]);
  });

  it("turn id không tồn tại trả mảng rỗng, không phải 500", async () => {
    const res = await authed("/api/traces/turn/999999");
    assert.equal(res.status, 200);
    assert.deepEqual(((await res.json()) as { steps: unknown[] }).steps, []);
  });

  it("turn id không phải số -> 400, không đụng DB", async () => {
    assert.equal((await authed("/api/traces/turn/abc")).status, 400);
  });
});
