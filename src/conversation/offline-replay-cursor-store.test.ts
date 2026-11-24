import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Mốc lấy bù tin lỡ: id việc mới nhất của từng hàng chờ Zalo (510 tin 1-1, 511
 * tin nhóm) mà bot đã có. Lần kết nối sau xin TỪ mốc, không từ đầu hàng chờ
 * (~2 tuần). Mốc chỉ TIẾN: một trang về trễ hay tin trực tiếp cũ không được kéo
 * mốc lùi, lùi là lần sau xin lại cả đoạn đã có.
 */
let dataDir: string;
let store: typeof import("./offline-replay-cursor-store.js");
let database: typeof import("./database.js");

before(async () => {
  dataDir = setupTestEnv();
  store = await import("./offline-replay-cursor-store.js");
  database = await import("./database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

beforeEach(() => {
  database.db.exec("DELETE FROM offline_replay_cursors");
});

describe("laIdZaloMoiHon", () => {
  it("so theo giá trị số nguyên: dài hơn là mới hơn, bằng nhau không phải mới hơn", () => {
    assert.equal(store.laIdZaloMoiHon("10", "9"), true);
    assert.equal(store.laIdZaloMoiHon("9", "10"), false);
    assert.equal(store.laIdZaloMoiHon("8400000000002", "8400000000001"), true);
    assert.equal(store.laIdZaloMoiHon("8400000000001", "8400000000001"), false);
  });

  it("so bằng BigInt: hai id vượt 2^53 chỉ khác nhau ở hàng đơn vị vẫn phân biệt được", () => {
    assert.equal(store.laIdZaloMoiHon("9007199254740993", "9007199254740992"), true);
  });

  it("mốc hỏng (không phải dãy số) coi như chưa có, không ném", () => {
    assert.equal(store.laIdZaloMoiHon("5", "abc"), true);
  });

  it("chưa có mốc thì id nào cũng mới hơn", () => {
    assert.equal(store.laIdZaloMoiHon("1", undefined), true);
  });

  it("id không phải dãy số, hay toàn số 0, không bao giờ là mốc mới", () => {
    assert.equal(store.laIdZaloMoiHon("abc", undefined), false);
    assert.equal(store.laIdZaloMoiHon("", undefined), false);
    assert.equal(store.laIdZaloMoiHon("000", undefined), false);
  });
});

describe("kho mốc", () => {
  it("lưu/đọc tách bạch theo account và hàng chờ", () => {
    store.luuMocLayBu("acc-a", "tin_1_1", "100");
    store.luuMocLayBu("acc-a", "tin_nhom", "200");
    store.luuMocLayBu("acc-b", "tin_1_1", "300");
    assert.deepEqual(store.docMocLayBu("acc-a"), { tin_1_1: "100", tin_nhom: "200" });
    assert.deepEqual(store.docMocLayBu("acc-b"), { tin_1_1: "300" });
    assert.deepEqual(store.docMocLayBu("acc-c"), {});
  });

  it("chỉ TIẾN: id cũ hơn hoặc bằng mốc không ghi đè", () => {
    store.luuMocLayBu("acc-a", "tin_1_1", "8400000000005");
    store.luuMocLayBu("acc-a", "tin_1_1", "8400000000003");
    assert.equal(store.docMocLayBu("acc-a").tin_1_1, "8400000000005", "id cũ hơn đã kéo mốc lùi");
    store.luuMocLayBu("acc-a", "tin_1_1", "8400000000009");
    assert.equal(store.docMocLayBu("acc-a").tin_1_1, "8400000000009");
  });

  it("xoaMocLayBu chỉ xóa đúng hàng chờ đó", () => {
    store.luuMocLayBu("acc-a", "tin_1_1", "100");
    store.luuMocLayBu("acc-a", "tin_nhom", "200");
    store.xoaMocLayBu("acc-a", "tin_1_1", "100");
    assert.deepEqual(store.docMocLayBu("acc-a"), { tin_nhom: "200" });
  });

  it("xoaMocLayBu chỉ xóa khi mốc VẪN là mốc đã xin - mốc mới hơn ghi xen vào thì giữ", () => {
    store.luuMocLayBu("acc-a", "tin_1_1", "100");
    store.luuMocLayBu("acc-a", "tin_1_1", "150");
    store.xoaMocLayBu("acc-a", "tin_1_1", "100");
    assert.equal(store.docMocLayBu("acc-a").tin_1_1, "150");
  });

  it("bỏ mốc xong thì lưu được id CŨ hơn (xin lại từ đầu hàng chờ)", () => {
    store.luuMocLayBu("acc-a", "tin_1_1", "500");
    store.xoaMocLayBu("acc-a", "tin_1_1", "500");
    store.luuMocLayBu("acc-a", "tin_1_1", "20");
    assert.equal(store.docMocLayBu("acc-a").tin_1_1, "20");
  });

  it("mốc hỏng trong DB: đọc ra coi như chưa có, lưu đè được mà không ném", () => {
    database.db
      .prepare("INSERT INTO offline_replay_cursors (account_id, queue, last_id) VALUES (?, ?, ?)")
      .run("acc-a", "tin_1_1", "abc");
    assert.deepEqual(store.docMocLayBu("acc-a"), {});
    store.luuMocLayBu("acc-a", "tin_1_1", "7");
    assert.equal(store.docMocLayBu("acc-a").tin_1_1, "7");
  });

  it("deleteAccount dọn luôn mốc (không để mồ côi -> tạo lại cùng id lại xin từ mốc cũ)", async () => {
    const accounts = await import("../config/account-store.js");
    accounts.createAccount({ id: "acc-xoa", label: "Nick" });
    store.luuMocLayBu("acc-xoa", "tin_1_1", "100");
    accounts.deleteAccount("acc-xoa");
    assert.deepEqual(store.docMocLayBu("acc-xoa"), {});
  });
});
