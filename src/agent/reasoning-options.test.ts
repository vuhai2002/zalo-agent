import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  reasoningProviderOptions,
  ROUTER_PROVIDER_OPTIONS_KEY,
} from "./reasoning-options.js";

// Module thuần - import tĩnh được, không cần setupTestEnv

describe("reasoningProviderOptions", () => {
  it("openai-compatible: reasoningEffort nằm dưới key đúng tên provider của router", () => {
    const options = reasoningProviderOptions("openai-compatible", "medium");
    assert.deepEqual(options, { [ROUTER_PROVIDER_OPTIONS_KEY]: { reasoningEffort: "medium" } });
  });

  it("openai-compatible + off: bỏ hẳn tham số (mỗi router một kiểu giá trị tắt)", () => {
    assert.equal(reasoningProviderOptions("openai-compatible", "off"), undefined);
  });

  it("anthropic: adaptive thinking + effort", () => {
    assert.deepEqual(reasoningProviderOptions("anthropic", "high"), {
      anthropic: { thinking: { type: "adaptive" }, effort: "high" },
    });
  });

  it("anthropic + off: tắt thinking tường minh, không thả về mặc định của provider", () => {
    assert.deepEqual(reasoningProviderOptions("anthropic", "off"), {
      anthropic: { thinking: { type: "disabled" } },
    });
  });

  it("key router phải khớp name trong createOpenAICompatible - lệch là options bị lờ đi im lặng", () => {
    assert.equal(ROUTER_PROVIDER_OPTIONS_KEY, "llmRouter");
  });

  it("key phải là camelCase - kebab-case làm SDK in cảnh báo deprecated mỗi request", () => {
    assert.ok(!ROUTER_PROVIDER_OPTIONS_KEY.includes("-"), "không được có dấu gạch ngang");
  });
});

/**
 * Gemini chỉ có 4 nấc nghĩ (minimal/low/medium/high) trong khi bot có 5 mức.
 * Gửi giá trị ngoài danh sách là 400 cho CẢ lượt, nên phép quy đổi phải phủ hết.
 */
describe("reasoningProviderOptions - google", () => {
  const muc = (effort: Parameters<typeof reasoningProviderOptions>[1]) =>
    (reasoningProviderOptions("google", effort) as { google: { thinkingConfig: { thinkingLevel: string } } })
      .google.thinkingConfig.thinkingLevel;

  it("ba mức trùng tên đi thẳng", () => {
    assert.equal(muc("low"), "low");
    assert.equal(muc("medium"), "medium");
    assert.equal(muc("high"), "high");
  });

  it('"off" thành "minimal" chứ KHÔNG bỏ tham số - Gemini 3 không tắt hẳn nghĩ được', () => {
    // Bỏ tham số là để model tự chọn mức, đúng thứ mà "off" muốn tránh
    assert.equal(muc("off"), "minimal");
    assert.notEqual(reasoningProviderOptions("google", "off"), undefined);
  });

  it('"xhigh" hạ về "high" - không có nấc nào cao hơn', () => {
    assert.equal(muc("xhigh"), "high");
  });

  it("MỌI mức đều ra giá trị Gemini nhận, không mức nào lọt ra ngoài danh sách", () => {
    const hopLe = new Set(["minimal", "low", "medium", "high"]);
    for (const e of ["off", "low", "medium", "high", "xhigh"] as const) {
      assert.ok(hopLe.has(muc(e)), `mức "${e}" ra "${muc(e)}" - Gemini sẽ trả 400`);
    }
  });

  it("KHÔNG dùng key của router - lệch key là tham số bị lờ đi im lặng", () => {
    const options = reasoningProviderOptions("google", "medium")!;
    assert.ok("google" in options);
    assert.ok(!(ROUTER_PROVIDER_OPTIONS_KEY in options));
  });
});
