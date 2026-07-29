import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let rules: typeof import("./persona-tool-rules.js");
let registry: typeof import("./tools/tool-registry.js");
let persona: typeof import("./persona-prompt.js");

before(async () => {
  dataDir = setupTestEnv();
  rules = await import("./persona-tool-rules.js");
  registry = await import("./tools/tool-registry.js");
  persona = await import("./persona-prompt.js");
});

after(async () => {
  (await import("../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

const gop = (keys: string[]) => rules.toolPersonaSections(keys).join("\n\n");

describe("toolPersonaSections", () => {
  it("mọi key tool trong luật phải có thật trong registry", () => {
    const coThat = new Set(registry.TOOL_KEYS);
    const ma = rules.TOOL_KEYS_IN_RULES.filter((k) => !coThat.has(k));
    assert.deepEqual(
      ma,
      [],
      "key không còn trong registry = luật đó vĩnh viễn không bao giờ hiện, mà không ai biết",
    );
  });

  it("tắt create_image thì KHÔNG còn dòng nào dạy vẽ ảnh", () => {
    const bat = gop(["create_image", "web_search"]);
    const tat = gop(["web_search"]);
    assert.ok(bat.includes("create_image"), "bật thì phải có luật vẽ ảnh");
    assert.ok(!tat.includes("create_image"), "tắt rồi mà vẫn dạy cách viết prompt vẽ ảnh");
    assert.ok(!tat.includes("sua_anh_da_gui"));
  });

  it("tắt tool tạo file thì không còn luật xuất file", () => {
    const tat = gop(["web_search"]);
    assert.ok(!tat.includes("create_word_document"));
    assert.ok(!tat.includes("create_excel_file"));
  });

  it("còn một trong hai tool tạo file thì luật vẫn hiện", () => {
    assert.ok(gop(["create_excel_file"]).includes("create_excel_file"));
  });

  it("không còn tool nào thì không có khối luật nào - kể cả kể tiến trình", () => {
    assert.deepEqual(rules.toolPersonaSections([]), []);
  });

  it("có tool nhưng không phải tool web: vẫn giữ luật chung, bỏ luật web", () => {
    const chiVeAnh = gop(["create_image"]);
    assert.ok(chiVeAnh.includes("kể tiến trình"), "luật chung về dùng tool phải còn");
    assert.ok(!chiVeAnh.includes("web_search"), "không có tool web thì đừng dạy web_search");
    assert.ok(chiVeAnh.includes("không bịa số liệu"), "luật chống bịa áp cho mọi tool");
  });
});

describe("buildSystemPrompt ghép luật theo tool đang bật", () => {
  const agent = { id: "a", name: "test", persona: "", maxSteps: null } as never;
  const msg = {
    threadId: "t1",
    senderName: "Hải",
    senderId: "u1",
    isGroup: false,
    text: "hi",
    images: [],
  } as never;

  it("tắt tool trên dashboard thì luật của tool đó biến mất khỏi prompt", () => {
    const day = persona.buildSystemPrompt(agent, msg, undefined, { disabledTools: [] });
    const tat = persona.buildSystemPrompt(agent, msg, undefined, {
      disabledTools: ["create_word_document", "create_excel_file", "web_search", "web_fetch"],
    });

    assert.ok(day.includes("create_word_document"), "bật hết thì prompt có luật xuất file");
    assert.ok(day.includes("web_search"), "bật hết thì prompt có luật tra web");
    assert.ok(!tat.includes("create_word_document"), "đây chính là phần chữ từng đi kèm mọi lượt");
    assert.ok(!tat.includes("web_search"));
    assert.ok(!tat.includes("Tạo file Word"), "mục Khả năng cũng phải bỏ tool đó");
    assert.ok(tat.length < day.length);
  });

  it("tool chưa cấu hình hạ tầng cũng không được dạy luật", () => {
    // create_image có available() = isImageGenConfigured(), test env chưa cấu
    // hình endpoint vẽ -> model KHÔNG nhận được tool, prompt cũng đừng dạy nó
    const day = persona.buildSystemPrompt(agent, msg, undefined, { disabledTools: [] });
    assert.ok(!day.includes("create_image"));
    assert.ok(!day.includes("Vẽ ảnh AI"));
  });

  it("account không còn tool nào: prompt không dạy luật tool nào nữa", () => {
    const khongTool = persona.buildSystemPrompt(agent, msg, undefined, {
      disabledTools: registry.TOOL_KEYS,
    });
    assert.ok(khongTool.includes("KHÔNG có công cụ nào được bật"));
    assert.ok(!khongTool.includes("kể tiến trình"));
    assert.ok(!khongTool.includes("web_search"));
    // Luật an toàn thì KHÔNG phụ thuộc tool - còn nguyên
    assert.ok(khongTool.includes("chuyển tiền"));
    assert.ok(khongTool.includes("noi_dung_ngoai"));
  });
});
