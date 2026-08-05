import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { ThreadType, type API } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Câu trấn an khi bắt chờ quá lâu.
 *
 * Bất biến quan trọng nhất KHÔNG phải "có gửi được không" mà là "KHÔNG gửi khi
 * chưa đáng": người nhắn đã có ba tín hiệu sẵn (đang nhập, đã xem, reaction),
 * nên gửi sớm là nhiễu và là một lượt gọi API không chính thức bỏ đi.
 */

let dataDir: string;
let notice: typeof import("./busy-wait-notice.js");
let chain: typeof import("../middleware/thread-run-chain.js");
let tuning: typeof import("../config/runtime-tuning-settings.js");

before(async () => {
  dataDir = setupTestEnv();
  notice = await import("./busy-wait-notice.js");
  chain = await import("../middleware/thread-run-chain.js");
  tuning = await import("../config/runtime-tuning-settings.js");
});

after(async () => {
  (await import("../conversation/database.js")).closeDatabase();
  cleanupTestEnv(dataDir);
});

let daGui: string[] = [];
beforeEach(() => {
  daGui = [];
  notice.resetTranAn();
  tuning.setTuning("BUSY_ACK_AFTER_MS", null);
});

const api = {
  sendMessage: async (payload: { msg: string }) => {
    daGui.push(payload.msg);
    return { msgId: `m-${daGui.length}` };
  },
} as unknown as API;

const muc = (threadKey: string) => ({
  api,
  threadKey,
  threadId: threadKey,
  threadType: ThreadType.User,
});

