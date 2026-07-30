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

describe("checkProactiveSendGuard - thứ tự 3 điều kiện", () => {
  it("account chưa từng attach (không chạy) thì chặn ngay ở điều kiện đầu tiên", () => {
    const r = guard.checkProactiveSendGuard(ACC_OFFLINE, "t-bat-ky", TZ);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /không chạy/);
  });

  it("account chạy nhưng thread chưa từng ghi nhận trong hệ thống thì chặn", () => {
    const r = guard.checkProactiveSendGuard(ACC_RUNNING, "t-chua-tung-thay", TZ);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /chưa từng ghi nhận/);
  });

  it("thread tồn tại nhưng bot_enabled=0 (tắt trên dashboard) thì chặn", () => {
    threadStore.recordThreadActivity({
      accountId: ACC_RUNNING,
      threadId: "t-tat-bot",
      threadType: 0,
      displayName: "",
      lastSenderName: "",
    });
    threadStore.setBotEnabled(ACC_RUNNING, "t-tat-bot", false);

    const r = guard.checkProactiveSendGuard(ACC_RUNNING, "t-tat-bot", TZ);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /đang tắt/);
  });

  it("account chạy + thread hợp lệ + chưa chạm trần thì cho qua", () => {
    threadStore.recordThreadActivity({
      accountId: ACC_RUNNING,
      threadId: "t-hop-le",
      threadType: 0,
      displayName: "",
      lastSenderName: "",
    });
    assert.deepEqual(guard.checkProactiveSendGuard(ACC_RUNNING, "t-hop-le", TZ), { ok: true });
  });
});

describe("checkProactiveSendGuard - trần ngày (SCHEDULER_MAX_PROACTIVE_PER_DAY=3 trong test)", () => {
  it("tin thứ N+1 (N=trần) bị chặn; lần đầu chạm trần báo 1 câu, các lần sau trong CÙNG ngày im lặng", () => {
    const threadId = "t-cham-tran";
    threadStore.recordThreadActivity({
      accountId: ACC_RUNNING,
      threadId,
      threadType: 0,
      displayName: "",
      lastSenderName: "",
    });
    const now = new Date("2026-08-01T01:00:00Z");

    for (let i = 0; i < 3; i++) {
      const r = guard.checkProactiveSendGuard(ACC_RUNNING, threadId, TZ, now);
      assert.equal(r.ok, true, `tin thứ ${i + 1} (trong trần) phải qua được`);
      guard.recordProactiveSend(ACC_RUNNING, threadId, TZ, now);
    }

    const lanDauChamTran = guard.checkProactiveSendGuard(ACC_RUNNING, threadId, TZ, now);
    assert.equal(lanDauChamTran.ok, false);
    if (!lanDauChamTran.ok) {
      assert.match(lanDauChamTran.reason, /chạm trần/);
      assert.equal(lanDauChamTran.notifyCapHitOnce, true, "lần ĐẦU chạm trần phải báo 1 câu cho biết vì sao job im");
    }

    const lanSau = guard.checkProactiveSendGuard(ACC_RUNNING, threadId, TZ, now);
    assert.equal(lanSau.ok, false);
    if (!lanSau.ok) {
      assert.equal(lanSau.notifyCapHitOnce, false, "lần chạm trần SAU trong cùng ngày không được báo lại (tránh spam)");
    }
  });

  it("qua NGÀY MỚI (theo giờ VN) thì trần được reset về 0", () => {
    const threadId = "t-qua-ngay";
    threadStore.recordThreadActivity({
      accountId: ACC_RUNNING,
      threadId,
      threadType: 0,
      displayName: "",
      lastSenderName: "",
    });

    const ngay1 = new Date("2026-08-01T10:00:00Z");
    for (let i = 0; i < 3; i++) guard.recordProactiveSend(ACC_RUNNING, threadId, TZ, ngay1);
    assert.equal(guard.checkProactiveSendGuard(ACC_RUNNING, threadId, TZ, ngay1).ok, false, "đã chạm trần ngày 1");

    const ngay2 = new Date("2026-08-02T10:00:00Z");
    assert.equal(guard.checkProactiveSendGuard(ACC_RUNNING, threadId, TZ, ngay2).ok, true, "sang ngày mới phải reset");
  });

  it("mốc lật ngày là 00:00 GIỜ VN, không phải 00:00 UTC - đúng vá zone-time đã trị ở phase 01", () => {
    const threadId = "t-lech-mui-gio";
    threadStore.recordThreadActivity({
      accountId: ACC_RUNNING,
      threadId,
      threadType: 0,
      displayName: "",
      lastSenderName: "",
    });

    // 16:00Z 31/07 = 23:00 VN 31/07 (UTC+7) - vẫn ngày VN 31/07
    const truocNuaDemVN = new Date("2026-07-31T16:00:00Z");
    for (let i = 0; i < 3; i++) guard.recordProactiveSend(ACC_RUNNING, threadId, TZ, truocNuaDemVN);
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
    threadStore.recordThreadActivity({
      accountId: ACC_RUNNING,
      threadId,
      threadType: 0,
      displayName: "",
      lastSenderName: "",
    });
    const now = new Date();
    for (let i = 0; i < 3; i++) guard.recordProactiveSend(ACC_RUNNING, threadId, TZ, now);
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
