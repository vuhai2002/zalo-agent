import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";
import type { API } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";
import type { ParsedMessage } from "../zalo-message-parser.js";
import { dungKhungWs } from "./khung-ws-test-helper.js";

/**
 * Nối dây lấy bù theo account, đầu-cuối trên api giả: "connected" -> xin 510/511
 * qua `sendWs` -> khung WS thô về -> tin ghi lịch sử -> hàng chờ trễ -> bộ gộp.
 */
let dataDir: string;
let mod: typeof import("./lay-bu-cho-account.js");
let registry: typeof import("./lay-bu-registry.js");
let router: typeof import("../incoming-message-router.js");
let batcher: typeof import("../../middleware/message-batcher.js");
let accounts: typeof import("../../config/account-store.js");
let tuning: typeof import("../../config/runtime-tuning-settings.js");
let moc: typeof import("../../conversation/offline-replay-cursor-store.js");
let database: typeof import("../../conversation/database.js");

const ACC = "acc-lay-bu";
const SELF = "self-1";

before(async () => {
  dataDir = setupTestEnv();
  mod = await import("./lay-bu-cho-account.js");
  registry = await import("./lay-bu-registry.js");
  router = await import("../incoming-message-router.js");
  batcher = await import("../../middleware/message-batcher.js");
  accounts = await import("../../config/account-store.js");
  tuning = await import("../../config/runtime-tuning-settings.js");
  moc = await import("../../conversation/offline-replay-cursor-store.js");
  database = await import("../../conversation/database.js");
  accounts.createAccount({ id: ACC, label: "Lấy bù" });
});

