import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { API } from "zca-js";
import type { AccountConfig } from "../config/account-store.js";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

// Kéo theo env + DB (qua account-manager/thread-store) nên phải setupTestEnv()
// rồi import động - đúng quy ước bắt buộc của test chạm DB trong dự án này.
let dataDir: string;
let guard: typeof import("./proactive-send-guard.js");
let accountManager: typeof import("../zalo/account-manager.js");
let threadStore: typeof import("../conversation/thread-store.js");
let database: typeof import("../conversation/database.js");

const ACC_RUNNING = "acc-guard-running";
const ACC_OFFLINE = "acc-guard-offline"; // KHÔNG bao giờ attach - luôn "không chạy"
const TZ = "Asia/Ho_Chi_Minh";

/** api giả đủ để attachAccount() không văng lỗi - listener.* toàn no-op, không đụng mạng thật */
function fakeApi(): API {
  return {
    getOwnId: () => "self-1",
    listener: {
      on: () => {},
      onConnected: () => {},
      onError: () => {},
      onClosed: () => {},
      start: () => {},
      stop: () => {},
    },
  } as unknown as API;
}

const accountConfig = (id: string): AccountConfig => ({
  id,
  label: "Test",
  enabled: true,
  agentId: "agent-test",
  allowlist: { mode: "all", userIds: [] },
  groupRequireMention: true,
  respondToGroups: true,
  groupPassiveListen: true,
  autoReactEnabled: false,
  autoReactIcon: "heart",
  typingIndicatorEnabled: false,
  disabledTools: [],
});

before(async () => {
  // Trần thấp + gap ngắn để test nhanh, không phải chờ 20s thật của mặc định production
  dataDir = setupTestEnv({ SCHEDULER_MAX_PROACTIVE_PER_DAY: "3", SCHEDULER_SEND_GAP_MS: "30" });
  guard = await import("./proactive-send-guard.js");
  accountManager = await import("../zalo/account-manager.js");
  threadStore = await import("../conversation/thread-store.js");
  database = await import("../conversation/database.js");

  // ACC_RUNNING "online" qua đúng đường attachAccount thật (không seam riêng) -
  // isAccountRunning/getRunningAccountApi phản ánh y hệt hệ thống thật lúc chạy.
  accountManager.attachAccount(accountConfig(ACC_RUNNING), fakeApi());
});

after(() => {
  accountManager.stopAllAccounts();
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

function makeThread(threadId: string): void {
  threadStore.recordThreadActivity({
    accountId: ACC_RUNNING,
    threadId,
    threadType: 0,
    displayName: "",
    lastSenderName: "",
  });
}

describe("checkAccountAndThreadReady", () => {
  it("account không chạy thì chặn", () => {
    const r = guard.checkAccountAndThreadReady(ACC_OFFLINE, "t-bat-ky");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /không chạy/);
  });

  it("account chạy + thread hợp lệ (tồn tại + bot_enabled) thì qua", () => {
    makeThread("t-preflight-ok");
    assert.deepEqual(guard.checkAccountAndThreadReady(ACC_RUNNING, "t-preflight-ok"), { ok: true });
  });
});

describe("checkProactiveSendGuard - thứ tự 3 điều kiện", () => {
  it("account chưa từng attach (không chạy) thì chặn ngay ở điều kiện đầu tiên", () => {
    const r = guard.checkProactiveSendGuard(ACC_OFFLINE, "t-bat-ky", TZ, new Date());
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /không chạy/);
  });

  it("account chạy nhưng thread chưa từng ghi nhận trong hệ thống thì chặn", () => {
    const r = guard.checkProactiveSendGuard(ACC_RUNNING, "t-chua-tung-thay", TZ, new Date());
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /chưa từng ghi nhận/);
  });

  it("thread tồn tại nhưng bot_enabled=0 (tắt trên dashboard) thì chặn", () => {
    makeThread("t-tat-bot");
    threadStore.setBotEnabled(ACC_RUNNING, "t-tat-bot", false);

    const r = guard.checkProactiveSendGuard(ACC_RUNNING, "t-tat-bot", TZ, new Date());
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /đang tắt/);
  });

  it("account chạy + thread hợp lệ + chưa chạm trần thì cho qua", () => {
    makeThread("t-hop-le");
    assert.deepEqual(guard.checkProactiveSendGuard(ACC_RUNNING, "t-hop-le", TZ, new Date()), { ok: true });
  });
});

