import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { ThreadType, type API } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import { thanhKetQuaStream, type KetQuaGenerate } from "../agent/streaming-model-test-helper.js";
import type { AccountConfig } from "../config/account-store.js";
import type { ParsedMessage } from "./zalo-message-parser.js";

/**
 * Tin do TOOL gửi thẳng xuống Zalo phải vào history, ĐÚNG THỨ TỰ.
 *
 * 5 tool (`send_file`, 2 tool tạo tài liệu, `create_image`, `tag_member`) gọi
 * thẳng `enqueueSend`, không đi qua `deliverChatReply` - mà đó là chỗ DUY NHẤT
 * gọi `appendMessage`. Đo trên bản chạy thật: bot gửi 3 tin trên Zalo (câu dẫn,
 * file .docx, câu chốt) mà dashboard chỉ hiện 1.
 *
 * Hỏng nặng hơn nằm ở chỗ history CHÍNH LÀ thứ model đọc lại ở lượt sau: gửi
 * file xong mà không ghi thì bot không nhớ mình đã gửi, hỏi lại là nó dựng lại
 * từ đầu.
 */

let dataDir: string;
let processor: typeof import("./message-turn-processor.js");
let accountStore: typeof import("../config/account-store.js");
let historyStore: typeof import("../conversation/history-store.js");
let database: typeof import("../conversation/database.js");

const ACC = "acc-tool-send";
const THREAD = "t-tool-send";
const TEN_FILE = "bang-gia-test.txt";

before(async () => {
  dataDir = setupTestEnv();
  processor = await import("./message-turn-processor.js");
  accountStore = await import("../config/account-store.js");
  historyStore = await import("../conversation/history-store.js");
  database = await import("../conversation/database.js");
  accountStore.createAccount({ id: ACC, label: "Test" });

  // `send_file` chỉ cho gửi file nằm trong kho shared-files
  const khoFile = path.join(dataDir, "shared-files");
  fs.mkdirSync(khoFile, { recursive: true });
  fs.writeFileSync(path.join(khoFile, TEN_FILE), "noi dung gia");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

let daGui: { msg: string; coFile: boolean }[] = [];
beforeEach(() => {
  daGui = [];
  database.db.prepare("DELETE FROM messages WHERE thread_id = ?").run(THREAD);
});

const config: AccountConfig = {
  id: ACC,
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

const api = {
  getOwnId: () => "self-1",
  sendMessage: async (payload: { msg: string; attachments?: string[] }) => {
    daGui.push({ msg: payload.msg, coFile: (payload.attachments?.length ?? 0) > 0 });
    return { msgId: `m-${daGui.length}` };
  },
  sendTypingEvent: async () => ({}),
  addReaction: async () => ({}),
  sendSeenEvent: async () => ({}),
} as unknown as API;

const tinNhan = (text: string): ParsedMessage => ({
  accountId: ACC,
  threadId: THREAD,
  threadType: ThreadType.User,
  isGroup: false,
  senderId: "user-1",
  senderName: "Hải",
  text,
  images: [],
  msgId: "m1",
  cliMsgId: "c1",
  isSelf: false,
  mentionsMe: false,
  rawData: {},
});

/** Step 1 gọi send_file, step 2 chốt bằng text */
function modelGoiSendFile(caption: string, cauChot: string) {
  let lan = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      lan++;
      const ketQua =
        lan === 1
          ? {
              content: [
                {
                  type: "tool-call" as const,
                  toolCallId: "call-1",
                  toolName: "send_file",
                  input: JSON.stringify({ source: TEN_FILE, caption }),
                },
              ],
              finishReason: "tool-calls" as const,
              usage: {
                inputTokens: { total: 60, noCache: 60, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 15, text: 15, reasoning: 0 },
              },
              warnings: [],
            }
          : {
              content: [{ type: "text" as const, text: cauChot }],
              finishReason: "stop" as const,
              usage: {
                inputTokens: { total: 60, noCache: 60, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 15, text: 15, reasoning: 0 },
              },
              warnings: [],
            };
      return thanhKetQuaStream(ketQua as unknown as KetQuaGenerate);
    },
  });
}

const noiDungHistory = (): { role: string; content: string }[] =>
  historyStore.getRecentMessages(ACC, THREAD).map((m) => ({ role: m.role, content: m.content }));

describe("processBatch - tin do tool gửi vào history", () => {
  it("file bot gửi có mặt trong history, kèm tên file và caption", async () => {
    await processor.processBatch(config, api, [tinNhan("gửi mình bảng giá")], {
      resolveModel: () => modelGoiSendFile("Bảng giá đây anh nhé", "Em gửi rồi ạ"),
    });

    // Trên Zalo là 2 tin: tin kèm file, rồi câu chốt
    assert.equal(daGui.length, 2, `mong 2 tin xuống Zalo, nhận ${daGui.length}`);
    assert.equal(daGui[0]!.coFile, true, "tin đầu phải kèm file");

    const history = noiDungHistory();
    const dongFile = history.find((m) => m.content.includes(TEN_FILE));
    assert.ok(
      dongFile,
      "HISTORY PHẢI CÓ dòng ghi việc đã gửi file - thiếu là dashboard mất tin và lượt sau bot không nhớ đã gửi",
    );
    assert.equal(dongFile.role, "assistant");
    assert.ok(dongFile.content.includes("Bảng giá đây anh nhé"), "phải giữ cả caption");
  });

  it("thứ tự history đúng: tin người dùng -> tin tool gửi -> câu chốt của agent", async () => {
    // Đây là lý do tool KHÔNG tự gọi `appendMessage`: tin của người dùng được
    // ghi ở CUỐI lượt (ghi trước thì model thấy tin lặp hai lần), nên tool ghi
    // thẳng lúc gửi sẽ nằm TRƯỚC tin người dùng - sai thứ tự thật.
    await processor.processBatch(config, api, [tinNhan("gửi mình bảng giá")], {
      resolveModel: () => modelGoiSendFile("Bảng giá đây", "Em gửi rồi ạ"),
    });

    const history = noiDungHistory();
    const viTriHoi = history.findIndex((m) => m.content.includes("gửi mình bảng giá"));
    const viTriFile = history.findIndex((m) => m.content.includes(TEN_FILE));
    const viTriChot = history.findIndex((m) => m.content.includes("Em gửi rồi ạ"));

    assert.ok(viTriHoi >= 0 && viTriFile >= 0 && viTriChot >= 0, "cả ba dòng phải có mặt");
    assert.ok(viTriHoi < viTriFile, "tin người dùng phải đứng TRƯỚC tin tool gửi");
    assert.ok(viTriFile < viTriChot, "tin tool gửi phải đứng TRƯỚC câu chốt của agent");
  });
});
