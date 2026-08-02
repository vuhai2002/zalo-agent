import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { fakeAgentProfile } from "../shared/fake-agent-profile.js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";

/**
 * System prompt phải kể ĐÚNG bộ tool account đang có. Persona tĩnh kể tên tool
 * cứng thì tắt tool đi bot vẫn hứa làm được - người dùng hỏi "làm được gì" sẽ
 * nhận câu trả lời sai.
 */

let dataDir: string;
let prompt: typeof import("./persona-prompt.js");
let registry: typeof import("./tools/tool-registry.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  prompt = await import("./persona-prompt.js");
  registry = await import("./tools/tool-registry.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

// Dùng fixture thật thay vì literal ép `as never`: từ khi agent là một trong
// hai lớp lọc tool, thiếu `disabledTools` sẽ nổ ngay ở phép gộp hai danh sách
// tắt trong `listAvailableTools` - mà `as never` thì TypeScript không hé răng.
const AGENT = fakeAgentProfile({ name: "Trợ lý" });

const MSG = {
  senderName: "Hải",
  isGroup: false,
  threadId: "t-1",
} as ParsedMessage;

function account(disabledTools: string[]) {
  return { id: "acc-1", disabledTools } as never;
}

/** Agent tắt sẵn vài tool - dùng cho các ca kiểm lớp lọc phía agent */
const agentTat = (disabledTools: string[]) => fakeAgentProfile({ disabledTools });

describe("buildSystemPrompt - danh sách tool đang bật", () => {
  it("kể tên tool đang bật kèm mô tả ngắn", () => {
    const text = prompt.buildSystemPrompt(AGENT, MSG, undefined, account([]));
    assert.match(text, /Tìm kiếm web/, "phải có nhãn tiếng Việt để bot nói cho người thường nghe");
    assert.match(text, /Tạo file Excel/);
  });

  it("tool bị tắt KHÔNG xuất hiện - bot không hứa thứ nó không có", () => {
    const text = prompt.buildSystemPrompt(AGENT, MSG, undefined, account(["create_excel_file", "web_search"]));
    assert.doesNotMatch(text, /Tạo file Excel/);
    assert.doesNotMatch(text, /Tìm kiếm web/);
    assert.match(text, /Tạo file Word/, "tool không tắt vẫn phải còn");
  });

  it("tool chưa đủ hạ tầng cũng không xuất hiện (cùng bộ lọc với buildAgentTools)", () => {
    // create_image chưa cấu hình endpoint -> available() false
    const text = prompt.buildSystemPrompt(AGENT, MSG, undefined, account([]));
    assert.doesNotMatch(text, /Vẽ ảnh AI/);
  });

  it("dặn model trả lời câu hỏi khả năng theo ĐÚNG danh sách này", () => {
    const text = prompt.buildSystemPrompt(AGENT, MSG, undefined, account([]));
    assert.match(text, /làm được gì|khả năng/i);
  });

  it("danh sách khớp CHÍNH XÁC bộ tool buildAgentTools dựng ra - một nguồn sự thật", () => {
    const disabled = ["send_file", "add_reaction"];
    const built = Object.keys(
      registry.buildAgentTools({
        api: {} as never,
        account: account(disabled),
        agent: AGENT,
        message: MSG,
        batch: [],
      }),
    ).sort();
    const listed = registry
      .listAvailableTools({ agent: AGENT, account: account(disabled) })
      .map((t) => t.key)
      .sort();
    assert.deepEqual(listed, built, "lệch nhau là prompt kể sai bộ tool model thực nhận");
  });

  it("tool bị AGENT tắt cũng không xuất hiện trong prompt", () => {
    // Lớp thứ hai: trước phase này chỉ account tắt được tool, nên prompt kể cả
    // tool mà chính agent đã tắt.
    const text = prompt.buildSystemPrompt(agentTat(["web_search"]), MSG, undefined, account([]));
    assert.doesNotMatch(text, /Tìm kiếm web/);
    assert.match(text, /Đọc trang web/, "tool agent không tắt vẫn phải còn");
  });

  it("prompt khớp schema CẢ KHI hai lớp tắt hai tool khác nhau", () => {
    const ag = agentTat(["web_search"]);
    const acc = account(["create_excel_file"]);
    const built = Object.keys(
      registry.buildAgentTools({ api: {} as never, account: acc, agent: ag, message: MSG, batch: [] }),
    ).sort();
    const listed = registry.listAvailableTools({ agent: ag, account: acc }).map((t) => t.key).sort();
    assert.deepEqual(listed, built);
    assert.ok(!built.includes("web_search"), "agent tắt phải mất");
    assert.ok(!built.includes("create_excel_file"), "account tắt phải mất");

    const text = prompt.buildSystemPrompt(ag, MSG, undefined, acc);
    assert.doesNotMatch(text, /Tìm kiếm web/);
    assert.doesNotMatch(text, /Tạo file Excel/);
  });


  it("dạy model kể tiến trình khi dùng tool - nguồn của khối 'Model nói' trong trace", () => {
    // User cần xem model nhận xét gì sau mỗi lượt tool (đủ nguồn chưa, bước kế
    // là gì). OpenAI không phơi chain-of-thought nên lời dẫn TỰ VIẾT này là
    // đường duy nhất - đã đo thật: gpt-5.6-sol chịu viết kèm tool call khi được
    // dặn, và không kể lể ở câu hỏi không cần tool.
    const text = prompt.buildSystemPrompt(AGENT, MSG, undefined, account([]));
    assert.match(text, /tiến trình/);
    assert.match(text, /TRƯỚC mỗi lần gọi tool/);
  });

  it("không truyền account thì KHÔNG dạy luật tool nào - không biết tool nào bật thì đừng đoán", () => {
    // Đường gọi cũ (không có account) giờ fail-closed: thà thiếu luật còn hơn
    // dạy luật của tool model không hề nhận được. Production luôn truyền account.
    const text = prompt.buildSystemPrompt(AGENT, MSG);
    assert.doesNotMatch(text, /tiến trình/);
    assert.doesNotMatch(text, /web_search/);
  });

  it("không truyền account thì vẫn dựng được prompt (đường gọi cũ không vỡ)", () => {
    const text = prompt.buildSystemPrompt(AGENT, MSG);
    assert.match(text, /trợ lý AI/i);
  });

  it("isolated=true (lượt theo lịch): KHÔNG kể 9 tool bị runsInScheduledTurn:false - khớp CHÍNH XÁC với schema thật (Finding 2)", () => {
    // Trước fix: buildSystemPrompt gọi listAvailableTools(account) không
    // truyền cờ isolated, trong khi buildAgentTools (agent-loop.ts) CÓ lọc -
    // prompt quảng cáo "Ghi nhớ lâu dài"/"Thả cảm xúc" trong khi schema gửi
    // model không hề có 2 tool đó. Model tự nhận "mình đã ghi nhớ" mà chẳng
    // lưu gì - đúng bug bất biến ở dòng test dưới đã canh cho lượt THƯỜNG.
    const acc = account([]);
    const textCoLap = prompt.buildSystemPrompt(AGENT, MSG, undefined, acc, true);
    const textThuong = prompt.buildSystemPrompt(AGENT, MSG, undefined, acc, false);

    assert.doesNotMatch(textCoLap, /Ghi nhớ lâu dài/, "save_memory không được kể khi isolated");
    assert.doesNotMatch(textCoLap, /Thả cảm xúc/, "add_reaction không được kể khi isolated");
    assert.match(textThuong, /Ghi nhớ lâu dài/, "lượt thường (isolated=false) vẫn phải kể - đối chứng cho ca trên");

    const listedIsolated = registry
      .listAvailableTools({ agent: AGENT, account: acc }, { isolated: true })
      .map((t) => t.key)
      .sort();
    const builtIsolated = Object.keys(
      registry.buildAgentTools({
        api: {} as never,
        account: acc,
        agent: AGENT,
        message: MSG,
        batch: [],
        isolated: true,
      }),
    ).sort();
    assert.deepEqual(listedIsolated, builtIsolated, "prompt (qua listAvailableTools) và schema (buildAgentTools) phải khớp cả khi isolated");
  });
});
