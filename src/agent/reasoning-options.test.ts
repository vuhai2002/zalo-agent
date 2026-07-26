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
    assert.equal(ROUTER_PROVIDER_OPTIONS_KEY, "llm-router");
  });
});
