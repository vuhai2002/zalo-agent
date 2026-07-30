import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let store: typeof import("./proactive-send-counter-store.js");
let database: typeof import("../conversation/database.js");

before(async () => {
  dataDir = setupTestEnv();
  store = await import("./proactive-send-counter-store.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

const ACC = "acc-1";

describe("getProactiveCounter / addProactiveSendCount", () => {
  it("chưa có dòng nào thì trả count=0, noticeSent=false", () => {
    assert.deepEqual(store.getProactiveCounter(ACC, "t-trong", "2026-08-01"), { count: 0, noticeSent: false });
  });

  it("cộng dồn đúng amount qua nhiều lần gọi (không ghi đè)", () => {
    store.addProactiveSendCount(ACC, "t-cong-don", "2026-08-01", 3);
    store.addProactiveSendCount(ACC, "t-cong-don", "2026-08-01", 2);
    assert.equal(store.getProactiveCounter(ACC, "t-cong-don", "2026-08-01").count, 5);
  });

  it("amount <= 0 thì no-op, không tạo dòng rác", () => {
    store.addProactiveSendCount(ACC, "t-amount-0", "2026-08-01", 0);
    store.addProactiveSendCount(ACC, "t-amount-am", "2026-08-01", -5);
    assert.equal(store.getProactiveCounter(ACC, "t-amount-0", "2026-08-01").count, 0);
    assert.equal(store.getProactiveCounter(ACC, "t-amount-am", "2026-08-01").count, 0);
  });

  it("khác ngày (day_key khác) là bộ đếm ĐỘC LẬP, không cộng lẫn nhau", () => {
    store.addProactiveSendCount(ACC, "t-khac-ngay", "2026-08-01", 3);
    store.addProactiveSendCount(ACC, "t-khac-ngay", "2026-08-02", 1);
    assert.equal(store.getProactiveCounter(ACC, "t-khac-ngay", "2026-08-01").count, 3);
    assert.equal(store.getProactiveCounter(ACC, "t-khac-ngay", "2026-08-02").count, 1);
  });

  it("khác thread (cùng account, cùng ngày) là bộ đếm ĐỘC LẬP", () => {
    store.addProactiveSendCount(ACC, "t-a", "2026-08-03", 3);
    store.addProactiveSendCount(ACC, "t-b", "2026-08-03", 1);
    assert.equal(store.getProactiveCounter(ACC, "t-a", "2026-08-03").count, 3);
    assert.equal(store.getProactiveCounter(ACC, "t-b", "2026-08-03").count, 1);
  });
});

describe("markProactiveCapNoticeSent", () => {
  it("đánh dấu noticeSent=true, không đụng count", () => {
    store.addProactiveSendCount(ACC, "t-notice", "2026-08-04", 5);
    store.markProactiveCapNoticeSent(ACC, "t-notice", "2026-08-04");
    const counter = store.getProactiveCounter(ACC, "t-notice", "2026-08-04");
    assert.equal(counter.noticeSent, true);
    assert.equal(counter.count, 5, "mark không được đụng count");
  });

  it("mark trước khi có dòng count nào (thread chưa từng gửi) vẫn tạo được dòng", () => {
    store.markProactiveCapNoticeSent(ACC, "t-mark-truoc", "2026-08-05");
    assert.deepEqual(store.getProactiveCounter(ACC, "t-mark-truoc", "2026-08-05"), { count: 0, noticeSent: true });
  });
});

describe("addProactiveSendCount - dọn theo keepSinceDayKey", () => {
  it("dòng cũ hơn keepSinceDayKey bị xoá, dòng từ hôm đó trở đi vẫn còn", () => {
    store.addProactiveSendCount(ACC, "t-prune-cu", "2026-07-20", 2);
    store.addProactiveSendCount(ACC, "t-prune-moi", "2026-08-01", 2);

    // Ghi 1 dòng mới, kèm dọn mọi dòng cũ hơn 2026-07-25
    store.addProactiveSendCount(ACC, "t-prune-trigger", "2026-08-10", 1, "2026-07-25");

    assert.equal(store.getProactiveCounter(ACC, "t-prune-cu", "2026-07-20").count, 0, "dòng cũ phải bị dọn");
    assert.equal(store.getProactiveCounter(ACC, "t-prune-moi", "2026-08-01").count, 2, "dòng mới không bị đụng");
  });

  it("KHÔNG dọn gì khi không truyền keepSinceDayKey (tránh mất dữ liệu ngoài ý muốn)", () => {
    store.addProactiveSendCount(ACC, "t-khong-dọn", "2026-06-01", 4);
    store.addProactiveSendCount(ACC, "t-khong-dọn-2", "2026-08-11", 1);
    assert.equal(store.getProactiveCounter(ACC, "t-khong-dọn", "2026-06-01").count, 4);
  });
});

describe("tryReserveProactiveSlot - giành 1 suất NGUYÊN TỬ (Mục 4)", () => {
  it("chưa có dòng nào (max=1) vẫn giành được - nhánh INSERT không qua WHERE", () => {
    assert.equal(store.tryReserveProactiveSlot(ACC, "t-reserve-moi", "2026-08-01", 1), true);
    assert.equal(store.getProactiveCounter(ACC, "t-reserve-moi", "2026-08-01").count, 1);
  });

  it("còn dưới max thì giành được, cộng đúng 1", () => {
    store.addProactiveSendCount(ACC, "t-reserve-con-cho", "2026-08-01", 2);
    assert.equal(store.tryReserveProactiveSlot(ACC, "t-reserve-con-cho", "2026-08-01", 3), true);
    assert.equal(store.getProactiveCounter(ACC, "t-reserve-con-cho", "2026-08-01").count, 3);
  });

  it("đã bằng max thì KHÔNG giành được, count không đổi", () => {
    store.addProactiveSendCount(ACC, "t-reserve-day", "2026-08-01", 3);
    assert.equal(store.tryReserveProactiveSlot(ACC, "t-reserve-day", "2026-08-01", 3), false);
    assert.equal(store.getProactiveCounter(ACC, "t-reserve-day", "2026-08-01").count, 3, "giành hỏng thì KHÔNG được đụng count");
  });

  it("khác thread là độc lập - thread A đầy không chặn thread B", () => {
    store.addProactiveSendCount(ACC, "t-reserve-day-a", "2026-08-01", 3);
    assert.equal(store.tryReserveProactiveSlot(ACC, "t-reserve-day-a", "2026-08-01", 3), false);
    assert.equal(store.tryReserveProactiveSlot(ACC, "t-reserve-trong-b", "2026-08-01", 3), true);
  });
});

describe("refundProactiveSlot - hoàn 1 suất đã giữ (Mục 4)", () => {
  it("trừ đúng 1", () => {
    store.addProactiveSendCount(ACC, "t-refund-tru", "2026-08-01", 5);
    store.refundProactiveSlot(ACC, "t-refund-tru", "2026-08-01");
    assert.equal(store.getProactiveCounter(ACC, "t-refund-tru", "2026-08-01").count, 4);
  });

  it("kẹp sàn 0 - không xuống âm dù chưa có dòng nào", () => {
    store.refundProactiveSlot(ACC, "t-refund-chua-co-dong", "2026-08-01");
    assert.equal(store.getProactiveCounter(ACC, "t-refund-chua-co-dong", "2026-08-01").count, 0);
  });
});

describe("resetAllProactiveCounters", () => {
  it("xoá sạch mọi dòng của mọi account/thread/ngày", () => {
    store.addProactiveSendCount(ACC, "t-reset-1", "2026-08-01", 3);
    store.addProactiveSendCount("acc-khac", "t-reset-2", "2026-08-01", 5);

    store.resetAllProactiveCounters();

    assert.equal(store.getProactiveCounter(ACC, "t-reset-1", "2026-08-01").count, 0);
    assert.equal(store.getProactiveCounter("acc-khac", "t-reset-2", "2026-08-01").count, 0);
  });
});