describe("checkProactiveSendGuard - trần ngày (SCHEDULER_MAX_PROACTIVE_PER_DAY=3 trong test)", () => {
  it("đếm THEO SỐ TIN (count truyền vào recordProactiveSend), không phải theo số lần gọi", () => {
    const threadId = "t-dem-theo-tin";
    makeThread(threadId);
    const now = new Date("2026-08-01T01:00:00Z");

    // 1 lần record nhưng 3 tin (mô phỏng 1 câu trả lời dài bị cắt thành 3 đoạn)
    guard.recordProactiveSend(ACC_RUNNING, threadId, TZ, 3, now);
    assert.equal(
      guard.checkProactiveSendGuard(ACC_RUNNING, threadId, TZ, now).ok,
      false,
      "3 tin trong 1 lần gọi phải tính đủ 3, chạm trần 3 ngay",
    );
  });

  it("tin thứ N+1 (N=trần) bị chặn; check KHÔNG tự ghi 'đã báo' - phải gọi markProactiveCapNotified mới tính là đã báo", () => {
    const threadId = "t-cham-tran";
    makeThread(threadId);
    const now = new Date("2026-08-01T01:00:00Z");

    for (let i = 0; i < 3; i++) {
      const r = guard.checkProactiveSendGuard(ACC_RUNNING, threadId, TZ, now);
      assert.equal(r.ok, true, `tin thứ ${i + 1} (trong trần) phải qua được`);
      guard.recordProactiveSend(ACC_RUNNING, threadId, TZ, 1, now);
    }

    // Gọi check NHIỀU LẦN mà KHÔNG mark - notifyCapHitOnce phải LUÔN true, vì
    // check là hàm THUẦN ĐỌC (đúng fix: trang "Chạy thử ngay" gọi kiểm trước
    // rồi có thể không gửi thật, tự ghi ngay trong check sẽ nuốt mất thông báo
    // của lần chạm trần THẬT sự sau đó).
    const kiemLan1 = guard.checkProactiveSendGuard(ACC_RUNNING, threadId, TZ, now);
    const kiemLan2 = guard.checkProactiveSendGuard(ACC_RUNNING, threadId, TZ, now);
    assert.equal(kiemLan1.ok, false);
    assert.equal(kiemLan2.ok, false);
    if (!kiemLan1.ok && !kiemLan2.ok) {
      assert.match(kiemLan1.reason, /chạm trần/);
      assert.equal(kiemLan1.notifyCapHitOnce, true, "check không mark thì vẫn phải báo true");
      assert.equal(kiemLan2.notifyCapHitOnce, true, "gọi check nhiều lần không mark - vẫn true, không tự đổi");
    }

    // Giờ mới ĐÁNH DẤU (như caller làm sau khi thật sự gửi được thông báo)
    guard.markProactiveCapNotified(ACC_RUNNING, threadId, TZ, now);
    const sauKhiMark = guard.checkProactiveSendGuard(ACC_RUNNING, threadId, TZ, now);
    assert.equal(sauKhiMark.ok, false);
    if (!sauKhiMark.ok) {
      assert.equal(sauKhiMark.notifyCapHitOnce, false, "đã mark rồi thì không báo lại trong cùng ngày");
    }
  });

  it("qua NGÀY MỚI (theo giờ VN) thì trần được reset về 0", () => {
    const threadId = "t-qua-ngay";
    makeThread(threadId);

    const ngay1 = new Date("2026-08-01T10:00:00Z");
    guard.recordProactiveSend(ACC_RUNNING, threadId, TZ, 3, ngay1);
    assert.equal(guard.checkProactiveSendGuard(ACC_RUNNING, threadId, TZ, ngay1).ok, false, "đã chạm trần ngày 1");

    const ngay2 = new Date("2026-08-02T10:00:00Z");
    assert.equal(guard.checkProactiveSendGuard(ACC_RUNNING, threadId, TZ, ngay2).ok, true, "sang ngày mới phải reset");
  });

  it("mốc lật ngày là 00:00 GIỜ VN, không phải 00:00 UTC - đúng vá zone-time đã trị ở phase 01", () => {
    const threadId = "t-lech-mui-gio";
    makeThread(threadId);

    // 16:00Z 31/07 = 23:00 VN 31/07 (UTC+7) - vẫn ngày VN 31/07
    const truocNuaDemVN = new Date("2026-07-31T16:00:00Z");
    guard.recordProactiveSend(ACC_RUNNING, threadId, TZ, 3, truocNuaDemVN);
    assert.equal(guard.checkProactiveSendGuard(ACC_RUNNING, threadId, TZ, truocNuaDemVN).ok, false);

    // 18:00Z 31/07 = 01:00 VN 01/08 - CÙNG ngày UTC (31/07) nhưng ĐÃ SANG ngày VN mới
    const sauNuaDemVN = new Date("2026-07-31T18:00:00Z");
    assert.equal(
      guard.checkProactiveSendGuard(ACC_RUNNING, threadId, TZ, sauNuaDemVN).ok,
      true,
      "phải reset dù còn cùng ngày UTC, vì đã sang ngày VN mới",
    );
  });
});

