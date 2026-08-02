import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeStep, type RawStep } from "./agent-step-trace.js";

/**
 * Module thuần (không env, không DB) nên test chạy thẳng, không cần setupTestEnv.
 */

const EMPTY: RawStep = {};

describe("summarizeStep - lấy đủ thứ cần để chẩn đoán", () => {
  it("giữ text model nói, và đánh số step TỪ 1 cho người đọc", () => {
    // AI SDK đánh từ 0. Đổi ngay tại đây để log, DB và giao diện cùng một con
    // số - đổi ở riêng giao diện thì đọc log lại thấy lệch một đơn vị.
    const t = summarizeStep({ stepNumber: 0, text: "Để mình tra giúp anh" }, 500);
    assert.equal(t.stepNumber, 1);
    assert.equal(t.text, "Để mình tra giúp anh");
    assert.equal(summarizeStep({ stepNumber: 4 }, 500).stepNumber, 5);
  });

  it("giữ reasoning khi model có trả (DeepSeek), rỗng khi không (OpenAI)", () => {
    assert.equal(summarizeStep({ reasoningText: "Ta cần cộng 2 và 3" }, 500).reasoning, "Ta cần cộng 2 và 3");
    assert.equal(summarizeStep(EMPTY, 500).reasoning, "");
  });

  it("ghi TOOL CALL kèm tham số, không chỉ ghi kết quả", () => {
    // Bản cũ chỉ log toolResults nên không biết model GỬI GÌ - vụ imageIndex
    // phải suy luận ngược từ câu lỗi mới ra
    const t = summarizeStep(
      { toolCalls: [{ toolName: "create_image", input: { mode: "ve_moi", prompt: "con mèo" } }] },
      500,
    );
    assert.deepEqual(t.toolCalls, [{ name: "create_image", input: '{"mode":"ve_moi","prompt":"con mèo"}' }]);
  });

  it("ghi WARNINGS - đây là chỗ lộ ra tham số bị provider âm thầm bỏ qua", () => {
    const t = summarizeStep(
      { warnings: [{ type: "unsupported-setting", setting: "size", details: "bị bỏ qua" }] },
      500,
    );
    assert.equal(t.warnings.length, 1);
    assert.match(t.warnings[0]!, /size/);
    assert.match(t.warnings[0]!, /unsupported-setting/);
  });

  it("ghi usage RIÊNG từng step, không phải tổng cả lượt", () => {
    const t = summarizeStep({ usage: { inputTokens: 1200, outputTokens: 340 } }, 500);
    assert.equal(t.inputTokens, 1200);
    assert.equal(t.outputTokens, 340);
  });

  it("giữ finishReason để biết step dừng vì sao", () => {
    assert.equal(summarizeStep({ finishReason: "tool-calls" }, 500).finishReason, "tool-calls");
  });
});

describe("summarizeStep - cắt ngắn", () => {
  const dai = "x".repeat(2000);

  it("cắt text, reasoning và nội dung tool theo trần", () => {
    const t = summarizeStep(
      {
        text: dai,
        reasoningText: dai,
        toolCalls: [{ toolName: "web_fetch", input: { url: dai } }],
        toolResults: [{ toolName: "web_fetch", output: dai }],
      },
      100,
    );
    for (const s of [t.text, t.reasoning, t.toolCalls[0]!.input, t.toolResults[0]!.output]) {
      assert.ok(s.length <= 120, `còn ${s.length} ký tự - trần 100 cộng phần đuôi báo cắt`);
      assert.match(s, /\.\.\./, "phải có dấu hiệu bị cắt, không cắt lén");
    }
  });

  it("nội dung ngắn hơn trần thì giữ nguyên, không thêm dấu ba chấm", () => {
    const t = summarizeStep({ text: "ngắn" }, 100);
    assert.equal(t.text, "ngắn");
  });

  it("báo rõ ĐỘ DÀI THẬT khi cắt - biết mình đang mất bao nhiêu", () => {
    const t = summarizeStep({ text: dai }, 100);
    assert.match(t.text, /2000/, "phải nói nguyên bản dài bao nhiêu");
  });
});

describe("summarizeStep - dữ liệu thiếu không được làm chết lượt", () => {
  it("step rỗng hoàn toàn vẫn ra bản ghi hợp lệ", () => {
    const t = summarizeStep(EMPTY, 500);
    assert.equal(t.text, "");
    assert.equal(t.reasoning, "");
    assert.deepEqual(t.toolCalls, []);
    assert.deepEqual(t.toolResults, []);
    assert.deepEqual(t.warnings, []);
    assert.equal(t.inputTokens, 0);
    assert.equal(t.stepNumber, 1, "step rong van dem tu 1");
  });

  it("input tool không stringify được (có vòng lặp) vẫn không throw", () => {
    const vong: Record<string, unknown> = { a: 1 };
    vong.self = vong;
    const t = summarizeStep({ toolCalls: [{ toolName: "x", input: vong }] }, 500);
    assert.equal(t.toolCalls.length, 1);
    assert.ok(t.toolCalls[0]!.input.length > 0, "phải có gì đó thay vì rỗng hoặc throw");
  });
});

