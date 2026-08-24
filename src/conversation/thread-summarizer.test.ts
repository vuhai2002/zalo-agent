import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

// window = 5, trigger = 6 để test không phải bơm hàng chục tin
const WINDOW = 5;
const TRIGGER = 6;

let dataDir: string;
let history: typeof import("./history-store.js");
let threads: typeof import("./thread-store.js");
let summarizer: typeof import("./thread-summarizer.js");

before(async () => {
  dataDir = setupTestEnv({
    HISTORY_CONTEXT_LIMIT: String(WINDOW),
    SUMMARY_TRIGGER_MESSAGES: String(TRIGGER),
    HISTORY_MAX_MESSAGES_PER_THREAD: "500",
  });
  history = await import("./history-store.js");
  threads = await import("./thread-store.js");
  summarizer = await import("./thread-summarizer.js");
});

after(() => {
  history.closeHistoryStore();
  cleanupTestEnv(dataDir);
});

function seedThread(threadId: string, count: number): void {
  threads.recordThreadActivity({
    accountId: "acc-1",
    threadId,
    threadType: 0,
    displayName: "Hải",
    lastSenderName: "Hải",
  });
  for (let i = 1; i <= count; i++) {
    history.appendMessage("acc-1", threadId, { role: "user", content: `tin-${i}`, senderName: "Hải" });
  }
}

describe("thread-summarizer", () => {
  it("backlog = tin ngoài cửa sổ replay chưa được summary phủ", () => {
    seedThread("t-backlog", 12); // 12 tin, window 5 -> 7 tin ngoài window
    const { backlog } = summarizer.collectSummaryBacklog("acc-1", "t-backlog");
    assert.equal(backlog.length, 7);
    assert.equal(backlog[0]!.content, "tin-1");
    assert.equal(backlog[6]!.content, "tin-7");
  });

  it("chưa đủ trigger thì không gọi LLM", async () => {
    seedThread("t-it", WINDOW + 2); // backlog 2 < trigger 6
    let called = 0;
    const ran = await summarizer.maybeSummarizeThread("acc-1", "t-it", async () => {
      called++;
      return { text: "summary", truncated: false };
    });
    assert.equal(ran, false);
    assert.equal(called, 0);
  });

  it("đủ trigger: gộp backlog vào summary, prompt chứa summary cũ + tin mới", async () => {
    seedThread("t-gop", 12);
    threads.setThreadSummary("acc-1", "t-gop", "Summary cũ: đã bàn về X", 0);

    let receivedPrompt = "";
    const ran = await summarizer.maybeSummarizeThread("acc-1", "t-gop", async (prompt) => {
      receivedPrompt = prompt;
      return { text: "Summary mới sau khi gộp", truncated: false };
    });

    assert.equal(ran, true);
    assert.ok(receivedPrompt.includes("Summary cũ: đã bàn về X"));
    assert.ok(receivedPrompt.includes("tin-1"));
    assert.ok(receivedPrompt.includes("tin-7"));
    assert.ok(!receivedPrompt.includes("tin-8"), "tin trong window không được đem đi tóm tắt");

    const { summary, coversTo } = threads.getThreadSummary("acc-1", "t-gop");
    assert.equal(summary, "Summary mới sau khi gộp");
    assert.ok(coversTo > 0);
  });

  it("lần sau chỉ gộp phần mới, không tóm tắt lại từ đầu", async () => {
    // t-gop đã covers tới tin-7; thêm 8 tin nữa -> backlog mới bắt đầu từ tin-8
    for (let i = 13; i <= 20; i++) {
      history.appendMessage("acc-1", "t-gop", { role: "user", content: `tin-${i}`, senderName: "Hải" });
    }
    let receivedPrompt = "";
    const ran = await summarizer.maybeSummarizeThread("acc-1", "t-gop", async (prompt) => {
      receivedPrompt = prompt;
      return { text: "Summary lần 2", truncated: false };
    });

    assert.equal(ran, true);
    assert.ok(!receivedPrompt.includes("tin-7\n"), "phần đã phủ không được gộp lại");
    assert.ok(receivedPrompt.includes("tin-8"));
    assert.ok(receivedPrompt.includes("Summary mới sau khi gộp"), "summary cũ phải là đầu vào");
  });

  it("LLM lỗi thì nuốt, không throw, summary giữ nguyên", async () => {
    const before = threads.getThreadSummary("acc-1", "t-gop").summary;
    const ran = await summarizer.maybeSummarizeThread("acc-1", "t-gop", async () => {
      throw new Error("router chết");
    });
    assert.equal(ran, false);
    assert.equal(threads.getThreadSummary("acc-1", "t-gop").summary, before);
  });

  it("summary CẮT CỤT (truncated) thì KHÔNG lưu, coversTo không tiến - giữ trí nhớ", async () => {
    // Bản cụt mà lưu + tiến coversTo thì đám tin đó bị đánh dấu "đã phủ", không
    // bao giờ tóm tắt lại -> mất trí nhớ im lặng vĩnh viễn.
    seedThread("t-cut", 12);
    threads.setThreadSummary("acc-1", "t-cut", "Bản tốt cũ", 0);
    const truoc = threads.getThreadSummary("acc-1", "t-cut");

    const ran = await summarizer.maybeSummarizeThread("acc-1", "t-cut", async () => ({
      text: "Bản mới nhưng bị cắt giữa chừng vì chạm cap",
      truncated: true,
    }));

    assert.equal(ran, false);
    const sau = threads.getThreadSummary("acc-1", "t-cut");
    assert.equal(sau.summary, truoc.summary, "summary tốt cũ phải còn nguyên");
    assert.equal(sau.coversTo, truoc.coversTo, "coversTo KHÔNG được tiến khi bỏ bản cụt");
  });

  it("prompt có trần mềm độ dài để hiếm khi chạm cap gây cắt cụt", () => {
    const p = summarizer.buildSummaryPrompt("", [
      { id: 1, role: "user", sender_name: "Hải", content: "x" },
    ]);
    assert.match(p, /400 từ/, "phải có trần mềm ~400 từ trong prompt");
  });

  it("prompt có CẤU TRÚC mục cố định + luật không-bỏ-mục/đính-chính/hợp-nhất", async () => {
    // Prompt tự do để LLM tự chọn giữ gì thì qua nhiều vòng nó lặng lẽ đánh rơi
    // một khía cạnh. Ép điền đủ mục + "(không có)" làm mất mát nhìn thấy được.
    seedThread("t-struct", 12);
    let p = "";
    await summarizer.maybeSummarizeThread("acc-1", "t-struct", async (prompt) => {
      p = prompt;
      return { text: "tóm tắt", truncated: false };
    });
    for (const muc of ["NGƯỜI & QUAN HỆ", "QUYẾT ĐỊNH & ĐÃ HỨA", "SỞ THÍCH & THÓI QUEN", "VIỆC ĐANG DỞ", "CÂU HỎI TREO"]) {
      assert.ok(p.includes(muc), `prompt thiếu mục cố định: ${muc}`);
    }
    assert.match(p, /\(không có\)/, "phải dặn mục rỗng ghi (không có), không bỏ mục");
    assert.match(p, /ĐÍNH CHÍNH/, "phải dặn giữ đính chính của người dùng");
    assert.match(p, /HỢP NHẤT/, "phải dặn gộp vào MỘT bản, không chép nguyên bản cũ");
  });

  it("buildSummaryPrompt vẫn mang summary cũ + tin backlog (không mất đầu vào)", () => {
    const p = summarizer.buildSummaryPrompt("Nền cũ: đã bàn X", [
      { id: 1, role: "user", sender_name: "Hải", content: "câu mới của Hải" },
    ]);
    assert.match(p, /Nền cũ: đã bàn X/);
    assert.match(p, /câu mới của Hải/);
  });
});