describe("resetProactiveSendCounters", () => {
  it("đưa mọi bộ đếm về 0 - dùng để cô lập các ca test với nhau", () => {
    const threadId = "t-reset";
    makeThread(threadId);
    const now = new Date();
    guard.recordProactiveSend(ACC_RUNNING, threadId, TZ, 3, now);
    assert.equal(guard.checkProactiveSendGuard(ACC_RUNNING, threadId, TZ, now).ok, false);

    guard.resetProactiveSendCounters();
    assert.equal(guard.checkProactiveSendGuard(ACC_RUNNING, threadId, TZ, now).ok, true);
  });
});

describe("enqueueProactiveSend - rải đều toàn cục", () => {
  it("2 lần gửi (dù khác thread) vẫn chạy tuần tự, cách nhau tối thiểu SCHEDULER_SEND_GAP_MS", async () => {
    guard.resetProactiveSendQueue();
    const moc: number[] = [];
    const p1 = guard.enqueueProactiveSend(async () => {
      moc.push(Date.now());
    });
    const p2 = guard.enqueueProactiveSend(async () => {
      moc.push(Date.now());
    });
    await Promise.all([p1, p2]);

    assert.equal(moc.length, 2);
    // Gap test = 30ms; chừa biên 5ms cho sai số hẹn giờ của hệ điều hành
    assert.ok(moc[1]! - moc[0]! >= 25, `2 lần gửi phải cách nhau gần đúng gap (đo được ${moc[1]! - moc[0]!}ms)`);
  });

  it("1 lần gửi lỗi không làm kẹt hàng đợi - lần kế tiếp vẫn chạy được", async () => {
    guard.resetProactiveSendQueue();
    let ranSecond = false;

    await assert.rejects(
      guard.enqueueProactiveSend(async () => {
        throw new Error("gửi hỏng");
      }),
      /gửi hỏng/,
    );
    await guard.enqueueProactiveSend(async () => {
      ranSecond = true;
    });

    assert.equal(ranSecond, true, "hàng đợi phải sống tiếp sau 1 lần lỗi");
  });
});

describe("checkProactiveDailyCap - THUẦN ĐỌC, không giữ chỗ (Mục 1)", () => {
  it("còn chỗ thì cho qua, KHÔNG cộng count (khác reserveProactiveSlot)", () => {
    const threadId = "t-doc-thuan";
    makeThread(threadId);
    const now = new Date("2026-08-01T01:00:00Z");
    const before = guard.checkProactiveDailyCap(ACC_RUNNING, threadId, TZ, now);
    assert.equal(before.ok, true);

    // Gọi lại nhiều lần vẫn true - hàm này không tự ghi gì
    assert.equal(guard.checkProactiveDailyCap(ACC_RUNNING, threadId, TZ, now).ok, true);
  });

  it("đã chạm trần (do reserveProactiveSlot/recordProactiveSend ghi trước) thì báo false, kèm notifyCapHitOnce đúng", () => {
    const threadId = "t-doc-cham-tran";
    makeThread(threadId);
    const now = new Date("2026-08-01T01:00:00Z");
    guard.recordProactiveSend(ACC_RUNNING, threadId, TZ, 3, now); // trần test = 3 (xem before())

    const r = guard.checkProactiveDailyCap(ACC_RUNNING, threadId, TZ, now);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.reason, /chạm trần/);
      assert.equal(r.notifyCapHitOnce, true);
    }
  });
});

