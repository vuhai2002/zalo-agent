import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
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

const AGENT = {
  id: "agent-test",
  name: "Trợ lý",
  persona: "",
  model: null,
  maxSteps: null,
} as never;

const MSG = {
  senderName: "Hải",
  isGroup: false,
  threadId: "t-1",
} as ParsedMessage;

function account(disabledTools: string[]) {
  return { id: "acc-1", disabledTools } as never;
}

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
        message: MSG,
        batch: [],
      }),
    ).sort();
    const listed = registry.listAvailableTools(account(disabled)).map((t) => t.key).sort();
    assert.deepEqual(listed, built, "lệch nhau là prompt kể sai bộ tool model thực nhận");
  });


  it("dạy model kể tiến trình khi dùng tool - nguồn của khối 'Model nói' trong trace", () => {
    // User cần xem model nhận xét gì sau mỗi lượt tool (đủ nguồn chưa, bước kế
    // là gì). OpenAI không phơi chain-of-thought nên lời dẫn TỰ VIẾT này là
    // đường duy nhất - đã đo thật: gpt-5.6-sol chịu viết kèm tool call khi được
    // dặn, và không kể lể ở câu hỏi không cần tool.
    const text = prompt.buildSystemPrompt(AGENT, MSG);
    assert.match(text, /tiến trình/);
    assert.match(text, /TRƯỚC mỗi lần gọi tool/);
  });

  it("không truyền account thì vẫn dựng được prompt (đường gọi cũ không vỡ)", () => {
    const text = prompt.buildSystemPrompt(AGENT, MSG);
    assert.match(text, /trợ lý AI/i);
  });
});
