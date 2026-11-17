import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

let dataDir: string;
let store: typeof import("./attachment-store.js");
let database: typeof import("../conversation/database.js");
let wipe: typeof import("../conversation/wipe-thread-context.js");
let accounts: typeof import("../config/account-store.js");

before(async () => {
  dataDir = setupTestEnv({ ATTACHMENT_RETENTION_DAYS: "7", ATTACHMENT_CACHE_IDLE_HOURS: "24" });
  store = await import("./attachment-store.js");
  database = await import("../conversation/database.js");
  wipe = await import("../conversation/wipe-thread-context.js");
  accounts = await import("../config/account-store.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(() => database.db.exec("DELETE FROM tep_dinh_kem"));

const T0 = new Date("2026-11-17T09:00:00.000Z");
const gio = (h: number) => new Date(T0.getTime() + h * 3_600_000);
const FILE = { href: "https://fg1.dlfl.vn/x", ten: "a.pdf", duoiKhai: "pdf", coKhai: 10 };

describe("attachment-store - tệp đính kèm, cache chữ hạn trượt", () => {
  it("layTepGanDay: mới nhất trước, bỏ dòng quá xoaLuc", () => {
    const a = store.ghiTepDen("acc", "t1", 1, "u1", FILE, T0);
    const b = store.ghiTepDen("acc", "t1", 2, "u1", { ...FILE, ten: "b.pdf" }, gio(1));
    store.ghiTepDen("acc", "t2", 3, "u1", FILE, gio(1));
    assert.deepEqual(
      store.layTepGanDay("acc", "t1", gio(2)).map((t) => t.id),
      [b, a],
    );
    // a hết hạn sau 7 ngày, b còn
    assert.deepEqual(
      store.layTepGanDay("acc", "t1", gio(7 * 24 + 0.5)).map((t) => t.id),
      [b],
    );
  });

  it("chamDocTep gia hạn cache 24 giờ kể từ lần đọc, không vượt xoaLuc", () => {
    const id = store.ghiTepDen("acc", "t1", 1, "u1", FILE, T0);
    store.luuNoiDungTep(id, { dinhDang: "pdf", soTrang: 2, noiDung: [{ nhan: "Trang 1", chu: "x", nguon: "chu" }], trangDaOcr: [] }, T0);
    store.chamDocTep(id, gio(1));
    assert.equal(store.layTep(id)!.cacheHetHan, gio(25).toISOString());
    store.chamDocTep(id, gio(7 * 24 - 2));
    assert.equal(store.layTep(id)!.cacheHetHan, store.layTep(id)!.xoaLuc, "không được vượt trần cứng");
  });

  it("xoaCacheHetHan bỏ chữ nhưng GIỮ dòng + href; xoaTepHetHan xóa dòng", () => {
    const id = store.ghiTepDen("acc", "t1", 1, "u1", FILE, T0);
    store.luuNoiDungTep(id, { dinhDang: "pdf", soTrang: 1, noiDung: [{ nhan: "Trang 1", chu: "bí mật", nguon: "chu" }], trangDaOcr: [1] }, T0);
    assert.equal(store.xoaCacheHetHan(gio(23)), 0);
    assert.equal(store.xoaCacheHetHan(gio(25)), 1);
    const sau = store.layTep(id)!;
    assert.equal(sau.noiDung, null);
    assert.deepEqual(sau.trangDaOcr, []);
    assert.equal(sau.href, FILE.href);
    assert.equal(store.xoaTepHetHan(gio(7 * 24 + 1)), 1);
    assert.equal(store.layTep(id), undefined);
  });

  it("ghiLoiTep lưu mã lỗi; luuNoiDungTep xóa mã lỗi cũ", () => {
    const id = store.ghiTepDen("acc", "t1", 1, "u1", FILE, T0);
    store.ghiLoiTep(id, "het-han");
    assert.equal(store.layTep(id)!.maLoi, "het-han");
  });

  it("xóa ngữ cảnh thread và xóa account dọn đúng tệp của mình", () => {
    store.ghiTepDen("acc", "t1", 1, "u1", FILE, T0);
    const khac = store.ghiTepDen("acc", "t2", 2, "u1", FILE, T0);
    const accKhac = store.ghiTepDen("acc2", "t1", 3, "u1", FILE, T0);
    wipe.xoaNguCanhThread("acc", "t1");
    assert.equal(store.layTepGanDay("acc", "t1", T0).length, 0);
    assert.ok(store.layTep(khac));
    accounts.deleteAccount("acc2");
    assert.equal(store.layTep(accKhac), undefined);
    assert.ok(store.layTep(khac));
  });
});
