import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ThreadType } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import type { ParsedMessage } from "../zalo/zalo-message-parser.js";

// message-batcher import src/config/env.ts (module đó process.exit khi env thiếu),
// nên phải setupTestEnv() rồi mới import động.
let dataDir: string;
let batcher: typeof import("./message-batcher.js");

before(async () => {
  dataDir = setupTestEnv();
  batcher = await import("./message-batcher.js");
});

after(async () => {
  batcher.clearPendingBatches();
  // Đọc cấu hình chỉnh-nóng nên module này mở SQLite - không đóng thì
  // Windows chặn xóa thư mục tạm (EPERM)
  (await import("../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function makeMessage(text: string): ParsedMessage {
  return {
    accountId: "acc-test",
    threadId: "thread-1",
    threadType: ThreadType.User,
    isGroup: false,
    senderId: "user-1",
    senderName: "Người dùng",
    text,
    images: [],
    msgId: `m-${text}`,
    cliMsgId: `c-${text}`,
    isSelf: false,
    mentionsMe: false,
    rawData: {},
  };
}

describe("message-batcher", () => {
  it("gộp các tin gần nhau cùng thread thành 1 lượt", async () => {
    const batches: ParsedMessage[][] = [];
    const handler = async (batch: ParsedMessage[]) => {
      batches.push(batch);
    };

    batcher.enqueueMessage("k-gop", makeMessage("a"), handler, 30);
    batcher.enqueueMessage("k-gop", makeMessage("b"), handler, 30);
    batcher.enqueueMessage("k-gop", makeMessage("c"), handler, 30);
    await sleep(90);

    assert.equal(batches.length, 1);
    assert.deepEqual(batches[0]!.map((m) => m.text), ["a", "b", "c"]);
  });

  it("thread khác nhau không bị gộp lẫn vào nhau", async () => {
    const batches: ParsedMessage[][] = [];
    const handler = async (batch: ParsedMessage[]) => {
      batches.push(batch);
    };

    batcher.enqueueMessage("k-t1", makeMessage("x"), handler, 30);
    batcher.enqueueMessage("k-t2", makeMessage("y"), handler, 30);
    await sleep(90);

    assert.equal(batches.length, 2);
    assert.deepEqual(batches.map((b) => b.length), [1, 1]);
  });

  it("tin mới đến trong lúc chờ sẽ reset đồng hồ debounce", async () => {
    const batches: ParsedMessage[][] = [];
    const handler = async (batch: ParsedMessage[]) => {
      batches.push(batch);
    };

    batcher.enqueueMessage("k-reset", makeMessage("a"), handler, 60);
    await sleep(40);
    batcher.enqueueMessage("k-reset", makeMessage("b"), handler, 60);

    // Mốc 70ms: nếu không reset thì lượt đầu đã chạy ở mốc 60ms
    await sleep(30);
    assert.equal(batches.length, 0);

    await sleep(60);
    assert.equal(batches.length, 1);
    assert.equal(batches[0]!.length, 2);
  });

  it("các lượt cùng thread chạy tuần tự, không chồng lấn", async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const handler = async (batch: ParsedMessage[]) => {
      const tag = batch[0]!.text;
      events.push(`start:${tag}`);
      if (tag === "A") await firstBlocked;
      events.push(`end:${tag}`);
    };

    batcher.enqueueMessage("k-tuantu", makeMessage("A"), handler, 20);
    await sleep(60);
    assert.deepEqual(events, ["start:A"], "lượt A phải đã chạy và đang bị chặn");

    batcher.enqueueMessage("k-tuantu", makeMessage("B"), handler, 20);
    await sleep(60);
    assert.deepEqual(events, ["start:A"], "lượt B phải xếp hàng, không chạy chồng lên A");

    releaseFirst();
    await sleep(60);
    assert.deepEqual(events, ["start:A", "end:A", "start:B", "end:B"]);
  });

  it("thread chạy xong thì bỏ khỏi Map - không rò rỉ theo số thread từng nhắn", async () => {
    const handler = async () => {};
    for (let i = 0; i < 20; i++) {
      batcher.enqueueMessage(`k-ro-ri-${i}`, makeMessage(`t${i}`), handler, 10);
    }
    assert.ok(batcher.activeThreadCount() >= 20, "đang chờ thì phải có mặt trong Map");

    await sleep(80);
    assert.equal(batcher.activeThreadCount(), 0, "chạy xong phải dọn sạch");
  });

  it("clearPendingBatches hủy tin đang chờ, handler không chạy", async () => {
    let called = false;
    batcher.enqueueMessage(
      "k-huy",
      makeMessage("z"),
      async () => {
        called = true;
      },
      30,
    );

    batcher.clearPendingBatches();
    await sleep(90);

    assert.equal(called, false);
  });
});

/**
 * Nhóm này khóa điều kiện (b): batch chỉ chốt khi thread KHÔNG còn lượt nào
 * đang chạy. Đây là phần chữa cho ca thật ngày 2026-08-04 - một lượt tạo tài
 * liệu chạy 249 giây, hai tin gửi trong lúc đó thành hai lượt agent riêng và
 * mỗi lượt lại làm lại từ đầu toàn bộ công việc.
 */
describe("message-batcher - tin đến trong lúc thread đang bận", () => {
  /** Dựng một lượt chiếm chỗ, trả về hàm nhả nó ra */
  function chiemThread(threadKey: string, events: string[]) {
    let nha!: () => void;
    const bịChặn = new Promise<void>((resolve) => {
      nha = resolve;
    });
    void batcher.runOnThreadChain(threadKey, async () => {
      events.push("start:lượt-dài");
      await bịChặn;
      events.push("end:lượt-dài");
    });
    return nha;
  }

  it("nhiều cụm tin rời rạc trong lúc bận GỘP thành ĐÚNG MỘT lượt", async () => {
    // Đây là bất biến chính của cả đợt. Ba tin cách nhau xa hơn cửa sổ gộp -
    // đường cũ cho ra ba lượt, mỗi lượt làm lại từ đầu.
    const events: string[] = [];
    const batches: string[][] = [];
    const handler = async (batch: ParsedMessage[]) => {
      batches.push(batch.map((m) => m.text));
    };

    const nha = chiemThread("k-ban-gop", events);
    await sleep(20);

    batcher.enqueueMessage("k-ban-gop", makeMessage("a"), handler, 25);
    await sleep(60); // quá cửa sổ gộp -> đường cũ đã chốt lượt cho riêng "a"
    batcher.enqueueMessage("k-ban-gop", makeMessage("b"), handler, 25);
    await sleep(60);
    batcher.enqueueMessage("k-ban-gop", makeMessage("c"), handler, 25);
    await sleep(60);

    assert.equal(batches.length, 0, "không lượt nào được chạy khi thread còn bận");

    nha();
    await sleep(120);

    assert.equal(batches.length, 1, `mong ĐÚNG 1 lượt, nhận ${batches.length}`);
    assert.deepEqual(batches[0], ["a", "b", "c"]);
  });

  it("vẫn chờ im lặng đủ debounce SAU KHI thread rảnh - không cướp cò giữa cụm tin", async () => {
    // Bất biến "chưa im lặng đủ thì chưa chạy" phải đúng cho cả đường bận lẫn
    // đường rảnh. Chốt ngay lúc thread rảnh sẽ cắt đôi đúng cụm tin người ta
    // đang gõ dở - tức là đẻ lại chính cái lượt thừa vừa chữa xong.
    const events: string[] = [];
    const batches: string[][] = [];
    const handler = async (batch: ParsedMessage[]) => {
      batches.push(batch.map((m) => m.text));
    };

    const nha = chiemThread("k-ban-cho-them", events);
    await sleep(20);

    batcher.enqueueMessage("k-ban-cho-them", makeMessage("a"), handler, 60);
    await sleep(10);
    nha(); // thread rảnh trong khi cửa sổ gộp còn đang chạy
    await sleep(10);
    batcher.enqueueMessage("k-ban-cho-them", makeMessage("b"), handler, 60);

    await sleep(30);
    assert.equal(batches.length, 0, "còn trong cửa sổ gộp thì chưa được chạy");

    await sleep(90);
    assert.equal(batches.length, 1);
    assert.deepEqual(batches[0], ["a", "b"], "tin b phải kịp vào cùng lượt với a");
  });

  it("chạm trần thì BỎ tin mới, phần đã dồn vẫn chạy trọn", async () => {
    const events: string[] = [];
    const batches: ParsedMessage[][] = [];
    const handler = async (batch: ParsedMessage[]) => {
      batches.push(batch);
    };

    const nha = chiemThread("k-ban-tran", events);
    await sleep(20);

    const soTinGui = batcher.TRAN_TIN_DON + 5;
    for (let i = 0; i < soTinGui; i++) {
      batcher.enqueueMessage("k-ban-tran", makeMessage(`t${i}`), handler, 25);
    }
    await sleep(60);
    nha();
    await sleep(120);

    assert.equal(batches.length, 1);
    assert.equal(
      batches[0]!.length,
      batcher.TRAN_TIN_DON,
      "phải dừng đúng ở trần, không phình theo số tin gửi",
    );
    // Bỏ tin MỚI chứ không đẩy tin cũ ra: tin cũ đã được người ta gửi trước và
    // lượt sẽ trả lời theo nó, nên giữ đúng thứ tự đến.
    assert.equal(batches[0]![0]!.text, "t0");
  });

  it("báo cho caller biết tin nào BỊ BỎ - không thì tin biến mất khỏi cả history", async () => {
    // Giá trị trả về là thứ DUY NHẤT caller biết được tin đã bị bỏ. Tin bị bỏ
    // không tới `processBatch`, mà đó là nơi duy nhất ghi history cho nhánh
    // có-trả-lời - nuốt giá trị này là bot quên hẳn câu người ta vừa nói,
    // trong khi họ đã thấy dấu "đã nhận".
    const events: string[] = [];
    const nha = chiemThread("k-tra-ve", events);
    await sleep(20);

    const ketQua: boolean[] = [];
    for (let i = 0; i < batcher.TRAN_TIN_DON + 3; i++) {
      ketQua.push(
        batcher.enqueueMessage("k-tra-ve", makeMessage(`t${i}`), async () => {}, 25),
      );
    }

    assert.equal(
      ketQua.filter((x) => x).length,
      batcher.TRAN_TIN_DON,
      "đúng số tin lọt vào batch phải trả true",
    );
    assert.deepEqual(
      ketQua.slice(batcher.TRAN_TIN_DON),
      [false, false, false],
      "mọi tin sau khi chạm trần phải trả false",
    );

    nha();
    await sleep(120);
  });

  it("job lịch hẹn chiếm thread cũng gom tin y hệt lượt agent", async () => {
    // `deliverProactively` dùng chung `runOnThreadChain`, nên đường đánh thức
    // phải chạy cho cả nguồn đó - không thì tin gửi trong lúc job đang gửi sẽ
    // nằm lại vĩnh viễn và người nhắn không bao giờ được trả lời.
    const events: string[] = [];
    const batches: string[][] = [];
    const handler = async (batch: ParsedMessage[]) => {
      batches.push(batch.map((m) => m.text));
    };

    const nha = chiemThread("k-job-gom", events);
    await sleep(20);
    batcher.enqueueMessage("k-job-gom", makeMessage("hỏi-lúc-job-chạy"), handler, 25);
    await sleep(60);
    assert.equal(batches.length, 0);

    nha();
    await sleep(120);
    assert.deepEqual(batches, [["hỏi-lúc-job-chạy"]]);
  });

  it("layTinDangDo lấy tin đã đỗ và XÓA khỏi hàng chờ - không để chạy thêm lượt nữa", async () => {
    // Đây là mặt sau của việc tiêm tin giữa lượt: lượt đang chạy kéo tin vào
    // rồi thì khi khoá nhả ra không được đẻ thêm một lượt cho chính mấy tin đó.
    const events: string[] = [];
    const batches: string[][] = [];
    const handler = async (batch: ParsedMessage[]) => {
      batches.push(batch.map((m) => m.text));
    };

    const nha = chiemThread("k-lay-tin-do", events);
    await sleep(20);
    batcher.enqueueMessage("k-lay-tin-do", makeMessage("chen-1"), handler, 25);
    batcher.enqueueMessage("k-lay-tin-do", makeMessage("chen-2"), handler, 25);
    await sleep(60); // hết cửa sổ gộp -> batch đã đỗ

    const daLay = batcher.layTinDangDo("k-lay-tin-do");
    assert.deepEqual(daLay.map((m) => m.text), ["chen-1", "chen-2"]);

    nha();
    await sleep(120);
    assert.equal(batches.length, 0, "đã lấy rồi thì KHÔNG được chạy thêm lượt nào cho mấy tin đó");
    assert.equal(batcher.activeThreadCount(), 0, "lấy xong phải dọn sạch hàng chờ");
  });

  it("layTinDangDo trả RỖNG khi cụm tin còn đang gõ dở - không cắt đôi giữa chừng", async () => {
    // Cùng bất biến với `danhThucHangCho`: chưa im lặng đủ thì chưa ai được
    // đụng vào batch. Kéo sớm là model nhận nửa câu ở step này, nửa còn lại ở
    // step sau - tệ hơn là cứ để nguyên.
    const events: string[] = [];
    const nha = chiemThread("k-lay-som", events);
    await sleep(20);
    batcher.enqueueMessage("k-lay-som", makeMessage("đang gõ dở"), async () => {}, 200);
    await sleep(20); // còn xa mới hết cửa sổ gộp

    assert.deepEqual(batcher.layTinDangDo("k-lay-som"), []);

    batcher.clearPendingBatches();
    nha();
    await sleep(30);
  });

  it("dồn xong chạy hết thì Map sạch - đường mới không rò rỉ", async () => {
    const events: string[] = [];
    const nha = chiemThread("k-ban-ro-ri", events);
    await sleep(20);
    batcher.enqueueMessage("k-ban-ro-ri", makeMessage("x"), async () => {}, 20);
    await sleep(50);
    nha();
    await sleep(120);

    assert.equal(batcher.activeThreadCount(), 0, "chạy xong phải dọn sạch cả pending lẫn chain");
  });
});

describe("runOnThreadChain", () => {
  it("gọi trực tiếp (không qua enqueueMessage) vẫn xâu chuỗi đúng thread - scheduler dùng lại y hệt tin nhắn", async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const runA = batcher.runOnThreadChain("k-chain-tructiep", async () => {
      events.push("start:A");
      await firstBlocked;
      events.push("end:A");
    });

    await sleep(20);
    assert.deepEqual(events, ["start:A"], "A phải đã chạy và đang bị chặn");

    const runB = batcher.runOnThreadChain("k-chain-tructiep", async () => {
      events.push("start:B");
    });
    await sleep(20);
    assert.deepEqual(events, ["start:A"], "B phải xếp hàng, chưa được chạy khi A còn dở");

    releaseFirst();
    await Promise.all([runA, runB]);
    assert.deepEqual(events, ["start:A", "end:A", "start:B"]);
  });

  it("tin nhắn (enqueueMessage) và job gọi trực tiếp runOnThreadChain trên CÙNG threadKey không chồng lấn nhau", async () => {
    const events: string[] = [];
    let releaseJob!: () => void;
    const jobBlocked = new Promise<void>((resolve) => {
      releaseJob = resolve;
    });

    // Job "lịch hẹn" chiếm chỗ trước, y như scheduler dispatch qua runOnThreadChain
    const jobRun = batcher.runOnThreadChain("k-tin-va-job", async () => {
      events.push("start:job");
      await jobBlocked;
      events.push("end:job");
    });

    await sleep(20);
    batcher.enqueueMessage("k-tin-va-job", makeMessage("tin-nguoi-dung"), async () => {
      events.push("start:tin");
    }, 10);

    await sleep(40);
    assert.deepEqual(events, ["start:job"], "tin nhắn phải chờ job lịch hẹn xong, không đọc history nửa chừng");

    releaseJob();
    await jobRun;
    await sleep(30);
    assert.deepEqual(events, ["start:job", "end:job", "start:tin"]);
  });

  it("trả về đúng promise của fn - lỗi bên trong fn không bị nuốt mất với caller đang await trực tiếp", async () => {
    const run = batcher.runOnThreadChain("k-chain-loi", async () => {
      throw new Error("job hỏng");
    });
    await assert.rejects(run, /job hỏng/);
  });
});

/**
 * Hủy hàng chờ của một thread - dùng khi xóa sạch ngữ cảnh thread đó. Không có
 * bước này thì xóa xong, batch đang đỗ vẫn chạy và ghi ngược tin cũ vào lịch sử
 * vừa dọn: người dùng bấm xóa rồi vẫn thấy tin xuất hiện lại.
 */
describe("huyBatchCuaThread", () => {
  it("tin đang chờ bị hủy - handler KHÔNG bao giờ chạy", async () => {
    let daChay = 0;
    const handler = async () => {
      daChay++;
    };
    batcher.enqueueMessage("k-huy", makeMessage("a"), handler, 30);
    batcher.enqueueMessage("k-huy", makeMessage("b"), handler, 30);

    const soTin = batcher.huyBatchCuaThread("k-huy");

    assert.equal(soTin, 2, "phải báo đúng số tin vừa hủy");
    await sleep(80); // quá hạn debounce - nếu timer còn sống thì handler đã chạy
    assert.equal(daChay, 0, "hủy rồi mà vẫn chạy là ghi lại tin vào lịch sử vừa xóa");
  });

  it("KHÔNG đụng hàng chờ của thread khác", async () => {
    let chayKhac = 0;
    const handler = async () => {
      chayKhac++;
    };
    batcher.enqueueMessage("k-huy-2", makeMessage("x"), async () => {}, 30);
    batcher.enqueueMessage("k-con-lai", makeMessage("y"), handler, 30);

    batcher.huyBatchCuaThread("k-huy-2");

    await sleep(80);
    assert.equal(chayKhac, 1, "thread khác phải chạy bình thường");
  });

  it("thread không có gì trong hàng chờ thì trả 0, không nổ", () => {
    assert.equal(batcher.huyBatchCuaThread("k-khong-co-gi"), 0);
  });

  it("hủy xong thì thread đó không còn giữ chỗ trong bộ nhớ", async () => {
    const truoc = batcher.activeThreadCount();
    batcher.enqueueMessage("k-ro-ri", makeMessage("z"), async () => {}, 5000);
    assert.equal(batcher.activeThreadCount(), truoc + 1);

    batcher.huyBatchCuaThread("k-ro-ri");
    assert.equal(batcher.activeThreadCount(), truoc, "còn entry là còn giữ timer 5 giây");
  });

  it("hủy xong KHÔNG để lại timer sống - process phải thoát được ngay", () => {
    // Xóa entry khỏi Map là đủ để handler không chạy, nên chỉ đo hành vi thì
    // quên `clearTimeout` vẫn xanh. Timer bị bỏ quên giữ event loop sống tới
    // khi hết hạn - đúng lý do `clearPendingBatches` phải dọn timer lúc tắt bot.
    const demTimer = () =>
      process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;

    const truoc = demTimer();
    batcher.enqueueMessage("k-timer", makeMessage("t"), async () => {}, 30_000);
    assert.equal(demTimer(), truoc + 1, "phải gieo được đúng một timer thì phép đo mới có nghĩa");

    batcher.huyBatchCuaThread("k-timer");
    assert.equal(demTimer(), truoc, "timer 30 giây bị bỏ quên là process không thoát được");
  });
});
