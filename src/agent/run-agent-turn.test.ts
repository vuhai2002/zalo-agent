import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { ThreadType, type API } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import { thanhKetQuaStream, type KetQuaGenerate } from "./streaming-model-test-helper.js";
import type { StepTrace } from "./agent-step-trace.js";
import type { AccountConfig } from "../config/account-store.js";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";

/**
 * Test cho chính VÒNG LẶP, không phải cho hai hàm quyết định thuần (đã có ở
 * agent-loop.test.ts). Trước đây phần dây nối - retry glitch, bỏ pixel khi
 * provider từ chối, lượt chốt khi chạm trần step - không có test nào, mà đó là
 * đúng những nhánh chỉ chạy lúc mọi thứ đang hỏng.
 *
 * Model tiêm qua `resolveModel` nên không request mạng nào.
 */

let dataDir: string;
let loop: typeof import("./agent-loop.js");
let history: typeof import("../conversation/history-store.js");
let tuning: typeof import("../config/runtime-tuning-settings.js");

before(async () => {
  // Trần 2 step: đủ để dựng cả nhánh "chạm trần" lẫn nhánh "step sau ném lỗi"
  // mà không phải giả lập 8 vòng
  dataDir = setupTestEnv({ LLM_MAX_STEPS: "2" });
  loop = await import("./agent-loop.js");
  history = await import("../conversation/history-store.js");
  tuning = await import("../config/runtime-tuning-settings.js");
});

