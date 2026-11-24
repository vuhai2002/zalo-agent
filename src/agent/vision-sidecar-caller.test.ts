import assert from "node:assert/strict";
import { describe, it } from "node:test";
// Module thuần (không env/DB) - import tĩnh được
import { taoSidecarCaller } from "./vision-sidecar-caller.js";

const CAI_DAT = { baseUrl: "https://sidecar.test/v1", model: "gemini-3.5-flash-lite", apiKey: "k-test" };
const ANH = { base64: "abc", mediaType: "image/jpeg" };

/** Dựng phản hồi SSE kiểu OpenAI: chữ, chốt, rồi (tùy) một chunk usage riêng */
function phanHoiSse(coUsage: boolean): Response {
  const chunk = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
  const goc = { id: "x", object: "chat.completion.chunk", created: 0, model: CAI_DAT.model };
  const body =
    chunk({ ...goc, choices: [{ index: 0, delta: { role: "assistant", content: "Trang một" }, finish_reason: null }] }) +
    chunk({ ...goc, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) +
    (coUsage ? chunk({ ...goc, choices: [], usage: { prompt_tokens: 1185, completion_tokens: 414, total_tokens: 1599 } }) : "") +
    "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("taoSidecarCaller - số token", () => {
  it("request XIN số token (stream_options.include_usage) và kết quả mang tokenVao/tokenRa", async () => {
    let bodyGui: Record<string, unknown> = {};
    const goi = taoSidecarCaller(async (_url, init) => {
      bodyGui = JSON.parse(String(init?.body));
      return phanHoiSse(true);
    });
    const kq = await goi(CAI_DAT, ANH, "chép chữ", 6000);
    assert.deepEqual(bodyGui.stream_options, { include_usage: true }, "không xin usage thì sidecar không trả số token khi stream");
    assert.equal(kq.text, "Trang một");
    assert.equal(kq.tokenVao, 1185);
    assert.equal(kq.tokenRa, 414);
  });

  it("nhà cung cấp không trả usage thì token để trống, KHÔNG hỏng lời gọi", async () => {
    const goi = taoSidecarCaller(async () => phanHoiSse(false));
    const kq = await goi(CAI_DAT, ANH, "chép chữ", 6000);
    assert.equal(kq.text, "Trang một");
    assert.equal(kq.tokenVao, undefined);
    assert.equal(kq.tokenRa, undefined);
  });
});
