import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { stepCountIs, streamText, tool, type StepResult, type ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { thanhKetQuaStream } from "./streaming-model-test-helper.js";
import { chayStream } from "./stream-text-result.js";
import { ketQuaTuStepDaXong, laLoiHetGio, laStreamThieuFinish } from "./stream-cut-recovery.js";

// Module thuần - import tĩnh được, không cần setupTestEnv.
//
// Hai ca đầu chạy SDK THẬT (streamText thật, adapter openai-compatible thật với
// fetch giả) chứ không dựng lỗi bằng tay: thứ cần canh là HÌNH DẠNG lỗi mà bản
// SDK đang cài thật sự ném. Nâng SDK mà hình dạng đổi lần nữa thì đỏ ở đây,
// thay vì hai nhánh cứu trong agent-loop im lặng thành code chết.

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

describe("hết totalMs giữa lượt (ai >= 7.0.130)", () => {
  it("reject bằng lỗi laLoiHetGio nhận ra, và step đã xong mang đủ tin để lượt chốt dùng", async () => {
    let lan = 0;
    const model = new MockLanguageModelV4({
      doStream: async ({ abortSignal }) => {
        lan++;
        if (lan === 1) {
          return thanhKetQuaStream({
            content: [{ type: "tool-call", toolCallId: "c1", toolName: "hoiGio", input: "{}" }],
            finishReason: "tool-calls",
            usage,
            warnings: [],
          } as never);
        }
        // Step 2 treo cho tới khi trần thời gian bắn
        await new Promise((_, reject) => abortSignal?.addEventListener("abort", () => reject(abortSignal.reason)));
        throw new Error("không tới được đây");
      },
    });
    const tools = {
      hoiGio: tool({ inputSchema: z.object({}), execute: async () => "10:00" }),
    } satisfies ToolSet;

    const stepsXong: StepResult<typeof tools>[] = [];
    const loi = await chayStream((onError) =>
      streamText({
        model,
        prompt: "mấy giờ rồi",
        tools,
        stopWhen: stepCountIs(5),
        timeout: { totalMs: 300 },
        onStepFinish: (s) => {
          stepsXong.push(s);
        },
        onError,
      }),
    ).then(
      () => null,
      (e: unknown) => e,
    );

    assert.ok(loi, "bản SDK này phải REJECT khi hết giờ - nếu resolve lại thì nhánh cứu trong agent-loop thừa");
    assert.equal(laLoiHetGio(loi), true, `lỗi hết giờ phải nhận ra được, nhận: ${String(loi)}`);
    assert.equal(stepsXong.length, 1);

    const cuu = ketQuaTuStepDaXong(stepsXong);
    assert.equal(cuu.steps.at(-1)!.toolCalls.length, 1, "step cuối còn tool call -> canLuotChot đi vào lượt chốt");
    const vaiTro = cuu.response.messages.map((m) => m.role);
    assert.deepEqual(vaiTro, ["assistant", "tool"], "lượt chốt cần CẢ tool call lẫn tool result của step đã xong");
    assert.equal(cuu.totalUsage.totalTokens, 15);
  });

  it("tin của step KHÔNG cộng dồn - kết quả cứu phải nối tin của MỌI step đã xong", async () => {
    let lan = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        lan++;
        return thanhKetQuaStream({
          content:
            lan <= 2
              ? [{ type: "tool-call", toolCallId: `c${lan}`, toolName: "hoiGio", input: "{}" }]
              : [{ type: "text", text: "xong" }],
          finishReason: lan <= 2 ? "tool-calls" : "stop",
          usage,
          warnings: [],
        } as never);
      },
    });
    const tools = { hoiGio: tool({ inputSchema: z.object({}), execute: async () => "10:00" }) } satisfies ToolSet;
    const stepsXong: StepResult<typeof tools>[] = [];
    await chayStream((onError) =>
      streamText({ model, prompt: "x", tools, stopWhen: stepCountIs(5), onStepFinish: (s) => void stepsXong.push(s), onError }),
    );
    // Hình dạng của SDK: mỗi step chỉ mang tin của chính nó. Đổi thành cộng dồn
    // thì phép nối bên dưới nhân đôi tin - ca này đỏ để người nâng SDK biết.
    assert.deepEqual(
      stepsXong.map((s) => s.response.messages.map((m) => m.role).join("+")),
      ["assistant+tool", "assistant+tool", "assistant"],
    );
    const cuu = ketQuaTuStepDaXong(stepsXong.slice(0, 2));
    const goiTool = cuu.response.messages.flatMap((m) =>
      m.role === "assistant" && Array.isArray(m.content) ? m.content.filter((p) => p.type === "tool-call") : [],
    );
    assert.deepEqual(
      goiTool.map((p) => (p as { toolCallId: string }).toolCallId),
      ["c1", "c2"],
      "lượt chốt phải thấy tool call của CẢ hai step, không chỉ step cuối",
    );
    assert.equal(cuu.response.messages.length, 4);
    assert.equal(cuu.totalUsage.totalTokens, 30, "usage cộng qua mọi step đã xong");
  });

  it("laLoiHetGio KHÔNG nhận lỗi thường", () => {
    assert.equal(laLoiHetGio(new Error("Upstream unavailable")), false);
    assert.equal(laLoiHetGio("TimeoutError"), false);
    assert.equal(laLoiHetGio(new DOMException("x", "TimeoutError")), true);
  });

  it("ketQuaTuStepDaXong từ chối mảng rỗng thay vì dựng kết quả ma", () => {
    assert.throws(() => ketQuaTuStepDaXong([]));
  });
});

describe("stream đóng không có finish_reason (@ai-sdk/openai-compatible >= 3.0.33)", () => {
  /** Router giả: trả SSE chỉ có các chunk cho sẵn rồi `[DONE]` */
  function routerGia(chunks: unknown[]) {
    const body = [...chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`), "data: [DONE]\n\n"].join("");
    return createOpenAICompatible({
      name: "llmRouter",
      baseURL: "https://router.test/v1",
      apiKey: "k",
      fetch: async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    });
  }

  async function chay(chunks: unknown[]) {
    return chayStream((onError) => streamText({ model: routerGia(chunks)("m"), prompt: "x", maxRetries: 0, onError })).then(
      (r) => ({ ok: r }),
      (e: unknown) => ({ loi: e }),
    );
  }

  it("glitch '200 rỗng' (chỉ [DONE]) giờ là lỗi mà laStreamThieuFinish nhận ra", async () => {
    const kq = await chay([]);
    assert.ok("loi" in kq, "bản adapter này phải ném - nếu lại resolve rỗng thì nhánh isGlitch cũ tự lo");
    assert.equal(laStreamThieuFinish(kq.loi), true, `nhận: ${String(kq.loi)}`);
  });

  it("có finish_reason thì không bị coi là glitch dạng mới", async () => {
    const kq = await chay([
      { id: "1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "chào" }, finish_reason: "stop" }] },
    ]);
    assert.ok("ok" in kq);
    assert.equal(kq.ok.text, "chào");
  });

  it("lỗi khác (kể cả cùng lớp InvalidResponseDataError) không bị nhận nhầm", () => {
    assert.equal(laStreamThieuFinish(new Error("Response stream ended without a finish reason.")), false);
  });
});
