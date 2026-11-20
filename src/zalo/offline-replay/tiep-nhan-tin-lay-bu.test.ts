import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { API } from "zca-js";
import { cleanupTestEnv, setupTestEnv } from "../../shared/test-env-setup.js";
import type { ParsedMessage } from "../zalo-message-parser.js";

/**
 * Một tin lấy bù đi qua ĐÚNG bộ lọc + cách ghi của tin trực tiếp
 * (`nhanVaGhiTinDen`), nhưng bỏ hẳn tin quá trần tuổi (tính bằng `ts` THÔ - giờ
 * gửi của parser bị kẹp về giờ nhận khi tin cũ hơn 7 ngày) và đưa tin cần trả
 * lời vào hàng chờ trả lời trễ thay vì bộ gộp.
 */
let dataDir: string;
let mod: typeof import("./tiep-nhan-tin-lay-bu.js");
let HangCho: typeof import("./hang-cho-tra-loi-tre.js").HangChoTraLoiTre;
let accounts: typeof import("../../config/account-store.js");
let database: typeof import("../../conversation/database.js");

const ACC = "acc-tiep-nhan";
const SELF = "self-1";
// Giờ THẬT: parser kẹp giờ gửi theo đồng hồ thật (tin lệch quá 7 ngày về giờ nhận),
// một ngày cố định sẽ làm mọi tin bị kẹp và ca "ghi đúng giờ gửi" đo sai
const NOW = new Date();

