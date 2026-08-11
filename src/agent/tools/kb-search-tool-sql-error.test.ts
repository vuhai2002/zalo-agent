import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { API } from "zca-js";
import { fakeAgentProfile } from "../../shared/fake-agent-profile.js";
import { loiCuaTool } from "./tool-failure-result-test-helper.js";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";
import type { ParsedMessage } from "../../zalo/zalo-message-parser.js";

/**
 * Test riêng, CÔ LẬP HẲN 1 FILE - ép nhánh catch bao ngoài của
 * `kb-search-tool.ts` chạy bằng lỗi SQL THẬT, đúng mẫu
 * `schedule-task-tool-sql-error.test.ts` (DROP hẳn bảng thay vì mock
 * `node:test`'s `mock.method`, vì named export ESM là binding
 * `configurable:false` một khi có consumer khác đã resolve nó).
 *
 * `kb-fts-query.ts#timTheoTuKhoa` KHÔNG cache statement ở cấp module (số
 * placeholder đổi theo `sourceIds` mỗi lần gọi) nên `db.prepare(...)` chạy
 * NGAY LÚC GỌI - DROP bảng trước rồi gọi tool thì `.prepare()` ném lỗi SQL
 * thật ("no such table: kb_chunks_fts"), không cần mock gì cả.
 *
 * AN TOÀN vì `setupTestEnv()` tạo `mkdtemp` RIÊNG cho MỖI LẦN GỌI, và
 * `node --test` chạy MỖI FILE một process - phá bảng trong DB của FILE NÀY
 * không đụng gì tới DB của file khác.
 */

let dataDir: string;
let toolModule: typeof import("./kb-search-tool.js");
let database: typeof import("../../conversation/database.js");

const AGENT_ID = "agent-loi-sql";

before(async () => {
  dataDir = setupTestEnv();
  toolModule = await import("./kb-search-tool.js");
  database = await import("../../conversation/database.js");

  // Cần ÍT NHẤT một nguồn gán cho agent, để timTrongKhoTriThuc đi tới bước
  // gọi timTheoTuKhoa (agent chưa gán nguồn nào thì trả rỗng SỚM, không chạm
  // tới bảng đã bị DROP - ca đó là "nhánh rỗng" bình thường, không phải ca này).
  const store = await import("../../knowledge/kb-source-store.js");
  const chunkStore = await import("../../knowledge/kb-chunk-store.js");
  const binding = await import("../../knowledge/kb-agent-binding.js");
  const nguon = store.taoNguon({ ten: "Nguồn test", loai: "text", noiDungGoc: "Bảo hành 12 tháng." });
  chunkStore.luuDoan(nguon.id, [{ thuTu: 0, tieuDe: "", noiDung: "Bảo hành 12 tháng cho mọi sản phẩm." }]);
  binding.datNguonChoAgent(AGENT_ID, [nguon.id]);

  // Từ đây trở đi mọi câu lệnh chạm kb_chunks_fts (kể cả .prepare()) ném lỗi
  // SQL thật.
  database.db.exec("DROP TABLE kb_chunks_fts");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

function msg(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    accountId: "acc-1",
    threadId: "t-1",
    threadType: 1,
    isGroup: true,
    senderId: "u-1",
    senderName: "Hải",
    text: "",
    images: [],
    msgId: "m1",
    cliMsgId: "c1",
    isSelf: false,
    mentionsMe: true,
    sentAt: new Date().toISOString(),
    rawData: {},
    ...overrides,
  };
}

function makeCtx(): import("./tool-registry.js").ToolContext {
  return {
    api: {} as API,
    account: {
      id: "acc-1",
      label: "Test",
      loai: "ca_nhan" as const,
      coBotToken: false,
      enabled: true,
      agentId: AGENT_ID,
      allowlist: { mode: "all" as const, userIds: [] },
      groupRequireMention: true,
      respondToGroups: true,
      groupPassiveListen: true,
      autoReactEnabled: true,
      autoReactIcon: "heart",
      typingIndicatorEnabled: true,
      disabledTools: [],
    },
    agent: fakeAgentProfile({ id: AGENT_ID }),
    message: msg(),
    batch: [],
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const run = (input: unknown): Promise<string> =>
  (toolModule.createKbSearchTool(makeCtx()) as any).execute(input, {});

describe("kb_search - lỗi SQL thật (bảng kb_chunks_fts bị DROP) đi vào nhánh catch bao ngoài", () => {
  it("trả về chuỗi lỗi cho model đọc, KHÔNG throw ra agent loop", async () => {
    // Nếu try/catch của kb-search-tool.ts sai chỗ hoặc thiếu, `await` ở đây
    // tự ném lỗi và test này fail (không cần assert.rejects riêng)
    const result = await run({ cau_hoi: "bảo hành" });

    const loi = loiCuaTool(result);
    assert.match(loi, /thất bại/i, "phải là câu lỗi đọc được cho model, không phải chuỗi rỗng hay JSON lỗi thô");
    assert.match(
      loi.toLowerCase(),
      /no such table/,
      "lý do phải là lỗi SQL thật (bảng kb_chunks_fts đã bị drop), không phải câu chung chung bịa ra",
    );
  });
});
