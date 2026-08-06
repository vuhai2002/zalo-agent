import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Xóa ngữ cảnh là thao tác KHÔNG HOÀN TÁC ĐƯỢC, và DB không có khóa ngoại nào
 * nên mỗi bảng phải xóa tay. Hai kiểu sai đều tệ theo hướng ngược nhau:
 *
 *   - Sót một bảng: người dùng tưởng đã sạch, bot vẫn nhắc chuyện cũ.
 *   - Xóa quá tay: mất dữ liệu của thread khác, của account khác, hoặc mất lịch
 *     hẹn - thứ người dùng không hề định bỏ.
 *
 * Nên mỗi test ở đây dựng SẴN dữ liệu của một thread thứ hai và một account
 * thứ hai, rồi khẳng định chúng còn nguyên.
 */

let dataDir: string;
let wipe: typeof import("./wipe-thread-context.js");
let history: typeof import("./history-store.js");
let threads: typeof import("./thread-store.js");
let memories: typeof import("./memory-store.js");
let traces: typeof import("../agent/agent-trace-store.js");
let imageDesc: typeof import("./image-description-store.js");
let database: typeof import("./database.js");

const ACC = "acc-1";
const ACC_KHAC = "acc-2";
const TH = "thread-1";
const TH_KHAC = "thread-2";

