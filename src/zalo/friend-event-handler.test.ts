import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { type API, type FriendEvent, FriendEventType } from "zca-js";

import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";

/**
 * Handler `friend_event`. Dùng store THẬT (setupTestEnv trước) + `layUser` giả
 * (khỏi gọi mạng). `api` chỉ chạm khi không truyền `layUser` nên stub rỗng đủ.
 */
let dataDir: string;
let handler: typeof import("./friend-event-handler.js");
let store: typeof import("../conversation/friend-request-store.js");
let database: typeof import("../conversation/database.js");

const apiStub = {} as unknown as API;

before(async () => {
  dataDir = setupTestEnv();
  handler = await import("./friend-event-handler.js");
  store = await import("../conversation/friend-request-store.js");
  database = await import("../conversation/database.js");
});

after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});

function evRequest(fromUid: string, isSelf = false, message = "cho ket ban"): FriendEvent {
  return {
    type: FriendEventType.REQUEST,
    data: { fromUid, toUid: "me", src: 0, message },
    threadId: "me",
    isSelf,
  } as FriendEvent;
}

const layUserGia =
  (name: string, avatar: string): import("./friend-event-handler.js").LayUser =>
  async () => ({ changed_profiles: { u_0: { displayName: name, avatar } } });

const layUserNem: import("./friend-event-handler.js").LayUser = async () => {
  throw new Error("rate limit");
};

describe("handleFriendEvent", () => {
  it("REQUEST (không phải mình) -> lưu pending, enrich tên/avatar, đúng thời gian", async () => {
    await handler.handleFriendEvent("acc-1", apiStub, evRequest("u-req", false, "hi"), {
      layUser: layUserGia("Hoa", "https://cdn/h.jpg"),
      now: () => 12345,
    });
    const r = store.listFriendRequests("acc-1").find((x) => x.fromUid === "u-req");
    assert.ok(r, "phải lưu dòng pending");
    assert.equal(r!.senderName, "Hoa");
    assert.equal(r!.avatarUrl, "https://cdn/h.jpg");
    assert.equal(r!.message, "hi");
    assert.equal(r!.receivedAt, 12345);
  });

  it("REQUEST + getUserInfo NÉM -> vẫn lưu, senderName null, KHÔNG ném", async () => {
    await handler.handleFriendEvent("acc-1", apiStub, evRequest("u-nem"), { layUser: layUserNem });
    const r = store.listFriendRequests("acc-1").find((x) => x.fromUid === "u-nem");
    assert.ok(r, "enrich hỏng vẫn phải lưu");
    assert.equal(r!.senderName, null);
    assert.equal(r!.avatarUrl, null);
  });

  it("REQUEST isSelf (mình gửi đi) -> KHÔNG lưu", async () => {
    await handler.handleFriendEvent("acc-1", apiStub, evRequest("u-self", true), {
      layUser: layUserGia("X", "y"),
    });
    assert.ok(!store.listFriendRequests("acc-1").some((x) => x.fromUid === "u-self"));
  });

  it("ADD -> xóa dòng pending của uid vừa thành bạn", async () => {
    store.upsertFriendRequest({ accountId: "acc-2", fromUid: "u-add", message: "", senderName: null, avatarUrl: null, receivedAt: 1 });
    const ev = { type: FriendEventType.ADD, data: "u-add", threadId: "u-add", isSelf: false } as FriendEvent;
    await handler.handleFriendEvent("acc-2", apiStub, ev);
    assert.ok(!store.listFriendRequests("acc-2").some((x) => x.fromUid === "u-add"), "ADD phải xóa pending");
  });

  it("REJECT_REQUEST / UNDO_REQUEST -> xóa dòng pending của fromUid", async () => {
    for (const type of [FriendEventType.REJECT_REQUEST, FriendEventType.UNDO_REQUEST]) {
      store.upsertFriendRequest({ accountId: "acc-3", fromUid: "u-rej", message: "", senderName: null, avatarUrl: null, receivedAt: 1 });
      const ev = { type, data: { toUid: "me", fromUid: "u-rej" }, threadId: "me", isSelf: false } as FriendEvent;
      await handler.handleFriendEvent("acc-3", apiStub, ev);
      assert.ok(!store.listFriendRequests("acc-3").some((x) => x.fromUid === "u-rej"), `${type} phải xóa pending`);
    }
  });

  it("REQUEST fromUid RỖNG -> không lưu, không ném", async () => {
    await handler.handleFriendEvent("acc-empty", apiStub, evRequest("", false), {
      layUser: layUserGia("X", "y"),
    });
    assert.equal(store.listFriendRequests("acc-empty").length, 0);
  });

  it("REMOVE -> không đụng bảng pending, không ném", async () => {
    store.upsertFriendRequest({ accountId: "acc-4", fromUid: "u-keep", message: "", senderName: null, avatarUrl: null, receivedAt: 1 });
    const ev = { type: FriendEventType.REMOVE, data: "u-keep", threadId: "u-keep", isSelf: false } as FriendEvent;
    await handler.handleFriendEvent("acc-4", apiStub, ev);
    assert.ok(store.listFriendRequests("acc-4").some((x) => x.fromUid === "u-keep"), "REMOVE không xóa pending");
  });
});