describe("reserveProactiveSlot - NGUYÊN TỬ, giữ chỗ thật (Mục 4)", () => {
  it("còn chỗ thì giành được VÀ CỘNG NGAY 1 vào count (khác checkProactiveDailyCap)", async () => {
    const counterStore = await import("./proactive-send-counter-store.js");
    const zoneTime = await import("../shared/zone-time.js");
    const threadId = "t-reserve-cong-ngay";
    makeThread(threadId);
    const now = new Date("2026-08-01T01:00:00Z");
    const dayKey = zoneTime.todayKey(TZ, now);

    const before = counterStore.getProactiveCounter(ACC_RUNNING, threadId, dayKey).count;
    const r = guard.reserveProactiveSlot(ACC_RUNNING, threadId, TZ, now);
    assert.equal(r.ok, true);
    assert.equal(counterStore.getProactiveCounter(ACC_RUNNING, threadId, dayKey).count, before + 1, "giành chỗ phải cộng NGAY, không đợi caller tự ghi");
  });

  it("đủ trần (test=3) thì suất thứ 4 KHÔNG giành được, count không đổi", () => {
    const threadId = "t-reserve-day-tran";
    makeThread(threadId);
    const now = new Date("2026-08-01T01:00:00Z");

    for (let i = 0; i < 3; i++) {
      assert.equal(guard.reserveProactiveSlot(ACC_RUNNING, threadId, TZ, now).ok, true, `suất thứ ${i + 1} phải giành được`);
    }
    const r = guard.reserveProactiveSlot(ACC_RUNNING, threadId, TZ, now);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /chạm trần/);
  });

  it("race giữa 2 lần gọi ĐỒNG THỜI khi CHỈ CÒN ĐÚNG 1 CHỖ: chỉ 1 bên giành được - đây là điểm chặn race Mục 4", async () => {
    const threadId = "t-reserve-race";
    makeThread(threadId);
    const now = new Date("2026-08-01T01:00:00Z");
    // Chiếm trước 2/3 suất (trần test = 3) - chỉ còn ĐÚNG 1 chỗ
    guard.reserveProactiveSlot(ACC_RUNNING, threadId, TZ, now);
    guard.reserveProactiveSlot(ACC_RUNNING, threadId, TZ, now);

    // 2 job "cùng lúc" tranh nốt suất cuối - node:sqlite đồng bộ nên đây thực
    // chất là 2 lệnh UPDATE nối tiếp nhau, nhưng đúng cái cần canh: KHÔNG được
    // cả 2 cùng giành được (bug đọc-rồi-ghi tách rời sẽ cho cả 2 cùng "ok").
    const [a, b] = [
      guard.reserveProactiveSlot(ACC_RUNNING, threadId, TZ, now),
      guard.reserveProactiveSlot(ACC_RUNNING, threadId, TZ, now),
    ];
    const wins = [a, b].filter((r) => r.ok).length;
    assert.equal(wins, 1, "chỉ đúng 1 trong 2 lần gọi được giành suất cuối cùng");
  });
});