before(async () => {
  dataDir = setupTestEnv();
  wipe = await import("./wipe-thread-context.js");
  history = await import("./history-store.js");
  threads = await import("./thread-store.js");
  memories = await import("./memory-store.js");
  traces = await import("../agent/agent-trace-store.js");
  imageDesc = await import("./image-description-store.js");
  database = await import("./database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

/** Dựng một thread có đủ mọi loại dữ liệu, để phép xóa có thứ thật để xóa */
function gieoThread(accountId: string, threadId: string): void {
  threads.recordThreadActivity({
    accountId,
    threadId,
    threadType: 0,
    displayName: `Tên ${threadId}`,
    lastSenderName: "Người dùng",
  });
  history.appendMessage(accountId, threadId, { role: "user", content: "tin của người dùng" });
  history.appendMessage(accountId, threadId, { role: "assistant", content: "bot trả lời" });
  threads.setThreadSummary(accountId, threadId, "tóm tắt cũ", 1);
  memories.saveMemoryFact({
    accountId,
    subjectId: "u1",
    content: `fact học ở ${threadId}`,
    learnedInThreadId: threadId,
    learnedInGroup: false,
  });
  database.db
    .prepare("INSERT INTO agent_turns (id, account_id, thread_id, steps) VALUES (?, ?, ?, 1)")
    .run(++demTurn, accountId, threadId);
}

/** Id lượt cấp tăng dần - tự tính từ độ dài chuỗi thì acc-1/acc-2 ra trùng id */
let demTurn = 0;

function soTin(accountId: string, threadId: string): number {
  return history.getRecentMessages(accountId, threadId, 100).length;
}

beforeEach(() => {
  for (const t of ["messages", "threads", "memories", "agent_turns", "agent_steps"]) {
    database.db.exec(`DELETE FROM ${t}`);
  }
  // Dọn cả FILE, không chỉ DB: ảnh case trước gieo nằm lại trên đĩa thì case
  // "thread chưa từng có ảnh" đếm nhầm ảnh của case khác rồi đỏ oan
  database.db.exec("DELETE FROM image_descriptions");
  fs.rmSync(path.join(dataDir, "media"), { recursive: true, force: true });
  gieoThread(ACC, TH);
  gieoThread(ACC, TH_KHAC);
  gieoThread(ACC_KHAC, TH);
});

describe("xoaNguCanhThread - xóa đúng thread", () => {
  it("tin nhắn, tóm tắt và trace của thread đó biến mất", () => {
    const ket = wipe.xoaNguCanhThread(ACC, TH);

    assert.equal(soTin(ACC, TH), 0, "tin nhắn phải sạch");
    assert.equal(threads.getThreadSummary(ACC, TH).summary, "", "tóm tắt phải sạch");
    assert.equal(threads.getThreadSummary(ACC, TH).coversTo, 0, "mốc đã gộp phải về 0");
    assert.equal(ket.tinNhan, 2);
  });

  /**
   * Bản đầu xóa cả `agent_turns`, và đó là bảng nguồn DUY NHẤT của thống kê
   * token (`usage-store.ts`). Đo trên máy người dùng sau 4 lần xóa thử: trang
   * Tổng quan báo hôm nay dùng 0 token trong khi bot chạy ~30 lượt. Lịch sử chi
   * tiêu không phải nội dung hội thoại - xóa chat không được viết lại số tiền.
   */
  it("GIỮ dòng đếm token, chỉ xóa NỘI DUNG trace", () => {
    const demTurn = () =>
      (
        database.db
          .prepare("SELECT COUNT(*) n FROM agent_turns WHERE account_id = ? AND thread_id = ?")
          .get(ACC, TH) as { n: number }
      ).n;

    const truoc = demTurn();
    assert.ok(truoc > 0, "phải có lượt để đếm thì phép đo mới có nghĩa");

    wipe.xoaNguCanhThread(ACC, TH);

    assert.equal(demTurn(), truoc, "xóa agent_turns là thổi bay thống kê token của cả ngày");
  });

  it("KHÔNG đụng thread khác cùng account", () => {
    wipe.xoaNguCanhThread(ACC, TH);
    assert.equal(soTin(ACC, TH_KHAC), 2, "thread khác phải còn nguyên tin");
    assert.equal(threads.getThreadSummary(ACC, TH_KHAC).summary, "tóm tắt cũ");
  });

  it("KHÔNG đụng thread trùng tên ở account khác", () => {
    // Bẫy thật: `thread_id` của Zalo chỉ duy nhất TRONG một account. Quên điều
    // kiện account_id là xóa lây sang nick khác mà không ai thấy.
    wipe.xoaNguCanhThread(ACC, TH);
    assert.equal(soTin(ACC_KHAC, TH), 2, "account khác phải còn nguyên");
  });

  it("giữ lại dòng threads: tên hiển thị và công tắc bot còn nguyên", () => {
    threads.setBotEnabled(ACC, TH, false);
    wipe.xoaNguCanhThread(ACC, TH);

    assert.equal(threads.hasDisplayName(ACC, TH), true, "đây là reset chứ không phải xóa session");
    assert.equal(threads.isBotEnabled(ACC, TH), false, "công tắc bot phải giữ nguyên");
  });
});

describe("xoaNguCanhThread - trí nhớ chỉ xóa khi được tick", () => {
  const conTriNho = (accountId: string) =>
    memories.listMemories({ accountId, limit: 50 }).length;

  it("MẶC ĐỊNH giữ trí nhớ - nó gắn với con người, không gắn với hội thoại", () => {
    const truoc = conTriNho(ACC);
    const ket = wipe.xoaNguCanhThread(ACC, TH);

    assert.equal(ket.triNho, 0);
    assert.equal(conTriNho(ACC), truoc, "không tick thì tuyệt đối không đụng trí nhớ");
  });

  it("tick thì xóa fact học TRONG thread này", () => {
    const ket = wipe.xoaNguCanhThread(ACC, TH, { xoaTriNho: true });
    assert.equal(ket.triNho, 1);
  });

  it("tick vẫn GIỮ fact học ở thread khác về cùng người", () => {
    // Lọc theo `learned_in_thread_id`: cùng subject nhưng học ở nơi khác thì
    // người dùng không hề yêu cầu bỏ
    wipe.xoaNguCanhThread(ACC, TH, { xoaTriNho: true });
    const conLai = memories.listMemories({ accountId: ACC, limit: 50 });
    assert.ok(
      conLai.some((m) => m.content.includes(TH_KHAC)),
      "fact của thread khác phải còn",
    );
  });
});

describe("xoaNguCanhThread - khóa phiên router", () => {
  it("mỗi lần xóa tăng epoch, nên router mở phiên MỚI", () => {
    const truoc = threads.getThreadContextEpoch(ACC, TH);
    const lan1 = wipe.xoaNguCanhThread(ACC, TH).epochMoi;
    const lan2 = wipe.xoaNguCanhThread(ACC, TH).epochMoi;

    assert.equal(lan1, truoc + 1);
    assert.equal(lan2, truoc + 2, "xóa hai lần phải ra hai phiên khác nhau");
    assert.equal(threads.getThreadContextEpoch(ACC, TH), lan2, "phải đọc lại được từ DB");
  });

  it("KHÔNG tăng epoch của thread khác", () => {
    const truoc = threads.getThreadContextEpoch(ACC, TH_KHAC);
    wipe.xoaNguCanhThread(ACC, TH);
    assert.equal(threads.getThreadContextEpoch(ACC, TH_KHAC), truoc);
  });
});

describe("xoaNguCanhThread - ảnh trên đĩa và mô tả ảnh", () => {
  function gieoAnh(accountId: string, threadId: string, ten: string): string {
    const rel = ["media", accountId, threadId, ten].join("/");
    const abs = path.join(dataDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from([0xff, 0xd8]));
    imageDesc.saveImageDescription(rel, "mô tả ảnh", "model-test");
    return rel;
  }

  it("xóa file ảnh VÀ mô tả ảnh của thread đó", () => {
    const cua1 = gieoAnh(ACC, TH, "a-0.jpg");
    const cuaKhac = gieoAnh(ACC, TH_KHAC, "b-0.jpg");

    const ket = wipe.xoaNguCanhThread(ACC, TH);

    assert.equal(ket.anh, 1);
    assert.equal(ket.moTaAnh, 1);
    assert.equal(fs.existsSync(path.join(dataDir, cua1)), false, "file phải bị xóa");
    assert.equal(imageDesc.getImageDescription(cua1), null, "mô tả phải bị xóa");
    assert.equal(fs.existsSync(path.join(dataDir, cuaKhac)), true, "ảnh thread khác phải còn");
    assert.equal(imageDesc.getImageDescription(cuaKhac), "mô tả ảnh", "mô tả thread khác phải còn");
  });

  it("thread chưa từng có ảnh thì không nổ, trả 0", () => {
    const ket = wipe.xoaNguCanhThread(ACC, TH_KHAC);
    assert.equal(ket.anh, 0);
    assert.equal(ket.moTaAnh, 0);
  });
});

describe("xoaNguCanhThread - trace agent", () => {
  it("xóa step theo turn, không để step mồ côi", () => {
    const turnId = 777_001;
    database.db
      .prepare("INSERT INTO agent_turns (id, account_id, thread_id, steps) VALUES (?, ?, ?, 1)")
      .run(turnId, ACC, TH);
    traces.saveTurnTrace(turnId, [
      {
        stepNumber: 1,
        attempt: 1,
        text: "nội dung nhạy cảm của người dùng",
        reasoning: "",
        toolCalls: [],
        toolResults: [],
        toolErrors: [],
        finishReason: "stop",
        warnings: [],
        inputTokens: 10,
        outputTokens: 5,
      },
    ]);
    assert.ok(traces.getTurnTrace(turnId).length > 0, "phải gieo được trace trước đã");

    wipe.xoaNguCanhThread(ACC, TH);

    assert.equal(traces.getTurnTrace(turnId).length, 0, "trace chứa nguyên văn tin, phải xóa theo");
    const conLai = database.db
      .prepare("SELECT COUNT(*) n FROM agent_steps WHERE turn_id = ?")
      .get(turnId) as { n: number };
    assert.equal(conLai.n, 0, "step mồ côi là dữ liệu nằm lại mà không giao diện nào thấy");
  });
});
