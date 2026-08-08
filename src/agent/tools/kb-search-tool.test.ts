import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { API } from "zca-js";
import { fakeAgentProfile } from "../../shared/fake-agent-profile.js";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";
import type { ParsedMessage } from "../../zalo/zalo-message-parser.js";
import { loiCuaTool } from "./tool-failure-result-test-helper.js";

// Kéo theo env + DB nên phải setupTestEnv trước, import động sau
let dataDir: string;
let toolModule: typeof import("./kb-search-tool.js");
let registry: typeof import("./tool-registry.js");
let store: typeof import("../../knowledge/kb-source-store.js");
let chunkStore: typeof import("../../knowledge/kb-chunk-store.js");
let binding: typeof import("../../knowledge/kb-agent-binding.js");
let tuning: typeof import("../../config/runtime-tuning-settings.js");
let database: typeof import("../../conversation/database.js");
let markers: typeof import("../prompt-leak-markers.js");
type ToolContext = import("./tool-registry.js").ToolContext;

before(async () => {
  dataDir = setupTestEnv();
  toolModule = await import("./kb-search-tool.js");
  registry = await import("./tool-registry.js");
  store = await import("../../knowledge/kb-source-store.js");
  chunkStore = await import("../../knowledge/kb-chunk-store.js");
  binding = await import("../../knowledge/kb-agent-binding.js");
  tuning = await import("../../config/runtime-tuning-settings.js");
  database = await import("../../conversation/database.js");
  markers = await import("../prompt-leak-markers.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

// Bảng KB dọn TRƯỚC mỗi test (áp cho MỌI describe bên dưới - node:test chạy
// hook ngoài trước hook trong), để mỗi test tự lo fixture của nó, không phụ
// thuộc thứ tự chạy.
beforeEach(() => {
  for (const t of ["kb_sources", "kb_chunks", "kb_chunks_fts", "agent_kb_sources"]) {
    database.db.exec(`DELETE FROM ${t}`);
  }
});

const AGENT_ID = "agent-a";

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

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    api: {} as API,
    account: {
      id: "acc-1",
      label: "Test",
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
    ...overrides,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const run = (ctx: ToolContext, input: unknown): Promise<string> =>
  (toolModule.createKbSearchTool(ctx) as any).execute(input, {});

/**
 * Nạp 1 nguồn (mỗi phần tử của `noiDungs` thành một đoạn riêng) rồi gán CỘNG
 * DỒN cho agent - `datNguonChoAgent` tự nó THAY THẾ toàn bộ danh sách, nên đọc
 * lại danh sách hiện có trước khi ghi để gọi nhiều lần trong cùng 1 test không
 * đè mất nguồn đã gán trước đó.
 */
function napNguon(agentId: string, ten: string, noiDungs: string[]): { id: string } {
  const nguon = store.taoNguon({ ten, loai: "text", noiDungGoc: noiDungs.join("\n\n") });
  chunkStore.luuDoan(
    nguon.id,
    noiDungs.map((noiDung, thuTu) => ({ thuTu, tieuDe: "", noiDung })),
  );
  binding.datNguonChoAgent(agentId, [...binding.nguonCuaAgent(agentId), nguon.id]);
  return nguon;
}

describe("kb_search - bọc nội dung ngoài và dẫn nguồn", () => {
  beforeEach(() => {
    napNguon(AGENT_ID, "Chính sách bảo hành", [
      "Bảo hành 12 tháng cho mọi sản phẩm, đổi mới trong 30 ngày đầu nếu lỗi nhà sản xuất.",
    ]);
  });

  it("kết quả bọc trong thẻ nội dung ngoài", async () => {
    const kq = await run(makeCtx(), { cau_hoi: "bảo hành" });
    // Mở KHÔNG khớp `>` ngay sau tên thẻ: `wrapUntrustedContent` luôn kèm
    // thuộc tính `nguon="..."` trước dấu đóng - đúng cách `DAU_HIEU_RO_PROMPT`
    // ở prompt-leak-markers.ts tự canh (chỉ neo tiền tố, không neo `>`).
    assert.match(kq, new RegExp(`<${markers.THE_NOI_DUNG_NGOAI}`));
    assert.match(kq, new RegExp(`</${markers.THE_NOI_DUNG_NGOAI}>`));
  });

  it("mỗi đoạn kèm TÊN NGUỒN để model dẫn nguồn cho khách", async () => {
    const kq = await run(makeCtx(), { cau_hoi: "bảo hành" });
    assert.match(kq, /Chính sách bảo hành/);
  });
});

describe("kb_search - nhánh rỗng", () => {
  beforeEach(() => {
    napNguon(AGENT_ID, "Chính sách bảo hành", [
      "Bảo hành 12 tháng cho mọi sản phẩm, đổi mới trong 30 ngày đầu nếu lỗi nhà sản xuất.",
    ]);
  });

  it("không tìm thấy gì thì trả ketQuaLoi, KHÔNG trả chuỗi rỗng", async () => {
    // Từ khóa KHÔNG được trùng bất kỳ từ nào trong fixture ở trên - dungTruyVanFts
    // nối các từ bằng OR nên chỉ cần trùng MỘT từ (kể cả từ phổ biến như "trong")
    // là ra kết quả, làm ca "không tìm thấy" này xanh giả.
    const kq = await run(makeCtx(), { cau_hoi: "zzqzzq wwqwwq yyxyyx" });
    assert.match(loiCuaTool(kq), /không tìm thấy/i);
  });
});

describe("kb_search - trần ký tự áp cho TOÀN BỘ kết quả", () => {
  // Chuỗi CHỈ xuất hiện ở CUỐI fixture (xa hơn hẳn điểm cắt 500 ký tự) - dùng
  // làm bằng chứng THẬT của việc cắt: một khẳng định chỉ đo ĐỘ DÀI (như bản cũ
  // `kq.length < 700`) vẫn xanh dù bỏ hẳn phần cắt, cắt sai mốc (vd
  // `maxChars * 2`), hay cắt `noiDung` thay vì cắt `boc` (không tính phần vỏ) -
  // độ dài vẫn tình cờ lọt dưới ngưỡng rộng rãi đó. Đo nội dung ĐUÔI mới phân
  // biệt được "có cắt thật" với "trùng hợp đủ ngắn".
  const DUOI_TAI_LIEU = "DUOI_TAI_LIEU_CHI_XUAT_HIEN_O_DAY_kmqzx789";

  beforeEach(() => {
    napNguon(AGENT_ID, "Chính sách bảo hành", [
      "Bảo hành 12 tháng cho mọi sản phẩm, đổi mới trong 30 ngày đầu nếu lỗi nhà sản xuất. " +
        "Đổi trả trong 7 ngày kể từ ngày nhận hàng, sản phẩm còn nguyên tem. " +
        "Điều khoản bổ sung: mọi khiếu nại phải gửi trong vòng 24 giờ kể từ khi phát hiện lỗi, " +
        "kèm ảnh chụp hóa đơn và sản phẩm lỗi, gửi về email cskh@vidu.test hoặc gọi hotline " +
        "1900-1234 trong giờ hành chính từ 8h đến 17h các ngày trong tuần. " +
        `${DUOI_TAI_LIEU}.`,
    ]);
  });

  it("kết quả bị cắt về đúng trần ký tự (đuôi tài liệu biến mất), có câu báo đã cắt", async () => {
    // 200 (ví dụ minh họa trong brief) THẤP HƠN min=500 của chính tham số này
    // (xem tuning-definitions.ts) nên getTuning() sẽ âm thầm rơi về mặc định
    // 4000 - dùng đúng trần MIN hợp lệ để phép đặt tuning này có tác dụng thật.
    tuning.setTuning("KB_MAX_RESULT_CHARS", 500);
    try {
      const kq = await run(makeCtx(), { cau_hoi: "bảo hành" });
      // Cắt tại ĐÚNG maxChars cộng phần vỏ nối thêm (câu báo + thẻ đóng, ~62
      // ký tự đo được) - không phải một ngưỡng rộng rãi bất kỳ cũng xanh được.
      assert.ok(kq.length <= 500 + 70, `dài ${kq.length}, trần 500 + phần vỏ (~62)`);
      // Bằng chứng cắt THẬT: đuôi tài liệu (chỉ nằm ở cuối, xa điểm cắt 500)
      // phải biến mất khỏi kết quả trả về.
      assert.doesNotMatch(kq, new RegExp(DUOI_TAI_LIEU), "đuôi tài liệu vẫn còn -> chưa cắt thật");
      assert.match(kq, /đã rút gọn/i);
      // Cắt xong vẫn phải khép đúng thẻ - không bỏ dở khối <noi_dung_ngoai>.
      assert.match(kq, new RegExp(`</${markers.THE_NOI_DUNG_NGOAI}>$`));
    } finally {
      tuning.setTuning("KB_MAX_RESULT_CHARS", null);
    }
  });
});

describe("kb_search - cách ly theo agent ở TẦNG TOOL", () => {
  it("tool chỉ trả nguồn đã bật cho agent trong ctx, không rò nguồn của agent khác", async () => {
    napNguon("agent-a", "Nguồn A", ["Chính sách đổi trả: nội dung riêng của nguồn A."]);
    napNguon("agent-b", "Nguồn B", ["Chính sách đổi trả: nội dung riêng của nguồn B."]);

    const ctxCuaAgentA = makeCtx({ agent: fakeAgentProfile({ id: "agent-a" }) });
    const kq = await run(ctxCuaAgentA, { cau_hoi: "chính sách đổi trả" });

    assert.match(kq, /nội dung riêng của nguồn A/);
    assert.doesNotMatch(kq, /nội dung riêng của nguồn B/);
  });
});

describe("kb_search - có mặt/vắng mặt trong schema theo agent đã gán nguồn", () => {
  it("agent chưa gán nguồn nào thì kb_search không vào schema", () => {
    const ctx = makeCtx({ agent: fakeAgentProfile({ id: "agent-chua-gan" }) });
    const tools = registry.buildAgentTools(ctx);
    assert.equal("kb_search" in tools, false);
  });

  it("gán rồi thì có mặt", () => {
    napNguon("agent-co-nguon", "Nguồn X", ["Nội dung X."]);
    const ctx = makeCtx({ agent: fakeAgentProfile({ id: "agent-co-nguon" }) });
    const tools = registry.buildAgentTools(ctx);
    assert.equal("kb_search" in tools, true);
  });
});

describe("kepSoLuong - kẹp trước khi gọi xuống SQL (LIMIT âm là 'không giới hạn')", () => {
  it("số âm KHÔNG được đi thẳng vào LIMIT - kẹp về tối thiểu 1", () => {
    assert.equal(toolModule.kepSoLuong(-1), 1);
    assert.equal(toolModule.kepSoLuong(-999), 1);
  });

  it("0 cũng bị kẹp lên tối thiểu 1 - LIMIT 0 nghĩa là không đoạn nào, không phải điều muốn", () => {
    assert.equal(toolModule.kepSoLuong(0), 1);
  });

  it("giá trị không hữu hạn (NaN/Infinity) rơi về tối thiểu, không làm LIMIT vô nghĩa", () => {
    assert.equal(toolModule.kepSoLuong(NaN), 1);
    assert.equal(toolModule.kepSoLuong(Infinity), 20);
    assert.equal(toolModule.kepSoLuong(-Infinity), 1);
  });

  it("giá trị vượt trần bị kẹp về tối đa", () => {
    assert.equal(toolModule.kepSoLuong(999), 20);
  });

  it("giá trị hợp lệ giữ nguyên", () => {
    assert.equal(toolModule.kepSoLuong(5), 5);
  });
});