/**
 * Lỗi tool là lớp sự kiện QUAN TRỌNG NHẤT mà bản đầu bỏ sót hoàn toàn: AI SDK v7
 * để chúng ở `content` dạng `tool-error`, còn `toolResults` chỉ lọc
 * `type === "tool-result"` nên luôn rỗng khi tool hỏng. Đo thật với ai@7.0.37:
 * tool ném exception cho ra `toolResults.length === 0`, `content` có
 * `tool-call, tool-error`. Đọc thiếu là bot hứa vẽ ảnh, không có ảnh, mà log và
 * trace đều trống trơn.
 */
describe("summarizeStep - lỗi tool", () => {
  it("nhặt tool-error từ content, chỗ toolResults không bao giờ có", () => {
    const t = summarizeStep(
      {
        toolCalls: [{ toolName: "create_image", input: { prompt: "x" } }],
        toolResults: [],
        content: [
          { type: "tool-call", toolName: "create_image" },
          { type: "tool-error", toolName: "create_image", error: new Error("prompt vượt 4000 ký tự") },
        ],
      },
      500,
    );
    assert.deepEqual(t.toolResults, [], "SDK không đưa lỗi vào đây - đó chính là cái bẫy");
    assert.equal(t.toolErrors.length, 1);
    assert.deepEqual(t.toolErrors[0], { name: "create_image", error: "prompt vượt 4000 ký tự" });
  });

  it("lấy được message của Error - JSON.stringify(err) ra {} vì message non-enumerable", () => {
    const t = summarizeStep({ content: [{ type: "tool-error", toolName: "web_fetch", error: new Error("mạng rớt") }] }, 500);
    assert.equal(t.toolErrors[0]!.error, "mạng rớt", "stringify thẳng sẽ ra '{}' - vô dụng");
  });

  it("lỗi không phải Error (Zod trả mảng issue) vẫn đọc được", () => {
    const t = summarizeStep(
      { content: [{ type: "tool-error", toolName: "x", error: [{ path: ["mode"], message: "Required" }] }] },
      500,
    );
    assert.match(t.toolErrors[0]!.error, /Required/);
  });

  it("lỗi dài bị cắt kèm độ dài thật", () => {
    const t = summarizeStep({ content: [{ type: "tool-error", toolName: "x", error: new Error("y".repeat(300)) }] }, 50);
    assert.match(t.toolErrors[0]!.error, /\(300 ký tự\)$/);
  });

  it("step không có content vẫn ra mảng rỗng, không throw", () => {
    assert.deepEqual(summarizeStep({}, 500).toolErrors, []);
  });

  it("step chạy tốt thì toolErrors rỗng, không lẫn tool-result vào", () => {
    const t = summarizeStep(
      {
        toolResults: [{ toolName: "web_search", output: "ok" }],
        content: [{ type: "tool-call", toolName: "web_search" }, { type: "tool-result", toolName: "web_search" }],
      },
      500,
    );
    assert.deepEqual(t.toolErrors, []);
    assert.equal(t.toolResults.length, 1);
  });
});

describe("summarizeStep - nhánh HỎNG của tool hiện câu, không hiện vỏ JSON", () => {
  it("kết quả đánh dấu hỏng ra câu đọc được trên trang Trace", () => {
    // Để JSON.stringify xử thì ô này ra {"ok":false,"loi":"...\"bao-gia.pdf\"..."}
    // với ngoặc kép escape hai lần - đúng ô người vận hành mở ra để hiểu vì sao
    // bot trả lời kém
    const t = summarizeStep(
      {
        toolResults: [
          {
            toolName: "send_file",
            output: { ok: false, loi: 'Không có file "bao-gia.pdf" trong kho shared-files' },
          },
        ],
      },
      500,
      1,
    );
    const out = t.toolResults[0]!.output;
    assert.ok(!out.includes('\\"'), `không được escape ngoặc kép: ${out}`);
    assert.ok(!out.includes('{"ok"'), `không được lộ vỏ JSON: ${out}`);
    assert.match(out, /Không có file "bao-gia\.pdf"/);
  });

  it("object thường KHÔNG bị nhận nhầm - vẫn ra JSON như cũ", () => {
    const t = summarizeStep(
      { toolResults: [{ toolName: "x", output: { ok: false, reason: "khác tên trường" } }] },
      500,
      1,
    );
    assert.match(t.toolResults[0]!.output, /^\{"ok"/);
  });
});

describe("summarizeStep - cờ `hong` cho nhánh hỏng của tool", () => {
  it("kết quả đánh dấu hỏng có hong:true, kết quả thường thì không", () => {
    // UI dùng cờ này để tô đỏ. KHÔNG được để UI dò tiền tố "LỖI: " trong
    // output: nội dung web của người lạ đi thẳng vào đó nên luật dựa trên chữ
    // có thể bị soạn cho trùng.
    const t = summarizeStep(
      {
        toolResults: [
          { toolName: "web_fetch", output: { ok: false, loi: "Không đọc được trang" } },
          { toolName: "get_datetime", output: "Bây giờ là 10:00" },
        ],
      },
      500,
      1,
    );
    assert.equal(t.toolResults[0]!.hong, true);
    assert.equal(t.toolResults[1]!.hong, undefined, "kết quả thường KHÔNG được gắn cờ");
  });

  it("object có ok:false nhưng khác tên trường KHÔNG bị gắn cờ", () => {
    const t = summarizeStep(
      { toolResults: [{ toolName: "x", output: { ok: false, reason: "khác tên trường" } }] },
      500,
      1,
    );
    assert.equal(t.toolResults[0]!.hong, undefined);
  });
});
