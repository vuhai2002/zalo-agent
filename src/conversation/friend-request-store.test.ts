import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Store bảng `friend_requests`. PHẢI `setupTestEnv()` trước rồi mới `await import`:
 * `friend-request-store` bắc cầu tới `database.ts` (mở DB + migration ở module scope).
 */
let dataDir: string;
let store: typeof import("./friend-request-store.js");
let database: typeof import("./database.js");

before(async () => {
  dataDir = setupTestEnv();
  store = await import("./friend-request-store.js");
  database = await import("./database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

function req(over: Partial<import("./friend-request-store.js").FriendRequestRow> = {}) {
  return {
    accountId: "acc-1",
    fromUid: "u1",
    message: "cho ket ban nhe",
    senderName: "Hoa",
    avatarUrl: "https://cdn/a.jpg",
    receivedAt: 1000,
    ...over,
  };
}

describe("friend-request-store", () => {
  it("upsert rồi list trả đúng field", () => {
    store.upsertFriendRequest(req({ fromUid: "u-list" }));
    const ds = store.listFriendRequests("acc-1").filter((r) => r.fromUid === "u-list");
    assert.equal(ds.length, 1);
    assert.deepEqual(ds[0], req({ fromUid: "u-list" }));
  });

  it("upsert TRÙNG (account, from_uid) chỉ cập nhật, KHÔNG đẻ dòng thứ hai", () => {
    store.upsertFriendRequest(req({ fromUid: "u-trung", message: "lần 1", receivedAt: 1 }));
    store.upsertFriendRequest(req({ fromUid: "u-trung", message: "lần 2", receivedAt: 2 }));
    const ds = store.listFriendRequests("acc-1").filter((r) => r.fromUid === "u-trung");
    assert.equal(ds.length, 1, "trùng PK không được đẻ dòng mới");
    assert.equal(ds[0]!.message, "lần 2");
    assert.equal(ds[0]!.receivedAt, 2);
  });

  it("xóa dòng rồi list không còn", () => {
    store.upsertFriendRequest(req({ fromUid: "u-xoa" }));
    assert.equal(store.xoaFriendRequest("acc-1", "u-xoa"), true);
    assert.ok(!store.listFriendRequests("acc-1").some((r) => r.fromUid === "u-xoa"));
    assert.equal(store.xoaFriendRequest("acc-1", "u-xoa"), false, "xóa dòng đã mất -> false, không ném");
  });

  it("list lọc đúng theo accountId - hai account không lẫn", () => {
    store.upsertFriendRequest(req({ accountId: "acc-A", fromUid: "x" }));
    store.upsertFriendRequest(req({ accountId: "acc-B", fromUid: "y" }));
    assert.ok(store.listFriendRequests("acc-A").every((r) => r.accountId === "acc-A"));
    assert.ok(store.listFriendRequests("acc-A").some((r) => r.fromUid === "x"));
    assert.ok(!store.listFriendRequests("acc-A").some((r) => r.fromUid === "y"));
  });

  it("layFriendRequestQuaHan: trả dòng received_at <= mốc (BAO GỒM đúng bằng mốc)", () => {
    store.upsertFriendRequest(req({ accountId: "acc-qh", fromUid: "cu", receivedAt: 100 }));
    store.upsertFriendRequest(req({ accountId: "acc-qh", fromUid: "bang", receivedAt: 200 }));
    store.upsertFriendRequest(req({ accountId: "acc-qh", fromUid: "moi", receivedAt: 500 }));
    const ds = store.layFriendRequestQuaHan("acc-qh", 200);
    // 'bang' đúng bằng mốc phải được tính (<=), nếu đổi thành < thì rớt -> phép phá bắt được.
    assert.deepEqual(
      ds.map((r) => r.fromUid),
      ["cu", "bang"],
      "cu(100) + bang(200) quá/đúng hạn; moi(500) chưa; thứ tự theo received_at tăng",
    );
  });

  it("enrich hỏng -> senderName/avatarUrl null vẫn lưu được", () => {
    store.upsertFriendRequest(req({ fromUid: "u-null", senderName: null, avatarUrl: null }));
    const r = store.listFriendRequests("acc-1").find((x) => x.fromUid === "u-null");
    assert.ok(r);
    assert.equal(r!.senderName, null);
    assert.equal(r!.avatarUrl, null);
  });

  it("capNhatHoSo cập nhật tên/avatar của dòng đã có", () => {
    store.upsertFriendRequest(req({ accountId: "acc-cap", fromUid: "u", senderName: null, avatarUrl: null }));
    store.capNhatHoSoFriendRequest("acc-cap", "u", "Hoa", "av");
    const r = store.listFriendRequests("acc-cap")[0]!;
    assert.equal(r.senderName, "Hoa");
    assert.equal(r.avatarUrl, "av");
  });

  it("capNhatHoSo là UPDATE-only: dòng không tồn tại -> KHÔNG tạo dòng ma", () => {
    // Chống ca enrich chậm rồi ADD xóa dòng trong lúc chờ: update-only nên no-op.
    store.capNhatHoSoFriendRequest("acc-ma", "u-ma", "X", "y");
    assert.equal(store.listFriendRequests("acc-ma").length, 0, "update dòng đã mất phải là no-op");
  });
});