after(async () => {
  (await import("../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

/**
 * usage của LanguageModelV4 là cấu trúc LỒNG (`inputTokens.total`), không phải
 * ba số phẳng như `result.totalUsage` mà agent-loop đọc - SDK làm phẳng ở giữa.
 * Dựng sai tầng thì mọi số về 0 và lượt hợp lệ bị chấm nhầm là glitch router.
 */
const dungUsage = (vao: number, ra: number) => ({
  inputTokens: { total: vao, noCache: vao, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: ra, text: ra, reasoning: 0 },
});

const KHONG_TOKEN = dungUsage(0, 0);
const CO_TOKEN = dungUsage(120, 30);

/** Một lần trả lời của model: text thường */
const traLoi = (text: string, usage = CO_TOKEN) => ({
  content: text ? [{ type: "text" as const, text }] : [],
  finishReason: "stop" as const,
  usage,
  warnings: [],
});

/** Một lần trả lời gọi tool - get_datetime là tool thuần, chạy thật vô hại */
const goiTool = () => ({
  content: [
    {
      type: "tool-call" as const,
      toolCallId: "call-1",
      toolName: "get_datetime",
      input: "{}",
    },
  ],
  finishReason: "tool-calls" as const,
  usage: CO_TOKEN,
  warnings: [],
});

/** Chữ ký glitch của 9Router: HTTP 200 nhưng rỗng trơn, 0 token */
const rong = () => traLoi("", KHONG_TOKEN);

const account: AccountConfig = {
  id: "acc-test",
  label: "Test",
  enabled: true,
  agentId: "khong-co-agent-nay",
  allowlist: { mode: "all", userIds: [] },
  groupRequireMention: true,
  respondToGroups: true,
  groupPassiveListen: true,
  autoReactEnabled: false,
  autoReactIcon: "heart",
  typingIndicatorEnabled: false,
  disabledTools: [],
};

const tinNhan = (): ParsedMessage => ({
  accountId: account.id,
  threadId: "thread-1",
  threadType: ThreadType.User,
  isGroup: false,
  senderId: "user-1",
  senderName: "Hải",
  text: "hôm nay ngày mấy",
  images: [],
  msgId: "m1",
  cliMsgId: "c1",
  isSelf: false,
  mentionsMe: false,
  rawData: {},
});

/**
 * Chạy 1 lượt với model giả trả lần lượt các kết quả đã dựng sẵn.
 * Trả về cả `calls` để soi request thứ N gửi đi những gì (lượt chốt có tool không).
 */
async function chayLuot(
  ketQua: (() => unknown)[],
  batch = [tinNhan()],
  opts: { isolated?: boolean; layTinChen?: () => ParsedMessage[] } = {},
) {
  // Suy kiểu từ chính mock, không import @ai-sdk/provider - pnpm layout chặt
  // nên package đó không phải dependency trực tiếp, import vào là typecheck đỏ
  const calls: Parameters<MockLanguageModelV4["doStream"]>[0][] = [];
  let lan = 0;
  // `doStream` chứ không phải `doGenerate`: vòng lặp đi đường `streamText` để
  // thoát 524 của Cloudflare, nên `doGenerate` không còn được gọi tới. Fixture
  // bên trên vẫn mô tả một lần trả lời như cũ, `thanhKetQuaStream` bắc cầu.
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      calls.push(options);
      const tiep = ketQua[Math.min(lan, ketQua.length - 1)]!;
      lan++;
      const r = tiep();
      if (r instanceof Error) throw r;
      return thanhKetQuaStream(r as KetQuaGenerate);
    },
  });

  const trace: StepTrace[] = [];
  const ket = await loop.runAgentTurn({
    api: {} as API,
    account,
    batch,
    trace,
    resolveModel: () => model,
    isolated: opts.isolated,
    layTinChen: opts.layTinChen,
  });
  return { ket, trace, calls, soLanGoi: () => lan };
}

/** Gộp toàn bộ nội dung `prompt` gửi cho model thành 1 chuỗi để dò substring */
function promptText(call: Parameters<MockLanguageModelV4["doStream"]>[0]): string {
  return call.prompt
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join("\n");
}

/**
 * Chỉ `n` tin CUỐI của prompt - dùng để soi phần ĐUÔI ĐƯỢC BẢO VỆ của lượt chốt.
 *
 * Soi vị trí chứ không soi sự có mặt: khẳng định "câu hỏi còn trong prompt" chỉ
 * đỏ khi bộ cắt thật sự cắt tới nó, mà điều đó phụ thuộc kích thước ngữ cảnh -
 * nên nó xanh giả ở mọi lượt nhẹ. Câu hỏi PHẢI nằm trong đuôi, đó mới là bất
 * biến thật.
 */
function promptDuoi(call: Parameters<MockLanguageModelV4["doStream"]>[0], n: number): string {
  return call.prompt
    .slice(-n)
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join("\n");
}

/** System prompt (role='system') nằm ở đầu `prompt`, không phải field riêng trên call options */
function systemText(call: Parameters<MockLanguageModelV4["doStream"]>[0]): string | undefined {
  const systemMsg = call.prompt.find((m) => m.role === "system");
  return systemMsg?.content;
}

describe("runAgentTurn - lượt bình thường", () => {
  it("trả text của model và cộng đúng usage", async () => {
    const { ket } = await chayLuot([() => traLoi("Hôm nay thứ tư.")]);
    assert.equal(ket.text, "Hôm nay thứ tư.");
    assert.equal(ket.usage.totalTokens, 150);
    assert.equal(ket.usage.steps, 1);
  });

  it("đẩy trace vào mảng của CALLER, không giữ riêng", async () => {
    const { trace } = await chayLuot([() => traLoi("xong")]);
    assert.equal(trace.length, 1, "caller phải nhìn thấy step vừa chạy");
    assert.equal(trace[0]!.stepNumber, 1, "step đánh số từ 1, không phải từ 0");
  });
});

describe("runAgentTurn - router trả completion rỗng", () => {
  it("rỗng lần đầu thì thử lại, lấy kết quả lần hai", async () => {
    const { ket, soLanGoi } = await chayLuot([rong, () => traLoi("lần hai có chữ")]);
    assert.equal(soLanGoi(), 2, "phải gọi lại đúng 1 lần");
    assert.equal(ket.text, "lần hai có chữ");
  });

  it("rỗng cả hai lần thì trả câu báo lỗi, không im lặng bỏ treo", async () => {
    const { ket, soLanGoi } = await chayLuot([rong]);
    assert.equal(soLanGoi(), 2, "thử lại đúng 1 lần rồi thôi, không lặp vô hạn");
    assert.ok(ket.text.length > 0, "phải nói gì đó cho người nhắn");
    assert.equal(ket.usage.totalTokens, 0);
  });

  it("trace của CẢ hai lần chạy nối vào nhau - lúc hỏng mới cần nhìn đủ", async () => {
    const { trace } = await chayLuot([rong, () => traLoi("ok")]);
    assert.equal(trace.length, 2);
  });

  it("hai lần chạy đánh dấu attempt khác nhau, không trộn thành model-đang-lặp", async () => {
    const { trace } = await chayLuot([rong, () => traLoi("ok")]);
    // Cả hai đều là step 1 vì mỗi lần chạy đánh số lại từ đầu - attempt là thứ
    // DUY NHẤT phân biệt được, không có nó thì đọc ra "step 1, step 1"
    assert.deepEqual(
      trace.map((t) => [t.attempt, t.stepNumber]),
      [
        [1, 1],
        [2, 1],
      ],
    );
  });
});

/** Lỗi provider dựng tay - dùng ở cả nhóm "chữa theo loại lỗi" lẫn nhóm "chạm trần step" */
const loiApi = (statusCode: number, message: string) =>
  new APICallError({
    message,
    url: "https://router.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    responseBody: message,
  });

describe("runAgentTurn - chữa theo loại lỗi provider", () => {
  // Đo thật trên ai@7.0.37 với maxRetries=2: SDK TỰ retry 429 và 5xx (3 lần
  // gọi), KHÔNG retry 401/400 (1 lần). Nên test phải đo phần vượt lên trên đó,
  // không thì xanh cả khi nhánh chữa chưa được nối.
  const SDK_TU_THU = 3;

  it("401 dừng ngay - KHÔNG chồng thêm lần thử nào lên trên SDK", async () => {
    let lan = 0;
    await assert.rejects(
      chayLuot([
        () => {
          lan++;
          return loiApi(401, "Invalid API key");
        },
      ]),
    );
    // SDK vốn không retry 401. Bất biến ở đây là nhánh chữa cũng KHÔNG được
    // thêm lần nào - sai khóa thì thử mấy cũng hỏng, chỉ tổ chậm.
    assert.equal(lan, 1, "gọi đúng một lần");
  });

  it("429 dai dẳng: chữa THÊM một vòng nữa lên trên phần SDK tự thử", async () => {
    let lan = 0;
    await assert.rejects(
      chayLuot([
        () => {
          lan++;
          return loiApi(429, "Rate limit exceeded");
        },
      ]),
    );
    // Không có nhánh chữa thì dừng ở 3. Có nhánh chữa thì chờ Retry-After rồi
    // chạy lại `runOnce`, và lần chạy đó lại được SDK thử 3 lần nữa.
    assert.equal(lan, SDK_TU_THU * 2, `mong ${SDK_TU_THU * 2} lần gọi, nhận ${lan}`);
  });

  it("tràn ngữ cảnh: cắt sâu hơn rồi thử lại, lần hai gửi ÍT tin hơn", async () => {
    // Thread RIÊNG: 12 tin dài nhồi vào đây không được rò sang test khác
    const threadId = "thread-tran-context";
    for (let i = 0; i < 12; i++) {
      history.appendMessage(account.id, threadId, {
        role: "user",
        content: `tin dài số ${i} `.repeat(200),
        senderName: "Hải",
        senderId: "user-1",
      });
    }
    // Trần đủ RỘNG để lần đầu không bị cắt, nhưng NỬA trần thì bị - đó chính là
    // thứ nhánh context_overflow làm. Để trần mặc định 128k thì 12 tin này
    // (~13k token) lọt cả hai lần và test không đo được gì.
    tuning.setTuning("LLM_CONTEXT_WINDOW", 20_000);
    try {
      let lan = 0;
      const { ket, calls } = await chayLuot(
        [
          () => {
            lan++;
            return lan === 1
              ? loiApi(400, "prompt is too long: 210000 tokens")
              : traLoi("cắt bớt rồi trả lời được");
          },
        ],
        [{ ...tinNhan(), threadId }],
      );
      assert.equal(lan, 2, "thử lại đúng 1 lần");
      assert.ok(
        calls[1]!.prompt.length < calls[0]!.prompt.length,
        `lần hai phải gửi ít tin hơn: ${calls[0]!.prompt.length} -> ${calls[1]!.prompt.length}`,
      );
      assert.equal(ket.text, "cắt bớt rồi trả lời được");
    } finally {
      tuning.setTuning("LLM_CONTEXT_WINDOW", null);
    }
  });

  it("5xx vẫn ném ra ngoài cho caller báo người dùng, không nuốt", async () => {
    await assert.rejects(chayLuot([() => loiApi(503, "Upstream unavailable")]));
  });
});

describe("runAgentTurn - chạm trần step", () => {
  it("hết step khi model còn gọi tool thì chạy lượt chốt KHÔNG cấp tool", async () => {
    // Trần 2 step: gọi tool hai lần là chạm trần, request thứ 3 là lượt chốt
    const { ket, calls } = await chayLuot([
      goiTool,
      goiTool,
      () => traLoi("Chốt lại: hôm nay thứ tư."),
    ]);

    assert.equal(calls.length, 3, "2 step + 1 lượt chốt");
    assert.ok((calls[0]!.tools?.length ?? 0) > 0, "lượt thường phải có tool");
    assert.equal(
      calls[2]!.tools?.length ?? 0,
      0,
      "lượt chốt KHÔNG được cấp tool - còn tool thì model lại gọi tiếp và rơi vào đúng cái bẫy vừa thoát",
    );
    assert.equal(ket.text, "Chốt lại: hôm nay thứ tư.");
  });

  it("GUARD chống lặp dừng vòng TRƯỚC trần step, và vẫn chạy lượt chốt", async () => {
    // Tool không tồn tại -> AI SDK sinh `tool-error` ở `content` (KHÔNG vào
    // `toolResults`), đúng nguồn mà guard phải đọc. Gọi y hệt nhiều lần là
    // nhánh `loi-giong-het`.
    const goiToolMa = () => ({
      content: [
        { type: "tool-call" as const, toolCallId: "c", toolName: "tool_khong_ton_tai", input: "{}" },
      ],
      finishReason: "tool-calls" as const,
      usage: CO_TOKEN,
      warnings: [],
    });

    // Trần step ĐỂ CAO (8) còn ngưỡng guard THẤP (2), để chỉ guard mới dừng
    // được vòng. Nếu để cả hai bằng 2 thì test này đúng cả khi guard không hề
    // được nối - trần step cũng dừng ở đúng chỗ đó.
    tuning.setTuning("LLM_MAX_STEPS", 8);
    tuning.setTuning("TOOL_LOOP_SAME_ARGS_BLOCK", 2);
    try {
      const { ket, calls } = await chayLuot([
        goiToolMa,
        goiToolMa,
        () => traLoi("Mình chưa tra được, nói thật với anh."),
      ]);
      assert.equal(
        calls.length,
        3,
        `guard phải dừng ở step 2 (+1 lượt chốt). Chạy tới ${calls.length} lần nghĩa là guard KHÔNG chặn, trần step 8 mới cắt`,
      );
      assert.equal(calls.at(-1)!.tools?.length ?? 0, 0, "lần gọi cuối phải là lượt chốt (không tool)");
      assert.equal(
        ket.text,
        "Mình chưa tra được, nói thật với anh.",
        "dừng vì guard vẫn phải ra câu trả lời, không phải câu tường thuật tiến trình",
      );
    } finally {
      tuning.setTuning("TOOL_LOOP_SAME_ARGS_BLOCK", null);
      tuning.setTuning("LLM_MAX_STEPS", null);
    }
  });

  it("tool GHI hỏng lặp lại cũng bị guard chặn - đường DUY NHẤT là kết quả đánh dấu hỏng", async () => {
    // Ca này chạy TOOL THẬT, không phải tool ma. `send_file` với tên file không
    // có trong kho trả `ketQuaLoi(...)` - nó KHÔNG ném, nên không có phần
    // `tool-error` nào cả; và nó là tool GHI nên luật "không tiến triển" cũng
    // không áp. Trước khi guard biết đọc kết quả dạng-lỗi thì không đường nào
    // chặn được ca này: model đốt trọn trần step rồi người dùng nhận câu cụt.
    const goiSendFile = () => ({
      content: [
        {
          type: "tool-call" as const,
          toolCallId: "c",
          toolName: "send_file",
          input: JSON.stringify({ source: "khong-co-file-nay.pdf" }),
        },
      ],
      finishReason: "tool-calls" as const,
      usage: CO_TOKEN,
      warnings: [],
    });

    tuning.setTuning("LLM_MAX_STEPS", 8);
    tuning.setTuning("TOOL_LOOP_SAME_ARGS_BLOCK", 2);
    try {
      const { ket, calls } = await chayLuot([
        goiSendFile,
        goiSendFile,
        () => traLoi("Không tìm thấy file đó, anh gửi lại giúp em nhé."),
      ]);
      assert.equal(
        calls.length,
        3,
        `guard phải dừng ở step 2 (+1 lượt chốt). Chạy ${calls.length} lần nghĩa là kết quả hỏng KHÔNG vào bộ đếm lỗi, trần step 8 mới cắt`,
      );
      assert.equal(calls.at(-1)!.tools?.length ?? 0, 0, "lần cuối phải là lượt chốt");
      assert.equal(ket.text, "Không tìm thấy file đó, anh gửi lại giúp em nhé.");
    } finally {
      tuning.setTuning("TOOL_LOOP_SAME_ARGS_BLOCK", null);
      tuning.setTuning("LLM_MAX_STEPS", null);
    }
  });

  it("tool ĐỌC hỏng lặp lại vào bộ đếm LỖI chứ không phải bộ không-tiến-triển", async () => {
    // `get_group_info` trong chat riêng luôn trả `ketQuaLoi("Đây là chat riêng...")`.
    // Nó là tool ĐỌC nên CẢ HAI bộ đếm đều với tới được - phân biệt bằng NGƯỠNG:
    // đặt lỗi-giống-hệt = 2 còn không-tiến-triển = 6. Chặn ở step 2 chứng minh
    // đi vào bộ LỖI; chặn ở step 6 nghĩa là vẫn đi nhánh cũ.
    const goiGroupInfo = () => ({
      content: [
        { type: "tool-call" as const, toolCallId: "c", toolName: "get_group_info", input: "{}" },
      ],
      finishReason: "tool-calls" as const,
      usage: CO_TOKEN,
      warnings: [],
    });

    tuning.setTuning("LLM_MAX_STEPS", 8);
    tuning.setTuning("TOOL_LOOP_SAME_ARGS_BLOCK", 2);
    tuning.setTuning("TOOL_LOOP_NO_PROGRESS_BLOCK", 6);
    try {
      const { calls } = await chayLuot([goiGroupInfo, goiGroupInfo, () => traLoi("Đây là chat riêng.")]);
      assert.equal(
        calls.length,
        3,
        `phải chặn ở step 2 theo bộ đếm LỖI. ${calls.length} lần gọi nghĩa là còn đi nhánh "không tiến triển" (ngưỡng 6) - sai bộ đếm nên câu chẩn đoán cũng sai`,
      );
      // Khẳng định SỐNG CÒN của ca này. Chỉ đếm số lần gọi là rỗng: mock trả
      // `finishReason: "stop"` từ phần tử thứ ba trở đi, nên vòng lặp tự dừng ở
      // lần 3 kể cả khi guard không hề chặn - và test vẫn xanh. Lượt CHỐT thì
      // khác: nó chỉ tồn tại khi có thứ gì đó cắt ngang lúc model còn đang gọi
      // tool, và nó là lần gọi duy nhất không được cấp tool.
      assert.equal(
        calls.at(-1)!.tools?.length ?? 0,
        0,
        "lần cuối phải là LƯỢT CHỐT (không cấp tool) - còn tool nghĩa là vòng tự kết thúc chứ guard chưa chặn",
      );
    } finally {
      tuning.setTuning("TOOL_LOOP_NO_PROGRESS_BLOCK", null);
      tuning.setTuning("TOOL_LOOP_SAME_ARGS_BLOCK", null);
      tuning.setTuning("LLM_MAX_STEPS", null);
    }
  });

  it("ngưỡng guard bị KẸP theo trần step - ngưỡng vượt trần vẫn phải nổ được", async () => {
    // `nguongTheoTranStep` có unit test riêng, nhưng việc nó có được GỌI hay
    // không thì không ai canh - mà đó đúng là hình dạng của bug gốc: hàm viết
    // đúng, không ai nối. Ca này đo DÂY NỐI ở `agent-loop.ts`.
    //
    // Trần step 4, ngưỡng cùng-tool 9 (vượt trần). Không kẹp thì bộ đếm không
    // bao giờ chạm 9: model đốt trọn 4 step rồi mới dừng vì hết step. Kẹp thì
    // ngưỡng thành 3 và guard chặn ở step 3.
    let n = 0;
    const goiSendFileKhac = () => ({
      content: [
        {
          type: "tool-call" as const,
          toolCallId: `c${++n}`,
          toolName: "send_file",
          // Tham số KHÁC nhau mỗi lần -> chỉ bộ đếm cùng-tool với tới được
          input: JSON.stringify({ source: `khong-co-${n}.pdf` }),
        },
      ],
      finishReason: "tool-calls" as const,
      usage: CO_TOKEN,
      warnings: [],
    });

    tuning.setTuning("LLM_MAX_STEPS", 4);
    tuning.setTuning("TOOL_LOOP_SAME_TOOL_BLOCK", 9);
    tuning.setTuning("TOOL_LOOP_SAME_ARGS_BLOCK", 30);
    tuning.setTuning("TOOL_LOOP_NO_PROGRESS_BLOCK", 30);
    try {
      const { calls } = await chayLuot([goiSendFileKhac, goiSendFileKhac, goiSendFileKhac, () => traLoi("chốt")]);
      assert.equal(
        calls.length,
        4,
        `guard phải chặn ở step 3 (+1 lượt chốt). ${calls.length} lần gọi nghĩa là ngưỡng 9 KHÔNG bị kẹp xuống dưới trần 4 nên không bao giờ tới lượt`,
      );
      assert.equal(calls.at(-1)!.tools?.length ?? 0, 0, "lần cuối phải là lượt chốt");
    } finally {
      tuning.setTuning("TOOL_LOOP_NO_PROGRESS_BLOCK", null);
      tuning.setTuning("TOOL_LOOP_SAME_ARGS_BLOCK", null);
      tuning.setTuning("TOOL_LOOP_SAME_TOOL_BLOCK", null);
      tuning.setTuning("LLM_MAX_STEPS", null);
    }
  });

  it("lần chạy MỚI trong cùng lượt xóa sạch bộ đếm guard - không mang tội của lần trước sang", async () => {
    // `datLai()` chỉ được gọi ở 4 chỗ trong agent-loop và chưa chỗ nào có test ở
    // tầng vòng lặp. Quên nó đi thì lượt nào phải dựng lại (tràn ngữ cảnh, bị
    // siết nhịp, router trả rỗng) sẽ bị chặn oan gần như ngay lập tức - mà đó
    // đúng là lúc lượt đang mong manh nhất.
    const goiSendFile = () => ({
      content: [
        {
          type: "tool-call" as const,
          toolCallId: "c",
          toolName: "send_file",
          input: JSON.stringify({ source: "khong-co-file-nay.pdf" }),
        },
      ],
      finishReason: "tool-calls" as const,
      usage: CO_TOKEN,
      warnings: [],
    });

    tuning.setTuning("LLM_MAX_STEPS", 8);
    tuning.setTuning("TOOL_LOOP_SAME_ARGS_BLOCK", 2);
    try {
      let lan = 0;
      const { calls } = await chayLuot([
        () => {
          lan++;
          if (lan === 1) return goiSendFile(); // lần chạy 1: hỏng lần thứ nhất
          if (lan === 2) return loiApi(400, "prompt is too long: 210000 tokens"); // -> dựng lại
          if (lan === 3) return goiSendFile(); // lần chạy 2: lại hỏng, nhưng phải tính là LẦN ĐẦU
          return traLoi("Không gửi được file, em nói thật với anh.");
        },
      ]);

      assert.equal(calls.length, 4, "1 step + lỗi tràn + 1 step của lần chạy mới + câu trả lời");
      // Đây là chỗ phân biệt. Còn bộ đếm cũ thì lần hỏng ở call 3 là lần thứ
      // HAI -> chạm ngưỡng 2 -> guard chặn -> call 4 thành LƯỢT CHỐT (không
      // tool). Đã xóa đúng thì call 4 là lượt thường, vẫn được cấp tool.
      assert.ok(
        (calls.at(-1)!.tools?.length ?? 0) > 0,
        "lần gọi cuối phải là lượt THƯỜNG - không tool nghĩa là guard chặn oan vì còn giữ bộ đếm của lần chạy trước",
      );
    } finally {
      tuning.setTuning("TOOL_LOOP_SAME_ARGS_BLOCK", null);
      tuning.setTuning("LLM_MAX_STEPS", null);
    }
  });

  it("lượt bình thường KHÔNG bị guard đụng tới - đối chứng cho ca trên", async () => {
    // Tool chạy được, gọi một lần: guard không được xen vào hành vi cũ
    const { ket, calls } = await chayLuot([goiTool, () => traLoi("hôm nay thứ tư")]);
    assert.equal(calls.length, 2, "không có lượt chốt thừa");
    assert.equal(ket.text, "hôm nay thứ tư");
  });

  it("lượt chốt vào trace như một lần chạy riêng", async () => {
    const { trace } = await chayLuot([goiTool, goiTool, () => traLoi("chốt")]);
    assert.deepEqual(
      trace.map((t) => t.attempt),
      [1, 1, 2],
      "hai step đầu là lần 1, lượt chốt là lần riêng",
    );
  });

  it("lượt chốt cũng lỗi thì vẫn trả lời được, không ném ra ngoài", async () => {
    const { ket } = await chayLuot([goiTool, goiTool, () => new Error("chốt cũng chết")]);
    assert.ok(ket.text.includes("hỏi lại"), "phải là câu mời hỏi lại, không phải câu tường thuật nội bộ");
  });
});

describe("runAgentTurn - provider từ chối lượt có ảnh", () => {
  /** Ảnh đã persist trong data/media để buildTurnMessages đọc từ đĩa, khỏi chạm mạng */
  function anhTrenDia(): string {
    const relPath = path.join("media", account.id, "thread-1", "anh.jpg");
    const abs = path.join(dataDir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]));
    return relPath;
  }

  it("4xx với lượt đính pixel thì dựng lại input KHÔNG pixel và thử lại", async () => {
    const batch = [{ ...tinNhan(), images: [{ url: "https://zalo/x.jpg", localPath: anhTrenDia() }] }];
    let lan = 0;
    const { ket, calls } = await chayLuot(
      [
        () =>
          new APICallError({
            message: "model không nhận ảnh",
            url: "https://router/v1/chat",
            requestBodyValues: {},
            statusCode: 400,
            isRetryable: false,
          }),
        () => {
          lan++;
          return traLoi("Đọc bằng chữ vậy.");
        },
      ],
      batch,
    );

    const coAnh = (i: number) =>
      calls[i]!.prompt.some(
        (m) => Array.isArray(m.content) && m.content.some((p) => p.type === "file"),
      );
    assert.equal(coAnh(0), true, "lần đầu phải có đính pixel, không thì test này vô nghĩa");
    assert.equal(coAnh(1), false, "lần thử lại KHÔNG được đính pixel nữa");
    assert.equal(ket.text, "Đọc bằng chữ vậy.");
    assert.equal(lan, 1);
  });

  it("lỗi 401 (sai key) KHÔNG kích hoạt bỏ pixel - bỏ ảnh cũng không cứu", async () => {
    const batch = [{ ...tinNhan(), images: [{ url: "https://zalo/x.jpg", localPath: anhTrenDia() }] }];
    await assert.rejects(
      chayLuot(
        [
          () =>
            new APICallError({
              message: "sai key",
              url: "https://router/v1/chat",
              requestBodyValues: {},
              statusCode: 401,
              isRetryable: false,
            }),
        ],
        batch,
      ),
      /sai key/,
    );
  });
});

