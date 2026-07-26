import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

// agent-loop kéo theo env + DB (qua các store) nên setupTestEnv trước, import động sau
let dataDir: string;
let loop: typeof import("./agent-loop.js");

before(async () => {
  dataDir = setupTestEnv();
  loop = await import("./agent-loop.js");
});

after(async () => {
  const { closeDatabase } = await import("../conversation/database.js");
  closeDatabase();
  cleanupTestEnv(dataDir);
});

describe("isEmptyRouterCompletion", () => {
  it("chữ ký glitch 9Router: text rỗng + không tool call + 0 token", () => {
    assert.equal(
      loop.isEmptyRouterCompletion({ text: "", toolCallCount: 0, totalTokens: 0 }),
      true,
    );
    assert.equal(
      loop.isEmptyRouterCompletion({ text: "   ", toolCallCount: 0, totalTokens: 0 }),
      true,
    );
  });

  it("lượt chỉ thả reaction hợp lệ KHÔNG bị coi là glitch (có tool call + token)", () => {
    assert.equal(
      loop.isEmptyRouterCompletion({ text: "", toolCallCount: 1, totalTokens: 850 }),
      false,
    );
  });

  it("lượt trả lời bình thường không phải glitch", () => {
    assert.equal(
      loop.isEmptyRouterCompletion({ text: "Chào bạn", toolCallCount: 0, totalTokens: 1200 }),
      false,
    );
  });

  it("text rỗng nhưng CÓ token: model thật sự chọn im lặng - không phải glitch, không retry oan", () => {
    assert.equal(
      loop.isEmptyRouterCompletion({ text: "", toolCallCount: 0, totalTokens: 900 }),
      false,
    );
  });
});