describe("refundProactiveSlot - hoàn suất đã giữ nhưng cuối cùng không gửi được (Mục 4)", () => {
  it("hoàn đúng 1 suất - reserve rồi refund thì count trở lại như trước", async () => {
    const counterStore = await import("./proactive-send-counter-store.js");
    const zoneTime = await import("../shared/zone-time.js");
    const threadId = "t-refund";
    makeThread(threadId);
    const now = new Date("2026-08-01T01:00:00Z");
    const dayKey = zoneTime.todayKey(TZ, now);

    guard.reserveProactiveSlot(ACC_RUNNING, threadId, TZ, now);
    const afterReserve = counterStore.getProactiveCounter(ACC_RUNNING, threadId, dayKey).count;
    guard.refundProactiveSlot(ACC_RUNNING, threadId, TZ, now);
    assert.equal(counterStore.getProactiveCounter(ACC_RUNNING, threadId, dayKey).count, afterReserve - 1);
  });

  it("hoàn suất phải trả về ĐÚNG NGÀY đã giành - lệch một ngày là suất mất vĩnh viễn", async () => {
    // Đây là lỗ hổng nặng nhất của bug "thiếu `now`", và trước đợt này KHÔNG
    // test nào phủ. Ca thật: job đến hạn 23:59:50, `reserveProactiveSlot` giành
    // suất ngày D; gửi mất 20 giây (SCHEDULER_SEND_GAP_MS) rồi hỏng;
    // `refundProactiveSlot` nếu tự lấy giờ THẬT sẽ trừ suất của ngày D+1.
    //
    // Hậu quả: ngày D giữ suất vĩnh viễn không ai đòi lại được, còn ngày D+1
    // bị `MAX(0, count-1)` nuốt êm. Trần này là lá chắn chống khóa nick.
    const counterStore = await import("./proactive-send-counter-store.js");
    const zoneTime = await import("../shared/zone-time.js");
    const threadId = "t-refund-qua-nua-dem";
    makeThread(threadId);

    // 23:59:50 và 00:00:10 giờ VN - hai bên của cùng một ranh giới nửa đêm
    const lucGianh = new Date("2026-08-01T16:59:50Z");
    const lucHoan = new Date("2026-08-01T17:00:10Z");
    const ngayGianh = zoneTime.todayKey(TZ, lucGianh);
    const ngayHoan = zoneTime.todayKey(TZ, lucHoan);
    assert.notEqual(ngayGianh, ngayHoan, "hai mốc phải nằm hai ngày khác nhau thì ca này mới có nghĩa");

    guard.reserveProactiveSlot(ACC_RUNNING, threadId, TZ, lucGianh);
    assert.equal(counterStore.getProactiveCounter(ACC_RUNNING, threadId, ngayGianh).count, 1);

    // Hoàn bằng ĐÚNG mốc của lượt (mốc lúc giành), KHÔNG phải mốc lúc gửi hỏng
    guard.refundProactiveSlot(ACC_RUNNING, threadId, TZ, lucGianh);

    assert.equal(
      counterStore.getProactiveCounter(ACC_RUNNING, threadId, ngayGianh).count,
      0,
      "suất của ngày ĐÃ GIÀNH phải được trả lại",
    );
    assert.equal(
      counterStore.getProactiveCounter(ACC_RUNNING, threadId, ngayHoan).count,
      0,
      "ngày hôm sau KHÔNG được bị trừ oan",
    );
  });

  it("cộng đếm KHÔNG được dọn mất chính dòng vừa ghi (retention tính theo `now` của lượt)", async () => {
    // Bug gốc: `recordProactiveSend` mặc định `now = new Date()`, nên nó vừa
    // cộng vào day-key của giờ THẬT, vừa dọn bảng bằng cutoff của giờ thật -
    // xóa luôn dòng của ngày đang xử lý khi ngày đó cách quá retention 3 ngày.
    const counterStore = await import("./proactive-send-counter-store.js");
    const zoneTime = await import("../shared/zone-time.js");
    const threadId = "t-ghi-khong-tu-xoa";
    makeThread(threadId);

    // Mốc CỐ Ý cách xa ngày thật lúc chạy test - đúng thứ làm bug lộ ra
    const now = new Date("2026-08-01T03:00:00.000Z");
    const dayKey = zoneTime.todayKey(TZ, now);

    guard.recordProactiveSend(ACC_RUNNING, threadId, TZ, 2, now);

    assert.equal(
      counterStore.getProactiveCounter(ACC_RUNNING, threadId, dayKey).count,
      2,
      "dòng vừa ghi phải còn - dọn theo giờ thật sẽ xóa mất chính nó",
    );
  });

  it("refund khi count đang 0 thì kẹp sàn ở 0, không xuống âm", async () => {
    const counterStore = await import("./proactive-send-counter-store.js");
    const zoneTime = await import("../shared/zone-time.js");
    const threadId = "t-refund-am";
    makeThread(threadId);
    const now = new Date("2026-08-01T01:00:00Z");
    const dayKey = zoneTime.todayKey(TZ, now);

    guard.refundProactiveSlot(ACC_RUNNING, threadId, TZ, now);
    assert.equal(counterStore.getProactiveCounter(ACC_RUNNING, threadId, dayKey).count, 0);
  });
});