before(async () => {
  dataDir = setupTestEnv();
  mod = await import("./tiep-nhan-tin-lay-bu.js");
  HangCho = (await import("./hang-cho-tra-loi-tre.js")).HangChoTraLoiTre;
  accounts = await import("../../config/account-store.js");
  database = await import("../../conversation/database.js");
  accounts.createAccount({ id: ACC, label: "Tiếp nhận" });
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(() => {
  database.db.exec("DELETE FROM messages");
});

let soBienNhan = 0;
const apiGia = {
  sendDeliveredEvent: async () => {
    soBienNhan++;
    return {};
  },
  getGroupInfo: async () => ({}),
} as unknown as API;

function dungCtx() {
  const daVao: [string, ParsedMessage][] = [];
  const self: [string, number][] = [];
  const hangCho = new HangCho({
    accountId: ACC,
    enqueue: () => true,
    gianCachMs: () => [0, 0],
    luuAnhTinBoQua: () => {},
  });
  const them = hangCho.them.bind(hangCho);
  hangCho.them = (tk, m) => {
    daVao.push([tk, m]);
    them(tk, m);
  };
  const ghiSelf = hangCho.ghiNhanTinSelf.bind(hangCho);
  hangCho.ghiNhanTinSelf = (tk, luc) => {
    self.push([tk, luc]);
    ghiSelf(tk, luc);
  };
  const ctx = { config: accounts.getAccount(ACC)!, api: apiGia, selfId: SELF, hangCho, now: NOW, tranTuoiGio: 48 };
  return { ctx, daVao, self };
}

const gioTruoc = (gio: number) => String(NOW.getTime() - gio * 3_600_000);

function tin11(msgId: string, ts: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { msgId, cliMsgId: `c-${msgId}`, uidFrom: "u-lan", idTo: "0", dName: "Lan", ts, content: "Hẹn họp lúc 9h nhé", msgType: "webchat", ...extra };
}

function soDong(): number {
  return (database.db.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number }).n;
}

describe("tiepNhanTinLayBu", () => {
  it("tin 1-1 hợp lệ: ghi lịch sử (mã tin, giờ gửi), vào hàng chờ với cờ layBu", () => {
    const { ctx, daVao } = dungCtx();
    const ts = gioTruoc(3);
    assert.equal(mod.tiepNhanTinLayBu(ctx, "tin_1_1", tin11("8400000000101", ts)), "cho-tra-loi");
    const row = database.db.prepare("SELECT msg_id, created_at FROM messages").get() as { msg_id: string; created_at: string };
    assert.equal(row.msg_id, "8400000000101");
    assert.equal(row.created_at, new Date(Number(ts)).toISOString());
    assert.equal(daVao.length, 1);
    assert.equal(daVao[0]?.[0], `${ACC}:u-lan`);
    assert.equal(daVao[0]?.[1].layBu, true);
  });

  it("cùng tin lần hai: 'trung', vẫn một dòng, không vào hàng chờ lần hai", () => {
    const { ctx, daVao } = dungCtx();
    const t = tin11("8400000000102", gioTruoc(3));
    mod.tiepNhanTinLayBu(ctx, "tin_1_1", t);
    assert.equal(mod.tiepNhanTinLayBu(ctx, "tin_1_1", { ...t }), "trung");
    assert.equal(soDong(), 1);
    assert.equal(daVao.length, 1);
  });

  it("cũ hơn trần tuổi (49 giờ, trần 48): 'qua-tuoi', KHÔNG ghi gì", () => {
    const { ctx, daVao } = dungCtx();
    assert.equal(mod.tiepNhanTinLayBu(ctx, "tin_1_1", tin11("8400000000103", gioTruoc(49))), "qua-tuoi");
    assert.equal(soDong(), 0);
    assert.equal(daVao.length, 0);
  });

  it("cũ 10 ngày (giờ gửi của parser bị kẹp về giờ nhận): vẫn 'qua-tuoi'", () => {
    const { ctx } = dungCtx();
    assert.equal(mod.tiepNhanTinLayBu(ctx, "tin_1_1", tin11("8400000000104", gioTruoc(240))), "qua-tuoi");
    assert.equal(soDong(), 0);
  });

  it("ts hỏng/thiếu: coi là quá tuổi (không đoán được thì không trả lời)", () => {
    const { ctx } = dungCtx();
    assert.equal(mod.tiepNhanTinLayBu(ctx, "tin_1_1", tin11("8400000000105", "khong-phai-so")), "qua-tuoi");
    assert.equal(soDong(), 0);
  });

  it("tin nhóm KHÔNG @mention: không bao giờ vào hàng chờ trả lời", () => {
    const { ctx, daVao } = dungCtx();
    const tinNhom = { ...tin11("8400000000106", gioTruoc(2)), idTo: "g-1" };
    const kq = mod.tiepNhanTinLayBu(ctx, "tin_nhom", tinNhom);
    assert.ok(kq === "ghi-thu-dong" || kq === "bo", `nhận ${kq}`);
    assert.equal(daVao.length, 0);
  });

  it("tin của chính tài khoản (uidFrom '0'): 'self', không ghi, ghi nhận giờ bằng ts THÔ", () => {
    const { ctx, daVao, self } = dungCtx();
    const ts = gioTruoc(1);
    const kq = mod.tiepNhanTinLayBu(ctx, "tin_1_1", { ...tin11("8400000000107", ts), uidFrom: "0", idTo: "u-lan" });
    assert.equal(kq, "self");
    assert.equal(soDong(), 0);
    assert.equal(daVao.length, 0);
    assert.deepEqual(self, [[`${ACC}:u-lan`, Number(ts)]]);
  });

  it("tin mang uid THẬT của chính tài khoản (không phải '0'): vẫn là self, không ghi", () => {
    const { ctx, daVao } = dungCtx();
    const kq = mod.tiepNhanTinLayBu(ctx, "tin_nhom", { ...tin11("8400000000119", gioTruoc(1)), uidFrom: SELF, idTo: "g-1" });
    assert.equal(kq, "self");
    assert.equal(soDong(), 0);
    assert.equal(daVao.length, 0);
  });

  it("tin self quá tuổi hay ts hỏng: không ghi nhận (không làm bỏ lượt oan)", () => {
    const { ctx, self } = dungCtx();
    mod.tiepNhanTinLayBu(ctx, "tin_1_1", { ...tin11("8400000000108", gioTruoc(100)), uidFrom: "0", idTo: "u-lan" });
    mod.tiepNhanTinLayBu(ctx, "tin_1_1", { ...tin11("8400000000109", "x"), uidFrom: "0", idTo: "u-lan" });
    assert.deepEqual(self, []);
  });

  it("không gửi biên nhận 'đã nhận' cho tin lấy bù (trang có thể chở hàng trăm tin cũ)", async () => {
    const { ctx } = dungCtx();
    const truoc = soBienNhan;
    mod.tiepNhanTinLayBu(ctx, "tin_1_1", tin11("8400000000110", gioTruoc(2)));
    mod.tiepNhanTinLayBu(ctx, "tin_1_1", tin11("8400000000111", gioTruoc(2)));
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(soBienNhan - truoc, 0);
  });

  it("ts ở TƯƠNG LAI quá 5 phút: coi là hỏng (tin thường quá tuổi, tin self không ghi nhận)", () => {
    const { ctx, self } = dungCtx();
    const tuongLai = String(NOW.getTime() + 3_600_000);
    assert.equal(mod.tiepNhanTinLayBu(ctx, "tin_1_1", tin11("8400000000112", tuongLai)), "qua-tuoi");
    mod.tiepNhanTinLayBu(ctx, "tin_1_1", { ...tin11("8400000000113", tuongLai), uidFrom: "0", idTo: "u-lan" });
    assert.deepEqual(self, []);
  });

  it("tin nhóm CÓ @mention bot: vào hàng chờ với threadKey của nhóm", () => {
    accounts.updateAccount(ACC, { respondToGroups: true });
    const { ctx, daVao } = dungCtx();
    const tinNhom = {
      ...tin11("8400000000114", gioTruoc(2)),
      idTo: "g-1",
      content: "@Bot ơi hẹn họp lúc 9h nhé",
      mentions: [{ uid: SELF, pos: 0, len: 4, type: 0 }],
    };
    assert.equal(mod.tiepNhanTinLayBu(ctx, "tin_nhom", tinNhom), "cho-tra-loi");
    assert.equal(daVao[0]?.[0], `${ACC}:g-1`);
    assert.equal(daVao[0]?.[1].mentionsMe, true);
  });

  it("tin self trong nhóm: ghi nhận theo threadKey của NHÓM", () => {
    const { ctx, self } = dungCtx();
    const ts = gioTruoc(1);
    mod.tiepNhanTinLayBu(ctx, "tin_nhom", { ...tin11("8400000000115", ts), uidFrom: "0", idTo: "g-1" });
    assert.deepEqual(self, [[`${ACC}:g-1`, Number(ts)]]);
  });

  it("lệnh THU HỒI: không ghi, gỡ tin gốc khỏi hàng chờ (không trả lời tin người ta đã rút lại)", () => {
    const { ctx } = dungCtx();
    mod.tiepNhanTinLayBu(ctx, "tin_1_1", tin11("8400000000116", gioTruoc(3)));
    assert.equal(ctx.hangCho.soThreadDangCho(), 1);
    const thuHoi = { ...tin11("8400000000117", gioTruoc(2)), content: { deleteMsg: {}, globalMsgId: "8400000000116" } };
    assert.equal(mod.tiepNhanTinLayBu(ctx, "tin_1_1", thuHoi), "thu-hoi");
    assert.equal(soDong(), 1, "lệnh thu hồi không được thành một dòng lịch sử");
    assert.equal(ctx.hangCho.soThreadDangCho(), 0);
  });

  it("parser ném (quote hỏng hình): 'khong-hop-le', không ném ra ngoài", () => {
    const { ctx } = dungCtx();
    assert.equal(mod.tiepNhanTinLayBu(ctx, "tin_1_1", tin11("8400000000118", gioTruoc(1), { quote: "x" })), "khong-hop-le");
  });

  it("tin thô hỏng hình: 'khong-hop-le', không ném", () => {
    const { ctx } = dungCtx();
    assert.doesNotThrow(() => mod.tiepNhanTinLayBu(ctx, "tin_1_1", {}));
    assert.equal(mod.tiepNhanTinLayBu(ctx, "tin_1_1", {}), "khong-hop-le");
  });
});