/**
 * Cửa PHÁT HIỆN bản cụt (`finishReason === "length"` -> `truncated`). Mọi test ở
 * trên TIÊM sẵn `truncated` qua generator giả nên KHÔNG chạm cửa này - đổi nhầm
 * literal thành "stop" là hồi quy CÂM. `chayTomTat` được tách riêng chính để đo
 * cửa này bằng model giả, chạy qua đúng đường `streamText` + `chayStream` thật.
 */
describe("chayTomTat - cửa phát hiện bản cụt", () => {
  // Dựng stream mock TRỰC TIẾP, KHÔNG qua `thanhKetQuaStream`: helper đó nhận
  // `finishReason` dạng CHUỖI (đúng kiểu fixture doGenerate), nhưng MockLanguageModelV4
  // là spec v4 nên `result.finishReason` chỉ plumb qua khi part mang shape
  // `{unified, raw}` - chuỗi trần rơi về "other", che mất "length". Shape này đo
  // THẬT (probe) mới lên đúng tới cửa phát hiện. Kiểu part suy từ chính mock (như
  // `streaming-model-test-helper.ts`); part finish phải cast vì type v4 siết
  // `usage` dạng lồng còn runtime nhận phẳng - sai shape thì hai ca dưới đỏ TO.
  type PhanStream =
    Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer P> ? P : never;
  function modelVoiFinish(unified: string, text: string): MockLanguageModelV4 {
    const phan: PhanStream[] = [
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: text },
      { type: "text-end", id: "t1" },
      {
        type: "finish",
        finishReason: { unified, raw: unified },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      } as unknown as PhanStream,
    ];
    return new MockLanguageModelV4({ doStream: async () => ({ stream: convertArrayToReadableStream(phan) }) });
  }

  it("finishReason 'length' -> truncated:true (bản cụt, caller phải giữ bản cũ)", async () => {
    const r = await summarizer.chayTomTat(modelVoiFinish("length", "tóm tắt cụt giữa chừng"), "prompt");
    assert.equal(r.truncated, true);
  });

  it("finishReason 'stop' -> truncated:false, và text đã trim", async () => {
    const r = await summarizer.chayTomTat(modelVoiFinish("stop", "  tóm tắt trọn vẹn  "), "prompt");
    assert.equal(r.truncated, false);
    assert.equal(r.text, "tóm tắt trọn vẹn");
  });
});
