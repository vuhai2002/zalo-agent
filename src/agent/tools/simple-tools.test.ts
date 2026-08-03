import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import type { API } from "zca-js";
import { ThreadType } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";
import { ketQuaThanhCong, loiCuaTool } from "./tool-failure-result-test-helper.js";
import type { AccountConfig } from "../../config/account-store.js";
import type { ParsedMessage } from "../../zalo/zalo-message-parser.js";

/**
 * Bốn tool đơn giản trước đây KHÔNG có test nào: `send_file`, `add_reaction`,
 * `save_memory`, `get_group_info`.
 *
 * Chúng nhỏ nên dễ bị coi là hiển nhiên đúng, nhưng cả bốn đều nằm trong quy
 * ước `ketQuaLoi` (bộ chặn vòng lặp đếm dựa vào đó) và ba trong bốn cái gọi
 * thẳng `api.sendMessage`/`addReaction` - tức là đường ra Zalo thật. Không test
 * thì quên bọc một nhánh hỏng, hay bọc nhầm nhánh thành công, đều không đỏ.
 *
 * Kiểm CẢ HAI CHIỀU cho mỗi tool: hỏng phải đánh dấu được, thành công phải là
 * chuỗi trần.
 */

let dataDir: string;
let sendFile: typeof import("./send-file-tool.js");
let addReaction: typeof import("./add-reaction-tool.js");
let saveMemory: typeof import("./save-memory-tool.js");
let groupInfo: typeof import("./get-group-info-tool.js");
let memoryStore: typeof import("../../conversation/memory-store.js");
let database: typeof import("../../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  sendFile = await import("./send-file-tool.js");
  addReaction = await import("./add-reaction-tool.js");
  saveMemory = await import("./save-memory-tool.js");
  groupInfo = await import("./get-group-info-tool.js");
  memoryStore = await import("../../conversation/memory-store.js");
  database = await import("../../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

let daGui: string[] = [];
let daReact: unknown[] = [];
/** Đặt để ép api ném - dựng nhánh catch của tool */
let apiNem: string | null = null;

beforeEach(() => {
  daGui = [];
  daReact = [];
  apiNem = null;
});

const api = {
  sendMessage: async (payload: { msg?: string }) => {
    if (apiNem) throw new Error(apiNem);
    daGui.push(payload?.msg ?? "");
    return { msgId: "m1" };
  },
  addReaction: async (icon: unknown) => {
    if (apiNem) throw new Error(apiNem);
    daReact.push(icon);
    return {};
  },
  getGroupInfo: async (threadId: string) => {
    if (apiNem) throw new Error(apiNem);
    return { gridInfoMap: { [threadId]: { name: "Nhóm thử", totalMember: 3, memVerList: ["u1_1", "u2_1"] } } };
  },
} as unknown as API;

const account = { id: "acc-simple", label: "T" } as AccountConfig;

const message = (over: Partial<ParsedMessage> = {}): ParsedMessage =>
  ({
    accountId: account.id,
    threadId: "t-simple",
    threadType: ThreadType.User,
    isGroup: false,
    senderId: "u1",
    senderName: "Hải",
    text: "",
    images: [],
    msgId: "m0",
    cliMsgId: "c0",
    isSelf: false,
    mentionsMe: false,
    rawData: {},
    ...over,
  }) as ParsedMessage;

/* eslint-disable @typescript-eslint/no-explicit-any */
const chay = (tool: unknown, input: unknown): Promise<unknown> => (tool as any).execute(input, {});
const ctx = (msg: ParsedMessage) => ({ api, account, message: msg }) as any;

describe("send_file", () => {
  it("file không có trong kho -> nhánh HỎNG có đánh dấu, KHÔNG gửi gì", async () => {
    const ra = await chay(sendFile.createSendFileTool(ctx(message())), {
      source: "khong-co-file-nay.pdf",
    });
    assert.match(loiCuaTool(ra), /Không có file/);
    assert.equal(daGui.length, 0);
  });

  it("chặn path traversal - KHÔNG đọc được file có thật ngoài kho shared-files", async () => {
    // Phải dựng file CÓ THẬT ngoài kho mới đo được. Bản đầu của ca này dùng
    // "../../.env" - file đó không tồn tại trong thư mục tạm nên cả hai chiều
    // đều trả "không có file", và gỡ `path.basename` mà test vẫn xanh (đã đo).
    //
    // `data/` chứa cookie Zalo đã mã hóa và DB - đọc được file tùy ý ở đó rồi
    // gửi vào chat là đường rò dữ liệu thật, mà nguồn file thì do model quyết
    // và model đọc tin của người lạ.
    const beNgoai = path.join(dataDir, "bi-mat.txt");
    fs.writeFileSync(beNgoai, "NOI DUNG BI MAT", "utf-8");

    const ra = await chay(sendFile.createSendFileTool(ctx(message())), {
      source: "../bi-mat.txt",
    });
    assert.ok(loiCuaTool(ra).length > 0, "phải từ chối - `path.basename` là hàng rào duy nhất ở đây");
    assert.equal(daGui.length, 0, "TUYỆT ĐỐI không được gửi file ngoài kho");
  });

  it("api ném -> bắt lại thành nhánh hỏng, KHÔNG ném ra agent loop", async () => {
    apiNem = "Zalo từ chối";
    const ra = await chay(sendFile.createSendFileTool(ctx(message())), {
      source: "http://127.0.0.1:9/x",
    });
    assert.ok(loiCuaTool(ra).length > 0);
  });
});

describe("add_reaction", () => {
  it("thiếu msgId -> nhánh HỎNG (lượt theo lịch không có tin thật để thả vào)", async () => {
    const ra = await chay(addReaction.createAddReactionTool(ctx(message({ msgId: "" }))), {
      reaction: "heart",
    });
    assert.match(loiCuaTool(ra), /msgId/);
    assert.equal(daReact.length, 0);
  });

  it("thả được -> chuỗi trần, và CÓ gọi api", async () => {
    const ra = await chay(addReaction.createAddReactionTool(ctx(message())), { reaction: "haha" });
    assert.match(ketQuaThanhCong(ra), /Đã thả reaction/);
    assert.equal(daReact.length, 1);
  });

  it("api ném -> nhánh hỏng có đánh dấu", async () => {
    apiNem = "rate limit";
    const ra = await chay(addReaction.createAddReactionTool(ctx(message())), { reaction: "like" });
    assert.match(loiCuaTool(ra), /rate limit/);
  });
});

describe("save_memory", () => {
  it("lưu fact về người nhắn -> chuỗi trần, và fact vào DB thật", async () => {
    const ra = await chay(saveMemory.createSaveMemoryTool(ctx(message({ senderId: "u-nho" }))), {
      content: "Anh Hải thích cà phê đen, không đường",
      about: "sender",
    });
    assert.match(ketQuaThanhCong(ra), /Đã ghi nhớ/);

    const facts = memoryStore.getMemoriesForContext({
      accountId: account.id,
      threadId: "t-simple",
      senderId: "u-nho",
      isGroup: false,
    });
    assert.ok(facts.some((f) => f.content.includes("cà phê đen")), "fact phải vào DB");
  });

  it("thiếu đối tượng để lưu -> nhánh HỎNG, không ghi gì", async () => {
    const ra = await chay(saveMemory.createSaveMemoryTool(ctx(message({ senderId: "" }))), {
      content: "gì đó đủ dài để qua schema",
      about: "sender",
    });
    assert.match(loiCuaTool(ra), /Không xác định được đối tượng/);
  });
});

describe("get_group_info", () => {
  it("chat riêng -> nhánh HỎNG (gọi lặp phải bị bộ chặn đếm)", async () => {
    const ra = await chay(groupInfo.createGetGroupInfoTool(ctx(message({ isGroup: false }))), {});
    assert.match(loiCuaTool(ra), /chat riêng/);
  });

  it("trong nhóm -> chuỗi trần có tên nhóm và số thành viên", async () => {
    const ra = await chay(
      groupInfo.createGetGroupInfoTool(ctx(message({ isGroup: true, threadType: ThreadType.Group }))),
      {},
    );
    const text = ketQuaThanhCong(ra);
    assert.match(text, /Nhóm thử/);
    assert.match(text, /Số thành viên: 3/);
  });

  it("api ném -> nhánh hỏng có đánh dấu, không ném ra agent loop", async () => {
    apiNem = "mạng chập";
    const ra = await chay(
      groupInfo.createGetGroupInfoTool(ctx(message({ isGroup: true, threadType: ThreadType.Group }))),
      {},
    );
    assert.match(loiCuaTool(ra), /mạng chập/);
  });
});