/** Chiếm khoá thread, trả hàm nhả */
function chiemThread(threadKey: string): () => void {
  let nha!: () => void;
  const bịChặn = new Promise<void>((resolve) => {
    nha = resolve;
  });
  void chain.runOnThreadChain(threadKey, () => bịChặn);
  return nha;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("maybeNotifyBusyWait", () => {
  it("KHÔNG gửi khi thread đang rảnh - không có ai để mà trấn an", async () => {
    tuning.setTuning("BUSY_ACK_AFTER_MS", 10);
    assert.equal(await notice.maybeNotifyBusyWait(muc("k-ranh")), false);
    assert.deepEqual(daGui, []);
  });

  it("KHÔNG gửi khi bận CHƯA đủ lâu - lúc này dấu 'đang nhập' đã nói thay rồi", async () => {
    // Đây là bất biến giữ cho tính năng không thành ra phiền. Bỏ nó thì mọi tin
    // nhắn gửi lúc bot đang chạy đều lĩnh thêm một tin thừa.
    tuning.setTuning("BUSY_ACK_AFTER_MS", 5_000);
    const nha = chiemThread("k-chua-lau");
    await sleep(20);

    assert.equal(await notice.maybeNotifyBusyWait(muc("k-chua-lau")), false);
    assert.deepEqual(daGui, []);
    nha();
    await sleep(10);
  });

  it("gửi khi đã bận QUÁ ngưỡng", async () => {
    tuning.setTuning("BUSY_ACK_AFTER_MS", 20);
    const nha = chiemThread("k-lau");
    await sleep(60);

    assert.equal(await notice.maybeNotifyBusyWait(muc("k-lau")), true);
    assert.deepEqual(daGui, [notice.CAU_TRAN_AN]);
    nha();
    await sleep(10);
  });

  it("không nhắc lại trong cùng quãng chờ - nói hai lần chỉ làm người ta sốt ruột thêm", async () => {
    // Ngưỡng ở đây ĐỒNG THỜI là khoảng lặng chống nhắc lại, nên nó phải rộng
    // hơn thời gian một lượt `maybeNotifyBusyWait` chạy xong. Để 20ms thì lúc
    // chạy cả bộ test (nhiều tiến trình tranh CPU) một lượt thỉnh thoảng vượt
    // 20ms, lời gọi thứ hai hết bị chặn và ca này đỏ ngẫu nhiên - đã bắt được
    // 2 lần trên 4 lượt chạy cả bộ. Đây là lỗi của phép đo, không phải của luật.
    tuning.setTuning("BUSY_ACK_AFTER_MS", 200);
    const nha = chiemThread("k-nhac-lai");
    await sleep(250);

    await notice.maybeNotifyBusyWait(muc("k-nhac-lai"));
    await notice.maybeNotifyBusyWait(muc("k-nhac-lai"));
    await notice.maybeNotifyBusyWait(muc("k-nhac-lai"));

    assert.equal(daGui.length, 1, `mong đúng 1 câu, nhận ${daGui.length}`);
    nha();
    await sleep(10);
  });

  it("IM khi thread đang có tin đi ra - không chen ngang giữa câu trả lời đang cắt nhiều đoạn", async () => {
    // `sendReplyInParts` xếp hàng TỪNG đoạn một, nên giữa hai đoạn hàng đợi
    // rỗng và câu trấn an chèn được vào giữa. Lúc đó nội dung của nó ("vẫn đang
    // xử lý") còn sai sự thật - bot đang GỬI chứ không còn đang xử lý.
    const rateLimiter = await import("../middleware/rate-limiter.js");
    tuning.setTuning("BUSY_ACK_AFTER_MS", 20);
    const nha = chiemThread("k-dang-gui");
    await sleep(60);

    // Giữ hàng đợi gửi bận bằng một việc gửi chưa xong
    let nhaGui!: () => void;
    const guiBiChan = new Promise<void>((resolve) => {
      nhaGui = resolve;
    });
    void rateLimiter.enqueueSend("k-dang-gui", () => guiBiChan);
    await sleep(10);

    assert.equal(
      await notice.maybeNotifyBusyWait(muc("k-dang-gui")),
      false,
      "đang gửi dở thì phải im",
    );
    assert.deepEqual(daGui, []);

    nhaGui();
    nha();
    await sleep(30);
  });

  it("đặt 0 là tắt hẳn - kể cả khi đã bận rất lâu", async () => {
    tuning.setTuning("BUSY_ACK_AFTER_MS", 0);
    const nha = chiemThread("k-tat");
    await sleep(60);

    assert.equal(await notice.maybeNotifyBusyWait(muc("k-tat")), false);
    assert.deepEqual(daGui, []);
    nha();
    await sleep(10);
  });

  it("đồng hồ chờ tính từ lúc thread BẮT ĐẦU bận, không đặt lại theo từng lượt", async () => {
    // Lượt nối tiếp nhau trong cùng một quãng chờ mà làm mới đồng hồ thì người
    // dùng chờ mãi cũng không bao giờ chạm ngưỡng - đúng ca bận lâu nhất lại là
    // ca không bao giờ được trấn an.
    tuning.setTuning("BUSY_ACK_AFTER_MS", 40);
    const nha1 = chiemThread("k-noi-tiep");
    await sleep(30);
    // Lượt thứ hai xếp vào chuỗi khi lượt đầu còn đang chạy
    const nha2 = chiemThread("k-noi-tiep");
    await sleep(30);

    assert.equal(
      await notice.maybeNotifyBusyWait(muc("k-noi-tiep")),
      true,
      "tổng thời gian chờ đã vượt ngưỡng nên phải trấn an",
    );
    nha1();
    nha2();
    await sleep(20);
  });

  it("thread rảnh trở lại thì đồng hồ về mốc mới - quãng chờ sau đếm lại từ đầu", async () => {
    tuning.setTuning("BUSY_ACK_AFTER_MS", 30);
    const nha = chiemThread("k-doi-quang");
    await sleep(60);
    nha();
    await sleep(20); // khoá đã nhả

    assert.equal(chain.daBanBaoLau("k-doi-quang"), null, "rảnh rồi thì không còn mốc nào");

    const nha2 = chiemThread("k-doi-quang");
    await sleep(5);
    assert.equal(
      await notice.maybeNotifyBusyWait(muc("k-doi-quang")),
      false,
      "quãng chờ MỚI phải đếm lại từ đầu, không kế thừa thời gian của quãng trước",
    );
    nha2();
    await sleep(10);
  });
});
