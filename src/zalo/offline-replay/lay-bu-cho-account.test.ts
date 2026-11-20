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

  it("khung hỏng (không giải mã được): lượt dở NGAY, giữ mốc (không chờ hết giờ rồi bỏ mốc), không ném ra ws", () => {
    moc.luuMocLayBu(ACC, "tin_1_1", "8400000000100");
    const { api, ws } = apiGia();
    const layBu = mod.batDauLayBuChoAccount(accounts.getAccount(ACC)!, api, SELF, { enqueue: () => true })!;
    layBu.khiKetNoi();
    const hong = Buffer.concat([dungKhungWs(510, 1, {}).subarray(0, 4), Buffer.from('{"data":"x","encrypt":2}', "utf8")]);
    assert.doesNotThrow(() => ws.emit("message", hong));
    mock.timers.tick(8_000);
    assert.equal(moc.docMocLayBu(ACC).tin_1_1, "8400000000100");
  });

  it("tin trực tiếp đẩy mốc khi đã bắt kịp; tin trùng / tin self thì không", () => {
    const { api, ws } = apiGia();
    const layBu = mod.batDauLayBuChoAccount(accounts.getAccount(ACC)!, api, SELF, { enqueue: () => true })!;
    layBu.khiKetNoi();
    ws.emit("message", dungKhungWs(510, 1, { msgs: [], more: 0, lastActionId: "8400000000500" }));
    const live = (msgId: string, uidFrom: string) => ({
      threadId: "u-lan",
      type: 0,
      isSelf: uidFrom === SELF,
      data: { content: "alo", uidFrom, idTo: SELF, dName: "Lan", msgId, cliMsgId: "c" },
    });
    router.routeIncomingMessage(ACC, api, SELF, live("8400000000600", "u-lan"));
    assert.equal(moc.docMocLayBu(ACC).tin_1_1, "8400000000600");
    router.routeIncomingMessage(ACC, api, SELF, live("8400000000600", "u-lan"));
    router.routeIncomingMessage(ACC, api, SELF, live("8400000000700", SELF));
    assert.equal(moc.docMocLayBu(ACC).tin_1_1, "8400000000600", "tin self đã đẩy mốc");
  });

  it("hai lần mất mạng: người đã nhắn trực tiếp ở lượt 1 vẫn được trả lời tin lỡ MỚI của lượt 2", () => {
    tuning.setTuning("LAY_BU_GIAN_CACH_MIN_GIAY", 60);
    tuning.setTuning("LAY_BU_GIAN_CACH_MAX_GIAY", 60);
    tuning.setTuning("LAY_BU_KHOANG_TOI_THIEU_PHUT", 0);
    try {
      const { api, ws } = apiGia();
      const daVao: string[] = [];
      const layBu = mod.batDauLayBuChoAccount(accounts.getAccount(ACC)!, api, SELF, {
        enqueue: (_tk, m) => {
          daVao.push(m.msgId);
          return true;
        },
      })!;
      layBu.khiKetNoi();
      ws.emit(
        "message",
        dungKhungWs(510, 1, {
          msgs: [tinTho("8400000000901", "u-lan", 3), tinTho("8400000000902", "u-minh", 2)],
          more: 0,
          lastActionId: "8400000000902",
        }),
      );
      mock.timers.tick(5_000);
      ws.emit("message", dungKhungWs(511, 1, { groupMsgs: [], more: 0, lastActionId: "1" }));
      layBu.daTraLoiTrucTiep(`${ACC}:u-minh`, "u-minh", Date.now()); // Minh nhắn trực tiếp lúc đang chờ
      layBu.khiDongKetNoi();
      layBu.khiKetNoi(); // lượt 2 - tin lỡ gửi SAU lúc Minh nhắn trực tiếp
      const tinMoi = { ...tinTho("8400000000903", "u-minh", 0), ts: String(Date.now() + 60_000) };
      ws.emit("message", dungKhungWs(510, 1, { msgs: [tinMoi], more: 0, lastActionId: "8400000000903" }));
      mock.timers.tick(5_000);
      ws.emit("message", dungKhungWs(511, 1, { groupMsgs: [], more: 0, lastActionId: "2" }));
      mock.timers.tick(120_000);
      assert.ok(daVao.includes("8400000000903"), `tin lỡ lượt 2 của Minh không được trả lời: ${daVao.join(",")}`);
    } finally {
      tuning.setTuning("LAY_BU_GIAN_CACH_MIN_GIAY", null);
      tuning.setTuning("LAY_BU_GIAN_CACH_MAX_GIAY", null);
      tuning.setTuning("LAY_BU_KHOANG_TOI_THIEU_PHUT", null);
    }
  });

  it("tin trực tiếp BỊ LỌC (nhóm không @mention bot) không tính: tin lỡ của người đó vẫn được trả lời", () => {
    accounts.updateAccount(ACC, { respondToGroups: true });
    try {
      const { api, ws } = apiGia();
      const traLoiTre: string[] = [];
      const layBu = mod.batDauLayBuChoAccount(accounts.getAccount(ACC)!, api, SELF, {
        enqueue: (_tk, m) => {
          traLoiTre.push(m.msgId);
          return true;
        },
      })!;
      layBu.khiKetNoi();
      const tinNhomLo = {
        ...tinTho("8400000001001", "u-lan", 2),
        idTo: "g-1",
        content: "@Bot ơi hẹn họp lúc 9h nhé",
        mentions: [{ uid: SELF, pos: 0, len: 4, type: 0 }],
      };
      ws.emit("message", dungKhungWs(510, 1, { msgs: [], more: 0, lastActionId: "1" }));
      mock.timers.tick(5_000);
      // Lan nhắn trong nhóm KHÔNG gọi bot (bị lọc, bot không trả lời) trước khi trang nhóm về
      router.routeIncomingMessage(ACC, api, SELF, {
        threadId: "g-1",
        type: 1,
        isSelf: false,
        data: { content: "mọi người ơi", uidFrom: "u-lan", idTo: "g-1", dName: "Lan", msgId: "8400000001002", cliMsgId: "c" },
      });
      ws.emit("message", dungKhungWs(511, 1, { groupMsgs: [tinNhomLo], more: 0, lastActionId: "8400000001001" }));
      batcher.clearPendingBatches();
      mock.timers.tick(5_000);
      assert.ok(traLoiTre.includes("8400000001001"), `tin lỡ bị bỏ oan vì một tin bị lọc: ${traLoiTre.join(",")}`);
    } finally {
      accounts.updateAccount(ACC, { respondToGroups: true }); // mặc định của account
    }
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

  it("dừng giữa lượt có thread đang chờ: gỡ sổ đăng ký, không xin thêm, không đưa thêm vào bộ gộp", () => {
    tuning.setTuning("LAY_BU_GIAN_CACH_MIN_GIAY", 60);
    tuning.setTuning("LAY_BU_GIAN_CACH_MAX_GIAY", 60);
    try {
      const { api, lenh, ws } = apiGia();
      let soVao = 0;
      const layBu = mod.batDauLayBuChoAccount(accounts.getAccount(ACC)!, api, SELF, {
        enqueue: () => {
          soVao++;
          return true;
        },
      })!;
      layBu.khiKetNoi();
      ws.emit(
        "message",
        dungKhungWs(510, 1, {
          msgs: [tinTho("8400000000801", "u-lan", 3), tinTho("8400000000802", "u-minh", 2)],
          more: 0,
          lastActionId: "8400000000802",
        }),
      );
      mock.timers.tick(5_000);
      ws.emit("message", dungKhungWs(511, 1, { groupMsgs: [], more: 0, lastActionId: "1" }));
      assert.equal(soVao, 1);
      assert.ok(registry.layBuCuaAccount(ACC));
      const lenhTruoc = lenh.length;
      mod.dungLayBuChoAccount(ACC);
      assert.equal(registry.layBuCuaAccount(ACC), undefined);
      mock.timers.tick(600_000);
      assert.equal(soVao, 1, "đã dừng mà vẫn đưa thread còn chờ vào bộ gộp");
      assert.equal(lenh.length, lenhTruoc);
    } finally {
      tuning.setTuning("LAY_BU_GIAN_CACH_MIN_GIAY", null);
      tuning.setTuning("LAY_BU_GIAN_CACH_MAX_GIAY", null);
    }
  });

  it("đầu-cuối với router: người đang chờ trả lời trễ nhắn tin mới -> CHỈ tin mới vào lượt, tin lỡ cũ bị bỏ (vẫn trong lịch sử)", () => {
    tuning.setTuning("LAY_BU_GIAN_CACH_MIN_GIAY", 60);
    tuning.setTuning("LAY_BU_GIAN_CACH_MAX_GIAY", 60);
    try {
      const { api, ws } = apiGia();
      // Hàng chờ trễ đẩy vào hàm ghi lại; tin trực tiếp đi bộ gộp THẬT của router
      const traLoiTre: string[] = [];
      const layBu = mod.batDauLayBuChoAccount(accounts.getAccount(ACC)!, api, SELF, {
        enqueue: (_tk, m) => {
          traLoiTre.push(m.msgId);
          return true;
        },
      })!;
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
      const ids = batcher.idTinDangCho(`${ACC}:u-minh`);
      const maTin = ids.map(
        (id) => (database.db.prepare("SELECT msg_id FROM messages WHERE id = ?").get(id) as { msg_id: string }).msg_id,
      );
      assert.deepEqual(maTin, ["8400000000403"], "tin lỡ cũ không được vào lượt khi người ta đã nhắn lại");
      // Dọn bộ gộp TRƯỚC khi tick (debounce xả batch thật là lượt agent gọi ra ngoài),
      // rồi chờ hết nhịp giãn: tin lỡ cũ của Minh không bao giờ được nhả
      batcher.clearPendingBatches();
      mock.timers.tick(120_000);
      assert.ok(!traLoiTre.includes("8400000000402"), `tin lỡ cũ vẫn được trả lời trễ: ${traLoiTre.join(",")}`);
      const coTrongLichSu = database.db.prepare("SELECT 1 FROM messages WHERE msg_id = ?").get("8400000000402");
      assert.ok(coTrongLichSu, "tin lỡ cũ vẫn phải nằm trong lịch sử làm ngữ cảnh");
    } finally {
      tuning.setTuning("LAY_BU_GIAN_CACH_MIN_GIAY", null);
      tuning.setTuning("LAY_BU_GIAN_CACH_MAX_GIAY", null);
    }
  });
});