describe("runAgentTurn - lượt ném lỗi", () => {
  it("ném ra ngoài nhưng GIỮ nguyên trace các step đã chạy", async () => {
    const trace: StepTrace[] = [];
    let lan = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        lan++;
        // Step 1 chạy tool trót lọt (đã có trace), step 2 mới chết giữa lượt
        if (lan === 1) return thanhKetQuaStream(goiTool() as unknown as KetQuaGenerate);
        throw new APICallError({
          message: "500 từ router",
          url: "https://router/v1/chat",
          requestBodyValues: {},
          statusCode: 500,
          isRetryable: false,
        });
      },
    });

    await assert.rejects(
      loop.runAgentTurn({
        api: {} as API,
        account,
        batch: [tinNhan()],
        trace,
        resolveModel: () => model,
      }),
      /500 từ router/,
    );
    assert.equal(trace.length, 1, "step đã chạy phải còn lại để chẩn đoán, không rơi theo stack");
  });

  // Ba test dưới đây khóa lại phần dễ vỡ nhất của đường streaming. `streamText`
  // KHÔNG ném lỗi gốc ra ngoài (xem stream-text-result.ts), nên mỗi bất biến ở
  // đây từng là một ca hỏng thật lúc chuyển từ `generateText` sang.

  it("ném LỖI GỐC của provider, không phải vỏ NoOutputGeneratedError của streamText", async () => {
    // Đây là bất biến đắt nhất: mất mã HTTP là `phanLoaiLoiProvider` ra
    // `unknown` cho mọi thứ, và sai khóa bị báo cho người nhắn thành "thử lại
    // sau ít phút" - chờ bao lâu cũng không tự hết.
    await assert.rejects(
      chayLuot([() => loiApi(401, "Invalid API key")]),
      (err: unknown) => {
        assert.ok(APICallError.isInstance(err), `mong APICallError, nhận ${(err as Error)?.name}`);
        assert.equal(err.statusCode, 401, "mã HTTP phải còn nguyên để phân loại được");
        return true;
      },
    );
  });

  it("stream chết SAU khi step 1 đã xong thì vẫn ném - không trả kết quả cụt", async () => {
    // `streamText` chỉ reject khi CHƯA ghi được step nào; lỗi ở step 2 trở đi
    // làm promise RESOLVE với kết quả cụt và lỗi biến mất. Nuốt như vậy thì
    // lượt đi tiếp vào lượt chốt và người nhắn nhận câu "chưa gom đủ" - đổ tại
    // hết lượt trong khi thật ra router chết.
    let lan = 0;
    await assert.rejects(
      chayLuot([
        () => {
          lan++;
          return lan === 1 ? goiTool() : loiApi(503, "Upstream unavailable");
        },
      ]),
      /Upstream unavailable/,
    );
  });

  it("SDK tự thử lại rồi THÀNH CÔNG thì lượt chạy tiếp bình thường", async () => {
    // Đối chứng cho hai test trên. Đường ném-khi-bắt-được-lỗi chỉ đúng nếu
    // `onError` KHÔNG nổ cho lần thử hỏng mà sau đó SDK gọi lại thành công.
    // Nổ thì mọi trục trặc thoáng qua - đúng loại lỗi SDK sinh ra để che - lại
    // giết cả lượt, và hỏng đó chỉ lộ ra trên máy thật.
    let lan = 0;
    const { ket } = await chayLuot([
      () => {
        lan++;
        return lan === 1 ? loiApi(503, "chớp một cái rồi thôi") : traLoi("xong rồi nhé");
      },
    ]);
    assert.equal(ket.text, "xong rồi nhé");
    assert.ok(lan >= 2, `mong SDK gọi lại ít nhất 1 lần, nhận ${lan}`);
  });

  it("lỗi của lần chạy TRƯỚC không giết lần chạy sau trong cùng lượt", async () => {
    // 429 dai dẳng đốt hết 3 lần thử của SDK, rồi `chuaLoiProvider` chờ
    // Retry-After và gọi lại `runOnce` - lần này model trả lời được.
    //
    // Bộ bắt lỗi phải được dựng MỚI cho mỗi `runOnce`. Dùng chung một bộ cho
    // cả lượt thì lỗi 429 cũ vẫn nằm đó và nhánh "có lỗi thì ném" sẽ giết
    // đúng lần chạy vừa cứu được lượt - tức là đường chữa lỗi tự phá chính nó.
    let lan = 0;
    const { ket } = await chayLuot([
      () => {
        lan++;
        return lan <= 3 ? loiApi(429, "Rate limit exceeded") : traLoi("chữa xong, trả lời đây");
      },
    ]);
    assert.equal(ket.text, "chữa xong, trả lời đây");
  });
});

