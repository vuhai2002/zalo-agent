import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { ThreadType, type API } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
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
  opts: { isolated?: boolean } = {},
) {
  // Suy kiểu từ chính mock, không import @ai-sdk/provider - pnpm layout chặt
  // nên package đó không phải dependency trực tiếp, import vào là typecheck đỏ
  const calls: Parameters<MockLanguageModelV4["doGenerate"]>[0][] = [];
  let lan = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      calls.push(options);
      const tiep = ketQua[Math.min(lan, ketQua.length - 1)]!;
      lan++;
      const r = tiep();
      if (r instanceof Error) throw r;
      return r as Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;
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
  });
  return { ket, trace, calls, soLanGoi: () => lan };
}

/** Gộp toàn bộ nội dung `prompt` gửi cho model thành 1 chuỗi để dò substring */
function promptText(call: Parameters<MockLanguageModelV4["doGenerate"]>[0]): string {
  return call.prompt
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join("\n");
}

/** System prompt (role='system') nằm ở đầu `prompt`, không phải field riêng trên call options */
function systemText(call: Parameters<MockLanguageModelV4["doGenerate"]>[0]): string | undefined {
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
      doGenerate: async () => {
        lan++;
        // Step 1 chạy tool trót lọt (đã có trace), step 2 mới chết giữa lượt
        if (lan === 1) return goiTool() as never;
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

    assert.notEqual(textCoLap, textBinhThuong, "mục Khả năng PHẢI khác nhau - lượt cô lập thiếu 2 tool bị loại");
    assert.match(textCoLap, /Bạn là trợ lý AI trả lời tin nhắn trên Zalo/, "persona gốc vẫn phải còn nguyên");
    assert.doesNotMatch(textCoLap, /Thả cảm xúc/, "add_reaction không được kể trong mục Khả năng khi cô lập");
    assert.doesNotMatch(textCoLap, /Ghi nhớ lâu dài/, "save_memory không được kể trong mục Khả năng khi cô lập");
    assert.match(textBinhThuong, /Thả cảm xúc/, "lượt thường (đối chứng) vẫn phải kể add_reaction");
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