after(() => {
  batcher.clearPendingBatches();
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(() => {
  database.db.exec("DELETE FROM messages; DELETE FROM offline_replay_cursors");
  mock.timers.enable({ apis: ["setTimeout"] });
});

afterEach(() => {
  mod.dungLayBuChoAccount(ACC);
  batcher.clearPendingBatches();
  mock.timers.reset();
  tuning.setTuning("LAY_BU_ENABLED", null);
});

type ListenerGia = EventEmitter & { ws: EventEmitter; cipherKey: string | null; sendWs: (p: unknown) => void };

function apiGia(): { api: API; lenh: { cmd: number; data: { first: boolean; lastId: string | null } }[]; ws: EventEmitter } {
  const lenh: { cmd: number; data: { first: boolean; lastId: string | null } }[] = [];
  const listener = new EventEmitter() as ListenerGia;
  listener.ws = new EventEmitter();
  listener.cipherKey = null;
  listener.sendWs = (p) => lenh.push(p as (typeof lenh)[number]);
  const api = { listener, sendDeliveredEvent: async () => ({}), getGroupInfo: async () => ({}) } as unknown as API;
  return { api, lenh, ws: listener.ws };
}

const tinTho = (msgId: string, uidFrom: string, gioTruoc: number) => ({
  msgId,
  cliMsgId: `c-${msgId}`,
  uidFrom,
  idTo: "0",
  dName: "Lan",
  ts: String(Date.now() - gioTruoc * 3_600_000),
  content: "Hẹn họp lúc 9h nhé",
  msgType: "webchat",
});

describe("lấy bù theo account", () => {
  it("kết nối -> xin 510 qua sendWs; khung về -> ghi lịch sử, lưu mốc; xong lượt -> đưa vào bộ gộp với cờ layBu", () => {
    const { api, lenh, ws } = apiGia();
    const daVao: ParsedMessage[] = [];
    const layBu = mod.batDauLayBuChoAccount(accounts.getAccount(ACC)!, api, SELF, {
      enqueue: (_tk, m) => {
        daVao.push(m);
        return true;
      },
    })!;
    layBu.khiKetNoi();
    assert.deepEqual(lenh[0], { version: 1, cmd: 510, subCmd: 1, data: { first: true, lastId: null, preIds: [] } });
    ws.emit("message", dungKhungWs(510, 1, { msgs: [tinTho("8400000000301", "u-lan", 3)], more: 0, lastActionId: "8400000000301" }));
    assert.equal(moc.docMocLayBu(ACC).tin_1_1, "8400000000301");
    mock.timers.tick(5_000);
    assert.equal(lenh[1]?.cmd, 511);
    ws.emit("message", dungKhungWs(511, 1, { groupMsgs: [], more: 0, lastActionId: "8400000000001" }));
    const row = database.db.prepare("SELECT msg_id FROM messages").get() as { msg_id: string };
    assert.equal(row.msg_id, "8400000000301");
    assert.equal(daVao.length, 1);
    assert.equal(daVao[0]?.layBu, true);
  });

  it("khung hỏng (không giải mã được): lượt dở, không ném ra ws", () => {
    const { api, ws } = apiGia();
    const layBu = mod.batDauLayBuChoAccount(accounts.getAccount(ACC)!, api, SELF, { enqueue: () => true })!;
    layBu.khiKetNoi();
    const hong = Buffer.concat([dungKhungWs(510, 1, {}).subarray(0, 4), Buffer.from('{"data":"x","encrypt":2}', "utf8")]);
    assert.doesNotThrow(() => ws.emit("message", hong));
  });

  it("tắt LAY_BU_ENABLED trên dashboard: kết nối không xin gì", () => {
    tuning.setTuning("LAY_BU_ENABLED", false);
    const { api, lenh } = apiGia();
    const layBu = mod.batDauLayBuChoAccount(accounts.getAccount(ACC)!, api, SELF, { enqueue: () => true })!;
    layBu.khiKetNoi();
    assert.equal(lenh.length, 0);
  });

  it("kênh bot: không có lấy bù", () => {
    const { api } = apiGia();
    const bot = { ...accounts.getAccount(ACC)!, loai: "bot" as const };
    assert.equal(mod.batDauLayBuChoAccount(bot, api, SELF), null);
  });

  it("dừng: gỡ khỏi sổ đăng ký, không xin thêm", () => {
    const { api, lenh } = apiGia();
    mod.batDauLayBuChoAccount(accounts.getAccount(ACC)!, api, SELF, { enqueue: () => true });
    assert.ok(registry.layBuCuaAccount(ACC));
    mod.dungLayBuChoAccount(ACC);
    assert.equal(registry.layBuCuaAccount(ACC), undefined);
    mock.timers.tick(10_000);
    assert.equal(lenh.length, 0);
  });

  it("đầu-cuối với router: người đang chờ trả lời trễ nhắn tin mới -> CÙNG một batch [tin lấy bù, tin trực tiếp]", () => {
    tuning.setTuning("LAY_BU_GIAN_CACH_MIN_GIAY", 60);
    tuning.setTuning("LAY_BU_GIAN_CACH_MAX_GIAY", 60);
    try {
      const { api, ws } = apiGia();
      const layBu = mod.batDauLayBuChoAccount(accounts.getAccount(ACC)!, api, SELF)!;
      layBu.khiKetNoi();
      // Hai người lỡ tin; người đầu được nhả ngay, người sau chờ nhịp 60 giây
      ws.emit(
        "message",
        dungKhungWs(510, 1, {
          msgs: [tinTho("8400000000401", "u-lan", 3), tinTho("8400000000402", "u-minh", 2)],
          more: 0,
          lastActionId: "8400000000402",
        }),
      );
      mock.timers.tick(5_000);
      ws.emit("message", dungKhungWs(511, 1, { groupMsgs: [], more: 0, lastActionId: "1" }));
      assert.equal(batcher.idTinDangCho(`${ACC}:u-minh`).length, 0, "người sau đáng lẽ còn chờ nhịp");

      router.routeIncomingMessage(ACC, api, SELF, {
        threadId: "u-minh",
        type: 0,
        isSelf: false,
        data: { content: "alo", uidFrom: "u-minh", idTo: SELF, dName: "Minh", msgId: "8400000000403", cliMsgId: "c" },
      });
      assert.equal(batcher.idTinDangCho(`${ACC}:u-minh`).length, 2, "tin lấy bù và tin trực tiếp phải chung một batch");
    } finally {
      tuning.setTuning("LAY_BU_GIAN_CACH_MIN_GIAY", null);
      tuning.setTuning("LAY_BU_GIAN_CACH_MAX_GIAY", null);
    }
  });
});