describe("runAgentTurn - isolated (lượt theo lịch của scheduler)", () => {
  const DAU_VET_LICH_SU = "cau-chuyen-cu-rat-dac-trung-khong-the-nham-lan";

  it("mặc định (không truyền isolated) vẫn đọc history - lượt tin nhắn thường không đổi hành vi", async () => {
    history.appendMessage(account.id, "thread-1", { role: "user", content: DAU_VET_LICH_SU });
    const { calls } = await chayLuot([() => traLoi("ok")]);
    assert.ok(promptText(calls[0]!).includes(DAU_VET_LICH_SU), "history cũ phải có mặt trong prompt gửi model");
  });

  it("isolated:true bỏ qua history - lượt theo lịch không đọc hội thoại đang có của thread", async () => {
    history.appendMessage(account.id, "thread-1", { role: "user", content: DAU_VET_LICH_SU });
    const { calls } = await chayLuot([() => traLoi("ok")], [tinNhan()], { isolated: true });
    assert.ok(
      !promptText(calls[0]!).includes(DAU_VET_LICH_SU),
      "history cũ KHÔNG được lọt vào prompt của lượt cô lập",
    );
  });

  it("isolated:true giữ nguyên PERSONA GỐC (base persona, quy tắc an toàn) - chỉ mục 'Khả năng' đổi theo tool thật có", async () => {
    // Sửa sau review (Finding 2): trước đây kỳ vọng 2 system prompt GIỐNG HỆT
    // nhau - kỳ vọng đó SAI, vì buildSystemPrompt không truyền isolated xuống
    // listAvailableTools nên mục "Khả năng" (và luật của add_reaction/save_memory)
    // vẫn liệt kê tool mà schema thật KHÔNG hề cấp. Đúng hành vi bây giờ: phần
    // PERSONA GỐC (câu mở đầu, quy tắc an toàn) giữ y nguyên; phần "Khả năng"
    // ngắn đi đúng 2 tool bị loại (add_reaction, save_memory).
    const binhThuong = await chayLuot([() => traLoi("ok")]);
    const coLap = await chayLuot([() => traLoi("ok")], [tinNhan()], { isolated: true });
    const textBinhThuong = systemText(binhThuong.calls[0]!)!;
    const textCoLap = systemText(coLap.calls[0]!)!;

    assert.notEqual(textCoLap, textBinhThuong, "mục Khả năng PHẢI khác nhau - lượt cô lập thiếu tool bị loại");
    assert.match(textCoLap, /Bạn là trợ lý AI trả lời tin nhắn trên Zalo/, "persona gốc vẫn phải còn nguyên");
    assert.doesNotMatch(textCoLap, /Ghi nhớ lâu dài/, "save_memory không được kể trong mục Khả năng khi cô lập");
    // Đối chứng dùng save_memory chứ KHÔNG dùng add_reaction: từ khi có
    // `keTrongKhaNang`, add_reaction bị loại khỏi mục Khả năng ở CẢ HAI lượt
    // (nó là phép lịch sự lúc trò chuyện, không phải năng lực đáng khoe), nên
    // nó không còn phân biệt được hai nhánh.
    assert.match(textBinhThuong, /Ghi nhớ lâu dài/, "lượt thường (đối chứng) vẫn phải kể save_memory");
    assert.doesNotMatch(textBinhThuong, /Thả cảm xúc/, "add_reaction không đáng khoe ở lượt nào cả");
  });

  it("isolated:true loại add_reaction, save_memory khỏi schema tool gửi model", async () => {
    // read_image cũng bị loại (runsInScheduledTurn:false), nhưng test chi tiết
    // hơn (cấu hình sidecar rồi mới kiểm) nằm ở tool-registry.test.ts - ở đây
    // sidecar chưa cấu hình nên read_image vốn đã vắng mặt vì lý do khác, kiểm
    // nó ở đây sẽ không phân biệt được 2 nguyên nhân.
    const { calls } = await chayLuot([() => traLoi("ok")], [tinNhan()], { isolated: true });
    const toolKeys = calls[0]!.tools?.map((t) => t.name) ?? [];
    for (const key of ["add_reaction", "save_memory"]) {
      assert.ok(!toolKeys.includes(key), `lượt cô lập không được có tool ${key}`);
    }
  });

  it("lượt thường (isolated mặc định false) VẪN có add_reaction trong schema - đúng hành vi cũ", async () => {
    const { calls } = await chayLuot([() => traLoi("ok")]);
    const toolKeys = calls[0]!.tools?.map((t) => t.name) ?? [];
    assert.ok(toolKeys.includes("add_reaction"), "lượt tin nhắn thường không bị ảnh hưởng bởi bộ lọc mới");
  });
});

/**
 * Tiêm tin giữa lượt: người dùng nhắn thêm TRONG LÚC lượt đang chạy thì lượt
 * đó phải đọc luôn, thay vì chạy trọn theo bối cảnh thiếu rồi mới xử lý ở lượt
 * sau. Điểm chèn là `prepareStep` - ranh giới step.
 */
describe("runAgentTurn - tiêm tin giữa lượt", () => {
  const DAU_VET_CHEN = "cho-minh-doi-thanh-file-word-nhe";

  /**
   * Bám phần Ý NGHĨA của nhãn, không bám nguyên văn: câu chữ còn chỉnh nhiều,
   * bám nguyên văn thì mỗi lần chỉnh lại đỏ giả. Nhưng cũng KHÔNG import hằng
   * số vào - hằng bị làm rỗng thì `includes("")` luôn đúng và test hoá vô dụng
   * đúng lúc cần nhất. "đang làm dở" là thứ duy nhất nói cho model biết nó
   * đang bị chen ngang chứ không phải nhận yêu cầu mới.
   */
  const DAU_HIEU_NHAN = "đang làm dở";

  const tinChenGia = (text = DAU_VET_CHEN): ParsedMessage => ({ ...tinNhan(), text, msgId: "m-chen" });

  before(() => {
    // 3 step: đủ để dựng "chèn ở step 1, kiểm step 2 và step 3 vẫn mang theo"
    tuning.setTuning("LLM_MAX_STEPS", 3);
  });
  after(() => {
    tuning.setTuning("LLM_MAX_STEPS", null);
  });

  /**
   * `prepareStep` chạy trước MỌI step, kể cả step đầu. Nên "tin tới giữa lượt"
   * mô phỏng bằng cách trả rỗng ở lần hỏi đầu rồi mới trả tin ở lần sau.
   */
  const chenOLanThu = (lanCanChen: number) => {
    let lan = 0;
    return () => {
      lan++;
      return lan === lanCanChen ? [tinChenGia()] : [];
    };
  };

  it("chèn được NGAY TRƯỚC step đầu - tin tới trong lúc còn đang tải ảnh vẫn kịp", async () => {
    // Giữa lúc bộ gộp chốt batch và lần gọi LLM đầu tiên còn cả bước lưu ảnh và
    // dựng ngữ cảnh (đều async, có tải mạng). Tin tới trong khoảng đó đã đỗ sẵn
    // trong hàng chờ, và nhận nó ngay từ step đầu là đúng - đợi tới step 2 chỉ
    // tổ để model làm một vòng thừa theo yêu cầu cũ.
    const { calls } = await chayLuot([() => traLoi("ok")], [tinNhan()], {
      layTinChen: chenOLanThu(1),
    });
    assert.ok(promptText(calls[0]!).includes(DAU_VET_CHEN), "step đầu phải nhận được tin đã đỗ sẵn");
  });

  it("tin nhắn thêm vào ĐÚNG prompt của step kế tiếp, kèm nhãn nói rõ là chen ngang", async () => {
    const { calls } = await chayLuot([goiTool, () => traLoi("ok")], [tinNhan()], {
      layTinChen: chenOLanThu(2),
    });

    assert.ok(calls.length >= 2, `mong ít nhất 2 lần gọi model, nhận ${calls.length}`);
    assert.ok(
      !promptText(calls[0]!).includes(DAU_VET_CHEN),
      "step ĐẦU chưa được thấy tin chen - lúc đó người ta chưa gửi",
    );
    const promptSau = promptText(calls[1]!);
    assert.ok(promptSau.includes(DAU_VET_CHEN), "step sau phải thấy nội dung tin chen");
    assert.ok(
      promptSau.includes(DAU_HIEU_NHAN),
      "phải kèm nhãn, không thì model đọc nó như một yêu cầu mới hoàn toàn rồi bỏ ngang việc đang làm",
    );
  });

  it("chèn MỘT lần rồi mang theo các step sau - không phải chèn lại từng step", async () => {
    const { calls } = await chayLuot([goiTool, goiTool, () => traLoi("xong")], [tinNhan()], {
      layTinChen: chenOLanThu(2),
    });

    assert.ok(calls.length >= 3, `mong 3 lần gọi model, nhận ${calls.length}`);
    // Bản ghi đè `messages` của prepareStep được AI SDK mang sang các step sau.
    // Không đúng thì tin chen bốc hơi ngay step kế và model quên mất người ta
    // vừa nói gì - đúng cái hỏng đang chữa, chỉ chậm hơn một step.
    assert.ok(promptText(calls[2]!).includes(DAU_VET_CHEN), "step thứ 3 vẫn phải còn tin chen");
    // Và chỉ xuất hiện MỘT lần, không nhân bản qua từng step
    const soLanXuatHien = promptText(calls[2]!).split(DAU_VET_CHEN).length - 1;
    assert.equal(soLanXuatHien, 1, `tin chen bị nhân bản ${soLanXuatHien} lần trong prompt`);
  });

  it("không có tin chen thì prompt KHÔNG dính nhãn - đối chứng", async () => {
    const { calls } = await chayLuot([goiTool, () => traLoi("ok")], [tinNhan()], {
      layTinChen: () => [],
    });
    for (const call of calls) {
      assert.ok(
        !promptText(call).includes(DAU_HIEU_NHAN),
        "không có tin chen mà vẫn dán nhãn là nói dối model",
      );
    }
  });

  it("layTinChen NÉM LỖI thì lượt vẫn chạy trọn - đây là nhánh làm tốt thêm, không phải nhánh bắt buộc", async () => {
    // Lượt đã tốn mấy phút gọi tool; để một lỗi ở đường tiêm giết nó là đổi
    // một tiện ích lấy cả câu trả lời.
    const { ket } = await chayLuot([goiTool, () => traLoi("vẫn trả lời được")], [tinNhan()], {
      layTinChen: () => {
        throw new Error("hàng chờ hỏng");
      },
    });
    assert.equal(ket.text, "vẫn trả lời được");
  });

  it("tắt ở trang Cấu hình thì KHÔNG chen, và cũng không gọi tới hàng chờ", async () => {
    tuning.setTuning("MID_TURN_INJECTION_ENABLED", false);
    try {
      let soLanLay = 0;
      const { calls } = await chayLuot([goiTool, () => traLoi("ok")], [tinNhan()], {
        layTinChen: () => {
          soLanLay++;
          return [tinChenGia()];
        },
      });
      assert.equal(soLanLay, 0, "tắt rồi thì không được đụng vào hàng chờ - đụng là rút tin ra rồi bỏ đi");
      for (const call of calls) {
        assert.ok(!promptText(call).includes(DAU_VET_CHEN));
      }
    } finally {
      tuning.setTuning("MID_TURN_INJECTION_ENABLED", null);
    }
  });

  it("tin chen SỐNG QUA nhánh thử lại completion rỗng - không bị đánh rơi", async () => {
    // Hàng chờ đã bị `layTinDangDo` XÓA nên tin không lấy lại được. Lần chạy
    // thứ hai dựng ngữ cảnh từ biến `messages` của agent-loop, mà tin chen chưa
    // từng vào đó - không gắn lại là tin biến mất vĩnh viễn: nó nằm trong
    // history nhưng KHÔNG lượt nào trả lời nó. Tệ hơn hành vi trước khi có
    // tính năng này (hồi đó nó được hẳn một lượt riêng).
    let soLanLay = 0;
    const { calls } = await chayLuot([rong, () => traLoi("lần hai ổn")], [tinNhan()], {
      layTinChen: () => {
        soLanLay++;
        return soLanLay === 1 ? [tinChenGia()] : [];
      },
    });

    assert.ok(calls.length >= 2, `mong 2 lần chạy, nhận ${calls.length}`);
    assert.ok(
      promptText(calls[calls.length - 1]!).includes(DAU_VET_CHEN),
      "lần chạy SAU retry vẫn phải mang tin chen",
    );
  });

  it("tin chen có mặt trong LƯỢT CHỐT - nơi sinh ra câu trả lời gửi xuống Zalo", async () => {
    // Lượt chạm trần step đi vào `runWrapUp`, và text của lượt chốt mới là thứ
    // được gửi. Lượt càng dài càng dễ chạm trần, mà cũng chính lượt dài mới có
    // thời gian cho người ta kịp nhắn thêm - nên đây là ca THƯỜNG GẶP chứ không
    // phải ca biên. Rơi tin ở đây là người nhắn nhận câu soạn theo yêu cầu CŨ,
    // còn model thì được dặn "trả lời NGAY BÂY GIỜ" nên không nói ra được.
    tuning.setTuning("LLM_MAX_STEPS", 2);
    try {
      let soLanLay = 0;
      // Cả 2 step đều gọi tool -> hết trần -> lượt chốt
      const { calls } = await chayLuot([goiTool], [tinNhan()], {
        layTinChen: () => {
          soLanLay++;
          return soLanLay === 1 ? [tinChenGia()] : [];
        },
      });

      const promptChot = promptText(calls[calls.length - 1]!);
      assert.ok(
        promptChot.includes("trả lời người dùng NGAY BÂY GIỜ"),
        "lần gọi cuối phải đúng là lượt chốt",
      );
      assert.ok(promptChot.includes(DAU_VET_CHEN), "LƯỢT CHỐT PHẢI CÓ TIN CHEN");
    } finally {
      tuning.setTuning("LLM_MAX_STEPS", 3);
    }
  });

  it("HAI nhánh chữa lỗi nối nhau vẫn chỉ MỘT bản tin chen - không cộng dồn", async () => {
    // Bộ test cũ chỉ đo CÓ MẶT (`includes`) trong một lần chạy, nên không thấy
    // được ca này. Đường gắn lại tin chen không idempotent: gán ngược vào biến
    // `messages` ở từng nhánh thì hai nhánh nối nhau cho ra hai bản y hệt, và
    // model đọc ra "người này nhắc lại hai lần" đúng lúc nó đang được dặn đừng
    // làm lại thứ đã xong.
    tuning.setTuning("LLM_MAX_STEPS", 3);
    let soLanLay = 0;
    // Lần 1: tràn ngữ cảnh (chữa -> chạy lại). Lần 2: completion rỗng (chữa ->
    // chạy lại). Lần 3: trả lời được.
    //
    // CỐ Ý chọn cặp nhánh KHÔNG NGỦ. Cặp `429 -> rỗng` cũng dựng được ca này
    // nhưng nhánh 429 chờ thật 5 giây cộng 3 lần thử của SDK - hơn 11 giây mỗi
    // lần chạy test. Nó không chỉ chậm: đốt timer lâu như vậy làm nghẽn cả bộ
    // test chạy song song và đã làm một test lịch hẹn (margin 20 ms) đỏ lúc
    // được lúc không. 400 không được SDK thử lại nên cặp này chạy trong mili giây.
    let lan = 0;
    const { calls } = await chayLuot(
      [
        () => {
          lan++;
          if (lan === 1) return loiApi(400, "prompt is too long");
          if (lan === 2) return rong();
          return traLoi("xong");
        },
      ],
      [tinNhan()],
      {
        layTinChen: () => {
          soLanLay++;
          return soLanLay === 1 ? [tinChenGia()] : [];
        },
      },
    );

    const cuoi = promptText(calls[calls.length - 1]!);
    const soBan = cuoi.split(DAU_VET_CHEN).length - 1;
    assert.ok(cuoi.includes(DAU_VET_CHEN), "tin chen phải sống qua cả hai nhánh chữa lỗi");
    assert.equal(soBan, 1, `tin chen bị nhân thành ${soBan} bản trong prompt cuối`);
  });

  it("sau nhánh chữa lỗi, LƯỢT CHỐT vẫn giữ được CÂU HỎI GỐC", async () => {
    // `runWrapUp` lấy câu hỏi bằng `messages[length - 1]`. Gán tin chen ngược
    // vào `messages` là phần tử cuối thành tin chen, câu hỏi gốc rơi vào vùng
    // bị cắt - mở lại đúng cái bẫy mà khối chú thích ở `runWrapUp` nói đã vá.
    tuning.setTuning("LLM_MAX_STEPS", 2);
    // Ngữ cảnh CHẬT để lượt chốt thật sự phải cắt. Không ép cắt thì câu hỏi gốc
    // sống sót kể cả khi nó rơi khỏi đuôi được bảo vệ, và test xanh giả - đã
    // dính đúng vậy ở bản đầu của chính test này.
    tuning.setTuning("LLM_CONTEXT_WINDOW", 3_000);
    const goiToolCongKenh = () => ({
      ...goiTool(),
      content: [...goiTool().content, { type: "text" as const, text: "phần đệm ".repeat(2_000) }],
    });
    try {
      let soLanLay = 0;
      let lan = 0;
      const { calls } = await chayLuot(
        [
          () => {
            lan++;
            if (lan === 1) return rong(); // buộc đi qua nhánh chữa
            return goiToolCongKenh(); // step nào cũng gọi tool -> hết trần -> lượt chốt
          },
        ],
        [tinNhan()],
        {
          layTinChen: () => {
            soLanLay++;
            return soLanLay === 1 ? [tinChenGia()] : [];
          },
        },
      );

      const promptChot = promptText(calls[calls.length - 1]!);
      assert.ok(
        promptChot.includes("trả lời người dùng NGAY BÂY GIỜ"),
        "lần gọi cuối phải đúng là lượt chốt",
      );
      // Đuôi được bảo vệ của lượt chốt là [câu hỏi, tin chen, lời nhắc] - ba
      // tin không bao giờ bị cắt. Câu hỏi rơi khỏi đó là nó vào vùng bị cắt, và
      // chỉ cần ngữ cảnh đủ nặng là mất hẳn.
      assert.ok(
        promptDuoi(calls[calls.length - 1]!, 3).includes(tinNhan().text),
        "CÂU HỎI GỐC phải nằm trong ĐUÔI ĐƯỢC BẢO VỆ - rơi ra ngoài là model chốt lại mà không biết người ta hỏi gì",
      );
    } finally {
      tuning.setTuning("LLM_MAX_STEPS", 3);
      tuning.setTuning("LLM_CONTEXT_WINDOW", null);
    }
  });

  it("lượt theo lịch: agent-loop KHÔNG tự chặn theo isolated - chặn nằm ở call site", async () => {
    let soLanLay = 0;
    await chayLuot([goiTool, () => traLoi("ok")], [tinNhan()], {
      isolated: true,
      // `run-scheduled-job.ts` không truyền `layTinChen`; test truyền vào để
      // khẳng định rằng kể cả khi có, lượt cô lập vẫn không dính tin của thread.
      layTinChen: () => {
        soLanLay++;
        return [];
      },
    });
    // Ghi lại hành vi THẬT: lượt cô lập không tự chặn, nó chỉ không được truyền
    // hàm này ở đường chạy thật. Nếu sau này có ai truyền vào thì phải quyết
    // định có chặn ở agent-loop hay không - test này sẽ đỏ và bắt đọc lại chỗ đó.
    assert.ok(soLanLay > 0, "hiện tại agent-loop KHÔNG tự chặn theo isolated - chặn nằm ở call site");
  });
});
